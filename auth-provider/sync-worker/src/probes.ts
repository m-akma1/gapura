import type { PrismaClient } from "@gapura/auth-core";
import { health } from "@gapura/http-kit";
import { checkRabbitHealth } from "@gapura/lifecycle";
import Fastify, { type FastifyInstance } from "fastify";
import type { WorkerEnv } from "./env.js";

export interface ProbeState {
  channelOpen: boolean;
  draining: boolean;
}

export function buildProbeServer(
  env: WorkerEnv,
  prisma: PrismaClient,
  state: ProbeState,
  isConsuming: () => boolean,
): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(health, {
    isDraining: () => state.draining,
    checks: [
      {
        name: "database",
        run: async () => {
          await prisma.$queryRaw`SELECT 1`;
        },
      },
      {
        name: "broker",
        run: () => checkRabbitHealth(env.rabbitManagement),
      },
      {
        name: "consumer",
        run: async () => {
          if (!state.channelOpen) throw new Error("channel closed");
          if (!isConsuming()) throw new Error("not consuming");
        },
      },
    ],
  });

  return app;
}
