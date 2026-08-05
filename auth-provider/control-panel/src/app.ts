import { createPrismaClient } from "@gapura/auth-core";
import Fastify, { type FastifyInstance } from "fastify";
import type { PanelEnv } from "./env.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: PanelContext;
  }
}

export function buildApp(env: PanelEnv): FastifyInstance {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,
  });

  app.decorate("ctx", { env, prisma: createPrismaClient(env.databaseUrl) });
  return app;
}
