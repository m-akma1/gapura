import { createPrismaClient } from "@gapura/auth-core";
import { gracefulShutdown } from "@gapura/lifecycle";
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

gracefulShutdown({
  onEvent: (event) => log.info(event, "shutdown"),
  steps: [
    {
      name: "readiness",
      run: async () => {
        state.draining = true;
      },
    },
    { name: "stop-consuming", run: () => session.stopConsuming() },
    {
      name: "drain",
      run: async () => {
        log.info({ inFlight: session.inFlightCount }, "draining deliveries");
        await session.drain();
      },
    },
    { name: "probes", run: () => probes.close() },
    { name: "broker", run: () => session.stop() },
    { name: "database", run: () => prisma.$disconnect() },
  ],
});

log.info("sync worker ready");
