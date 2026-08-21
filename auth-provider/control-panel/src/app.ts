import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createPrismaClient, type PrismaClient } from "@gapura/auth-core";
import { errorHandler, health, requestId } from "@gapura/http-kit";
import Fastify, { type FastifyInstance } from "fastify";
import type { PanelEnv } from "./env.js";
import { registerGuard } from "./guard.js";
import { registerApplicationRoutes } from "./routes/applications.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerMembershipRoutes } from "./routes/membership.js";
import { registerUserRoutes } from "./routes/users.js";
import { renderPage } from "./views.js";

export interface PanelContext {
  env: PanelEnv;
  prisma: PrismaClient;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: PanelContext;
  }
}

export function buildApp(
  env: PanelEnv,
  isDraining: () => boolean = () => false,
): FastifyInstance {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,
  });

  app.decorate("ctx", { env, prisma: createPrismaClient(env.databaseUrl) });

  void app.register(cookie);
  void app.register(formbody);
  void app.register(requestId);
  void app.register(errorHandler, {
    renderPage: (reply, view) =>
      reply
        .type("text/html; charset=utf-8")
        .send(renderPage("error", view, { title: "Error" })),
  });

  void app.register(health, {
    isDraining,
    pathPrefix: "/admin",
    checks: [
      {
        name: "database",
        run: async () => {
          await app.ctx.prisma.$queryRaw`SELECT 1`;
        },
      },
    ],
  });

  void app.register(registerGuard);
  void app.register(registerDashboardRoutes);
  void app.register(registerUserRoutes);
  void app.register(registerGroupRoutes);
  void app.register(registerApplicationRoutes);
  void app.register(registerMembershipRoutes);

  app.addHook("onClose", async (instance) => {
    await instance.ctx.prisma.$disconnect();
  });

  return app;
}
