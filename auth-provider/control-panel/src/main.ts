import { gracefulShutdown } from "@gapura/lifecycle";
import { buildApp } from "./app.js";
import { loadPanelEnv } from "./env.js";

const env = loadPanelEnv();
const state = { draining: false };
const app = buildApp(env, () => state.draining);

gracefulShutdown({
  onEvent: (event) => app.log.info(event, "shutdown"),
  steps: [
    {
      name: "readiness",
      run: async () => {
        state.draining = true;
      },
    },
    { name: "http", run: () => app.close() },
    { name: "database", run: () => app.ctx.prisma.$disconnect() },
  ],
});

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error, "failed to start");
  process.exit(1);
}
