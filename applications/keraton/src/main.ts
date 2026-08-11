import { loadConfig, runRelyingApp } from "@gapura/oauth-client";
import { createPrismaClient } from "./db.js";

const config = loadConfig({
  name: "Keraton",
  title: "Keraton",
  tagline: "A palace behind the gate",
  accent: "#8a6d3b",
  envPrefix: "KERATON",
  sessionCookie: "keraton_sid",
  stateCookie: "keraton_oauth_state",
});

const prisma = createPrismaClient(config.databaseUrl);

await runRelyingApp(config, prisma, async () => {
  await prisma.$disconnect();
});
