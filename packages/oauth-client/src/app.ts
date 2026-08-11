import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { errorHandler, health, requestId } from "@gapura/http-kit";
import Fastify, { type FastifyInstance } from "fastify";
import type { RelyingAppConfig } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHomeRoutes } from "./routes/home.js";
import { registerInternalRoutes } from "./routes/internal.js";
import type { LocalStore } from "./store.js";
import { renderPage } from "./views.js";

export interface RelyingAppContext {
  config: RelyingAppConfig;
  store: LocalStore;
}

declare module "fastify" {
  interface FastifyInstance {
    rely: RelyingAppContext;
  }
}

export function createRelyingApp(
  config: RelyingAppConfig,
  store: LocalStore,
): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
  });

  app.decorate("rely", { config, store });

  void app.register(cookie);
  void app.register(formbody);
  void app.register(requestId);
  void app.register(errorHandler, {
    renderPage: (reply, view) =>
      reply
        .type("text/html; charset=utf-8")
        .send(renderPage("error", view, { config, title: "Error" })),
  });

  void app.register(health, {
    checks: [
      {
        name: "database",
        run: async () => {
          await store.processedEvent.findMany({
            orderBy: { processedAt: "desc" },
            take: 1,
          });
        },
      },
    ],
  });

  void app.register(registerHomeRoutes);
  void app.register(registerAuthRoutes);
  void app.register(registerInternalRoutes);

  return app;
}

export async function runRelyingApp(
  config: RelyingAppConfig,
  store: LocalStore,
  onClose: () => Promise<void>,
): Promise<void> {
  const app = createRelyingApp(config, store);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void app
        .close()
        .then(onClose)
        .then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error, "failed to start");
    process.exit(1);
  }
}
