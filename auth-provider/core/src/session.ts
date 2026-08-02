import { RevokeReason, SessionStatus } from "@gapura/contracts";
import { randomToken, sha256Hex } from "@gapura/crypto";
import type { Tx } from "./client.js";

export interface CreateSessionInput {
  userId: string;
  ttlSeconds: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

export async function createSession(
  tx: Tx,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

  const session = await tx.ssoSession.create({
    data: {
      userId: input.userId,
      sessionTokenHash: sha256Hex(token),
      expiresAt,
      lastActivityAt: new Date(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });

  return { id: session.id, token, expiresAt };
}

export interface ValidSession {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  user: { id: string; name: string; email: string };
}

export async function validateSessionToken(
  tx: Tx,
  token: string,
): Promise<ValidSession | null> {
  const session = await tx.ssoSession.findUnique({
    where: { sessionTokenHash: sha256Hex(token) },
    select: {
      id: true,
      userId: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      revokedAt: true,
      user: { select: { id: true, name: true, email: true, status: true } },
    },
  });

  if (session === null) return null;
  if (session.status !== SessionStatus.Active) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "active") return null;

  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
  };
}

export async function touchSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.ssoSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });
}

export async function revokeSession(
  tx: Tx,
  sessionId: string,
  reason: RevokeReason,
): Promise<boolean> {
  const now = new Date();

  const result = await tx.ssoSession.updateMany({
    where: { id: sessionId, status: SessionStatus.Active },
    data: {
      status: SessionStatus.Revoked,
      revokedAt: now,
      revokeReason: reason,
    },
  });

  if (result.count === 0) return false;

  await tx.accessToken.updateMany({
    where: { ssoSessionId: sessionId, status: "active" },
    data: { status: "revoked", revokedAt: now },
  });

  return true;
}

export async function revokeAllUserSessions(
  tx: Tx,
  userId: string,
  reason: RevokeReason,
): Promise<string[]> {
  const sessions = await tx.ssoSession.findMany({
    where: { userId, status: SessionStatus.Active },
    select: { id: true },
  });

  const revoked: string[] = [];
  for (const session of sessions) {
    if (await revokeSession(tx, session.id, reason)) {
      revoked.push(session.id);
    }
  }
  return revoked;
}
