import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createPrismaClient, type PrismaClient } from "@gapura/auth-core";
import { errorHandler, requestId } from "@gapura/http-kit";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerEnv } from "./env.js";
import { registerHomeRoutes } from "./routes/home.js";
import { registerHealthRoutes } from "./routes/health.js";
import { renderPage } from "./views.js";

export interface AppContext {
  env: ServerEnv;
  prisma: PrismaClient;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export function buildApp(env: ServerEnv): FastifyInstance {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,
    disableRequestLogging: false,
  });

  app.decorate("ctx", {
    env,
    prisma: createPrismaClient(env.databaseUrl),
  });

  void app.register(cookie);
  void app.register(formbody);
  void app.register(requestId);
  void app.register(errorHandler, {
    renderPage: (reply, view) =>
      reply
        .type("text/html; charset=utf-8")
        .send(
          renderPage("error", view, { title: "Error", activeNav: undefined }),
        ),
  });

  void app.register(registerHealthRoutes);
  void app.register(registerHomeRoutes);

  app.addHook("onClose", async (instance) => {
    await instance.ctx.prisma.$disconnect();
  });

  return app;
}
