import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the connection URL out of the datasource block and into here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "node dist/seed.js",
  },
});
