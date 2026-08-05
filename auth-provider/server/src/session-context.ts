import { isAdministrator, validateSessionToken, type ValidSession } from "@gapura/auth-core";
import type { FastifyRequest } from "fastify";
import { SSO_COOKIE } from "./cookies.js";

export interface SessionContext {
  session: ValidSession;
  isAdmin: boolean;
}

export async function currentSession(
  request: FastifyRequest,
): Promise<SessionContext | null> {
  const token = request.cookies[SSO_COOKIE];
  if (token === undefined || token === "") return null;

  const prisma = request.server.ctx.prisma;
  const session = await validateSessionToken(prisma, token);
  if (session === null) return null;

  return { session, isAdmin: await isAdministrator(prisma, session.userId) };
}

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}
