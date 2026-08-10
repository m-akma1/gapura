import { writeFile } from "node:fs/promises";
import { createPrismaClient } from "@gapura/auth-core";
import pino from "pino";
import { connectWithRetry, openChannel } from "./broker.js";
import { loadWorkerEnv } from "./env.js";
import { DeliveryConsumer } from "./consumer.js";
import { OutboxRelay } from "./relay.js";
import { declareTopology, routingKeyForApp } from "./topology.js";

const env = loadWorkerEnv();
const log = pino({ level: env.logLevel });
const prisma = createPrismaClient(env.databaseUrl);

const connection = await connectWithRetry(env.amqpUrl, log);
const channel = await openChannel(connection);

const applications = await prisma.application.findMany({
  select: { clientId: true },
  orderBy: { clientId: "asc" },
});
const routingKeys = applications.map((app) => routingKeyForApp(app.clientId));

await declareTopology(channel, routingKeys);
log.info({ routingKeys }, "topology declared");

async function markAlive(): Promise<void> {
  await writeFile(env.livenessFile, new Date().toISOString(), "utf8");
}
await markAlive();

const relay = new OutboxRelay(
  prisma,
  channel,
  log,
  { intervalMs: env.outboxPollIntervalMs, batchSize: env.outboxBatchSize },
  () => void markAlive(),
);
relay.start();
log.info({ intervalMs: env.outboxPollIntervalMs }, "outbox relay started");

const consumer = new DeliveryConsumer(prisma, channel, log, env);
for (const key of routingKeys) {
  await consumer.consume(`q.${key}`);
}

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down");
  await relay.stop();
  await channel.close().catch(() => undefined);
  await connection.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown());
}

const heartbeat = setInterval(() => void markAlive(), 5000);
heartbeat.unref();

log.info("sync worker ready");
