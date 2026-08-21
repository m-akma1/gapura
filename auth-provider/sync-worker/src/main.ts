import { createPrismaClient } from "@gapura/auth-core";
import pino from "pino";
import { loadWorkerEnv } from "./env.js";
import { buildProbeServer, type ProbeState } from "./probes.js";
import { BrokerSession } from "./session.js";

const env = loadWorkerEnv();
const log = pino({ level: env.logLevel });
const prisma = createPrismaClient(env.databaseUrl);

const state: ProbeState = { channelOpen: false, draining: false };
const session = new BrokerSession(env, prisma, log, state);

const probes = buildProbeServer(env, prisma, state, () => session.isConsuming);
await probes.listen({ port: env.port, host: env.host });
log.info({ port: env.port }, "probe server listening");

await session.start();

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down");
  await probes.close().catch(() => undefined);
  await session.stop();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown());
}

log.info("sync worker ready");
