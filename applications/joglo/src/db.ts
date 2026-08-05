import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export type { PrismaClient };

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
