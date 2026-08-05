import { buildApp } from "./app.js";
import { loadPanelEnv } from "./env.js";

const env = loadPanelEnv();
const app = buildApp(env);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error, "failed to start");
  process.exit(1);
}
