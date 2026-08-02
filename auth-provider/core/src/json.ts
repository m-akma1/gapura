import type { Prisma } from "./generated/client.js";

export function toJson(value: object): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
