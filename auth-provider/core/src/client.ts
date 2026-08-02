import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export type { PrismaClient };

/** Prisma 7 requires a driver adapter; there is no built-in connection path. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

/**
 * What an interactive transaction callback receives. Every domain service takes
 * this rather than the client, so callers decide the transaction boundary and a
 * revocation plus its outbox row always commit together.
 */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
