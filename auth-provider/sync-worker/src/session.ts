import type { PrismaClient } from "@gapura/auth-core";
import type { ChannelModel, Channel } from "amqplib";
import type { Logger } from "pino";
import { connectWithRetry, openChannel } from "./broker.js";
import { DeliveryConsumer } from "./consumer.js";
import type { WorkerEnv } from "./env.js";
import type { ProbeState } from "./probes.js";
import { OutboxRelay } from "./relay.js";
import { declareTopology, routingKeyForApp } from "./topology.js";

export class BrokerSession {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private relay: OutboxRelay | undefined;
  private consumer: DeliveryConsumer | undefined;
  private closing = false;
  private restarting = false;

  constructor(
    private readonly env: WorkerEnv,
    private readonly prisma: PrismaClient,
    private readonly log: Logger,
    private readonly state: ProbeState,
  ) {}

  get isConsuming(): boolean {
    return this.consumer?.isConsuming === true;
  }

  async start(): Promise<void> {
    const connection = await connectWithRetry(this.env.amqpUrl, this.log);
    const channel = await openChannel(connection);

    this.connection = connection;
    this.channel = channel;
    this.state.channelOpen = true;

    // Queues are declared per registered application, so adding one through the
    // control panel needs no topology change here beyond a restart.
    const applications = await this.prisma.application.findMany({
      select: { clientId: true },
      orderBy: { clientId: "asc" },
    });
    const routingKeys = applications.map((app) => routingKeyForApp(app.clientId));

    await declareTopology(channel, routingKeys);
    this.log.info({ routingKeys }, "topology declared");

    this.relay = new OutboxRelay(this.prisma, channel, this.log, {
      intervalMs: this.env.outboxPollIntervalMs,
      batchSize: this.env.outboxBatchSize,
    });
    this.relay.start();

    this.consumer = new DeliveryConsumer(this.prisma, channel, this.log, this.env);
    for (const key of routingKeys) {
      await this.consumer.consume(`q.${key}`);
    }

    const onLost = (reason: string): void => {
      this.state.channelOpen = false;
      if (this.closing) return;
      this.log.warn({ reason }, "broker connection lost, rebuilding session");
      void this.restart();
    };

    channel.on("close", () => onLost("channel closed"));
    channel.on("error", () => onLost("channel error"));
    connection.on("close", () => onLost("connection closed"));
    connection.on("error", () => onLost("connection error"));
  }

  private async restart(): Promise<void> {
    if (this.restarting || this.closing) return;
    this.restarting = true;
    try {
      await this.disposeCurrent();
      await this.start();
      this.log.info("broker session rebuilt");
    } catch (error) {
      this.log.error({ err: error }, "failed to rebuild broker session");
    } finally {
      this.restarting = false;
    }
  }

  /** Drops references without closing, since the transport is already gone. */
  private async disposeCurrent(): Promise<void> {
    await this.relay?.stop();
    this.relay = undefined;
    this.consumer = undefined;
    this.channel = undefined;
    this.connection = undefined;
  }

  async stop(): Promise<void> {
    this.closing = true;
    await this.relay?.stop();
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.state.channelOpen = false;
  }
}
