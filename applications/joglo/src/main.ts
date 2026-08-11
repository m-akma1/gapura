import { loadConfig, runRelyingApp } from "@gapura/oauth-client";
import { createPrismaClient } from "./db.js";

const config = loadConfig({
  name: "Joglo",
  title: "Joglo",
  tagline: "A house behind the gate",
  accent: "#376b6d",
  envPrefix: "JOGLO",
  sessionCookie: "joglo_sid",
  stateCookie: "joglo_oauth_state",
});

const prisma = createPrismaClient(config.databaseUrl);

await runRelyingApp(config, prisma, async () => {
  await prisma.$disconnect();
});
