import { checkRabbitHealth, type CheckDefinition } from "@gapura/lifecycle";
import type { PrismaClient } from "@gapura/auth-core";
import type { ServerEnv } from "../env.js";

export function serverChecks(
  prisma: PrismaClient,
  env: ServerEnv,
): CheckDefinition[] {
  return [
    {
      name: "database",
      run: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
    },
    {
      name: "broker",
      run: () => checkRabbitHealth(env.rabbitManagement),
    },
  ];
}
