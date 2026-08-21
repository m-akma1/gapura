import type { PrismaClient } from "@gapura/auth-core";
import type { GapuraEvent, LogoutNotification } from "@gapura/contracts";
import { signPayload } from "@gapura/crypto";
import type { Channel, ConsumeMessage } from "amqplib";
import type { Logger } from "pino";
import { signingSecretFor, type WorkerEnv } from "./env.js";
import {
  appKey,
  DLQ_EXCHANGE,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  retryExchange,
} from "./topology.js";

interface Delivery {
  event: GapuraEvent;
  targetApplicationId: string;
}

export class DeliveryConsumer {
  private readonly consumerTags: string[] = [];
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly channel: Channel,
    private readonly log: Logger,
    private readonly env: WorkerEnv,
  ) {}

  async consume(queue: string): Promise<void> {
    const { consumerTag } = await this.channel.consume(queue, (message) => {
      if (message === null) return;
      const inFlight = this.handle(message).finally(() => {
        this.inFlight.delete(inFlight);
      });
      this.inFlight.add(inFlight);
    });
    this.consumerTags.push(consumerTag);
    this.log.info({ queue, consumerTag }, "consuming");
  }

  get isConsuming(): boolean {
    return this.consumerTags.length > 0;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  async stopConsuming(): Promise<void> {
    for (const tag of this.consumerTags.splice(0)) {
      await this.channel.cancel(tag).catch(() => undefined);
    }
  }

  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    let parsed: Delivery;
    try {
      parsed = JSON.parse(message.content.toString("utf8")) as Delivery;
    } catch {
      this.log.error("message is not valid JSON, routing to DLQ");
      this.toDlq(message);
      this.channel.ack(message);
      return;
    }

    const { event, targetApplicationId } = parsed;
    const application = await this.prisma.application.findUnique({
      where: { id: targetApplicationId },
      select: { id: true, clientId: true, logoutNotificationUrl: true, status: true },
    });

    if (application === null || application.status !== "active") {
      this.log.warn(
        { targetApplicationId },
        "target application missing or inactive, dropping",
      );
      await this.recordFailure(event.eventId, targetApplicationId, "application unavailable", true);
      this.toDlq(message);
      this.channel.ack(message);
      return;
    }

    const attempt = await this.beginAttempt(event.eventId, application.id);
    const correlationId =
      typeof event.metadata["correlationId"] === "string"
        ? event.metadata["correlationId"]
        : event.eventId;

    try {
      await this.post(application, event, correlationId);

      await this.prisma.eventDelivery.updateMany({
        where: { eventId: event.eventId, applicationId: application.id },
        data: { status: "succeeded", processedAt: new Date(), lastError: null },
      });
      this.log.info(
        { eventId: event.eventId, app: application.clientId, attempt },
        "delivered",
      );
      this.channel.ack(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      if (attempt >= MAX_ATTEMPTS) {
        await this.recordFailure(event.eventId, application.id, reason, true);
        this.log.error(
          { eventId: event.eventId, app: application.clientId, attempt, reason },
          "attempts exhausted, dead-lettering",
        );
        this.toDlq(message);
      } else {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[0];
        await this.recordFailure(event.eventId, application.id, reason, false, delay);
        this.log.warn(
          { eventId: event.eventId, app: application.clientId, attempt, delay, reason },
          "delivery failed, scheduling retry",
        );
        this.channel.publish(
          retryExchange(delay),
          message.fields.routingKey,
          message.content,
          { persistent: true, contentType: "application/json", messageId: event.eventId },
        );
      }
      this.channel.ack(message);
    }
  }

  private async post(
    application: { clientId: string; logoutNotificationUrl: string },
    event: GapuraEvent,
    correlationId: string,
  ): Promise<void> {
    const payload: LogoutNotification = {
      event,
      targetApplicationId: application.clientId,
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = signingSecretFor(this.env, appKey(application.clientId));

    const response = await fetch(application.logoutNotificationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gapura-timestamp": String(timestamp),
        "x-gapura-signature": signPayload(secret, timestamp, rawBody),
        "x-request-id": correlationId,
      },
      body: rawBody,
      signal: AbortSignal.timeout(this.env.deliveryTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  private async beginAttempt(eventId: string, applicationId: string): Promise<number> {
    const updated = await this.prisma.eventDelivery.update({
      where: { eventId_applicationId: { eventId, applicationId } },
      data: {
        status: "processing",
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
      select: { attemptCount: true },
    });
    return updated.attemptCount;
  }

  private async recordFailure(
    eventId: string,
    applicationId: string,
    reason: string,
    terminal: boolean,
    retryDelayMs?: number,
  ): Promise<void> {
    await this.prisma.eventDelivery.updateMany({
      where: { eventId, applicationId },
      data: {
        status: terminal ? "failed" : "retrying",
        lastError: reason.slice(0, 500),
        nextRetryAt:
          retryDelayMs === undefined ? null : new Date(Date.now() + retryDelayMs),
      },
    });
  }

  private toDlq(message: ConsumeMessage): void {
    this.channel.publish(DLQ_EXCHANGE, "", message.content, {
      persistent: true,
      contentType: "application/json",
      headers: { ...message.properties.headers, "x-gapura-original-key": message.fields.routingKey },
    });
  }
}
