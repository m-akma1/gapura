import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createPrismaClient, type PrismaClient } from "@gapura/auth-core";
import { errorHandler, health, metrics, requestId } from "@gapura/http-kit";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerEnv } from "./env.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAuthorizeRoutes } from "./routes/authorize.js";
import { registerHomeRoutes } from "./routes/home.js";
import { registerLogoutRoutes } from "./routes/logout.js";
import { registerTokenRoutes } from "./routes/token.js";
import { serverChecks } from "./routes/health.js";
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

export function buildApp(
  env: ServerEnv,
  isDraining: () => boolean = () => false,
): FastifyInstance {
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

  void app.register(metrics, {});
  void app.register(health, {
    isDraining,
    checks: serverChecks(app.ctx.prisma, env),
  });
  void app.register(registerHomeRoutes);
  void app.register(registerAuthRoutes);
  void app.register(registerAuthorizeRoutes);
  void app.register(registerTokenRoutes);
  void app.register(registerLogoutRoutes);

  app.addHook("onClose", async (instance) => {
    await instance.ctx.prisma.$disconnect();
  });

  return app;
}
