import type { PrismaClient } from "@gapura/auth-core";
import { EventType, type GapuraEvent } from "@gapura/contracts";
import type { Channel } from "amqplib";
import type { Logger } from "pino";
import { EVENTS_EXCHANGE, routingKeyForApp } from "./topology.js";

interface ClaimedEvent {
  id: string;
  eventType: string;
  applicationId: string | null;
  payload: GapuraEvent;
}

interface TargetApp {
  id: string;
  clientId: string;
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly channel: Channel,
    private readonly log: Logger,
    private readonly options: { intervalMs: number; batchSize: number },
    private readonly onTick?: () => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const published = await this.publishBatch();
      if (published > 0) this.log.info({ published }, "outbox batch published");
      this.onTick?.();
    } catch (error) {
      this.log.error({ err: error }, "outbox tick failed");
    } finally {
      this.running = false;
    }
  }

  private async publishBatch(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<ClaimedEvent[]>`
        SELECT id, event_type AS "eventType", application_id AS "applicationId", payload
        FROM events
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT ${this.options.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (claimed.length === 0) return 0;

      const activeApps = await tx.application.findMany({
        where: { status: "active" },
        select: { id: true, clientId: true },
      });

      for (const event of claimed) {
        await this.publishOne(tx, event, activeApps);
      }

      return claimed.length;
    });
  }

  private async publishOne(
    tx: Tx,
    event: ClaimedEvent,
    activeApps: TargetApp[],
  ): Promise<void> {
    const targets =
      event.eventType === EventType.AccessPolicyChanged
        ? activeApps.filter((app) => app.id === event.applicationId)
        : activeApps;

    for (const target of targets) {
      await tx.eventDelivery.upsert({
        where: {
          eventId_applicationId: { eventId: event.id, applicationId: target.id },
        },
        update: {},
        create: { eventId: event.id, applicationId: target.id },
      });

      const body = Buffer.from(
        JSON.stringify({ event: event.payload, targetApplicationId: target.id }),
      );

      this.channel.publish(EVENTS_EXCHANGE, routingKeyForApp(target.clientId), body, {
        persistent: true,
        contentType: "application/json",
        messageId: event.id,
      });
    }

    await tx.event.update({
      where: { id: event.id },
      data: { status: "published", publishedAt: new Date() },
    });
  }
}
