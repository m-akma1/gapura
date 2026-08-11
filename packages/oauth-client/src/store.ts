import { sha256Hex } from "@gapura/crypto";

type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  readonly [key: string]: JsonPrimitive | JsonObject | JsonArray;
}
type JsonArray = readonly (JsonPrimitive | JsonObject | JsonArray)[];

function toJsonInput(value: object): JsonObject {
  return value as JsonObject;
}

export interface LocalStore {
  localSession: {
    create(args: {
      data: {
        sessionTokenHash: string;
        externalUserId: string;
        centralSessionId: string;
        expiresAt: Date;
        lastActivityAt: Date;
      };
      select: { id: true; createdAt: true; expiresAt: true };
    }): Promise<{ id: string; createdAt: Date; expiresAt: Date }>;
    findUnique(args: {
      where: { sessionTokenHash: string };
    }): Promise<LocalSessionRow | null>;
    updateMany(args: {
      where: {
        status: "active";
        centralSessionId?: string;
        externalUserId?: string;
      };
      data: { status: "revoked"; revokedAt: Date; revokeReason: string };
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data:
        | { lastActivityAt: Date }
        | { status: "revoked"; revokedAt: Date; revokeReason: string };
    }): Promise<unknown>;
  };
  profileCache: {
    upsert(args: {
      where: { externalUserId: string };
      update: { name: string; email: string; groups: JsonArray; syncedAt: Date };
      create: {
        externalUserId: string;
        name: string;
        email: string;
        groups: JsonArray;
        syncedAt: Date;
      };
    }): Promise<unknown>;
    findUnique(args: {
      where: { externalUserId: string };
    }): Promise<ProfileRow | null>;
  };
  processedEvent: {
    findUnique(args: { where: { eventId: string } }): Promise<ProcessedRow | null>;
    create(args: {
      data: {
        eventId: string;
        eventType: string;
        result: string;
        processedAt: Date;
      };
    }): Promise<unknown>;
    findMany(args: {
      orderBy: { processedAt: "desc" };
      take: number;
    }): Promise<ProcessedRow[]>;
  };
  activityLog: {
    create(args: {
      data: {
        correlationId: string | null;
        event: string;
        detail: JsonObject;
      };
    }): Promise<unknown>;
    findMany(args: {
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<ActivityRow[]>;
  };
}

export interface LocalSessionRow {
  id: string;
  externalUserId: string;
  centralSessionId: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export interface ProfileRow {
  externalUserId: string;
  name: string;
  email: string;
  groups: unknown;
  syncedAt: Date;
}

export interface ProcessedRow {
  eventId: string;
  eventType: string;
  processedAt: Date;
  result: string;
}

export interface ActivityRow {
  id: string;
  correlationId: string | null;
  event: string;
  detail: unknown;
  createdAt: Date;
}

export const ActivityEvent = {
  RedirectToAuthorize: "redirect_to_authorize",
  CallbackReceived: "callback_received",
  StateRejected: "state_rejected",
  TokenExchanged: "token_exchanged",
  UserInfoFetched: "userinfo_fetched",
  LocalSessionCreated: "local_session_created",
  LocalLogout: "local_logout",
  LogoutNotificationReceived: "logout_received",
  LogoutNotificationRejected: "logout_rejected",
} as const;
export type ActivityEvent = (typeof ActivityEvent)[keyof typeof ActivityEvent];

export async function logActivity(
  store: LocalStore,
  event: ActivityEvent,
  correlationId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await store.activityLog.create({
    data: { correlationId, event, detail: toJsonInput(detail) },
  });
}

export interface CreatedLocalSession {
  token: string;
  id: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function createLocalSession(
  store: LocalStore,
  input: {
    token: string;
    externalUserId: string;
    centralSessionId: string;
    ttlSeconds: number;
  },
): Promise<CreatedLocalSession> {
  const row = await store.localSession.create({
    data: {
      sessionTokenHash: sha256Hex(input.token),
      externalUserId: input.externalUserId,
      centralSessionId: input.centralSessionId,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      lastActivityAt: new Date(),
    },
    select: { id: true, createdAt: true, expiresAt: true },
  });
  return { token: input.token, ...row };
}

export type SessionState =
  | { state: "none" }
  | { state: "expired"; row: LocalSessionRow }
  | { state: "revoked"; row: LocalSessionRow }
  | { state: "active"; row: LocalSessionRow };

export async function readLocalSession(
  store: LocalStore,
  token: string | undefined,
): Promise<SessionState> {
  if (token === undefined || token === "") return { state: "none" };

  const row = await store.localSession.findUnique({
    where: { sessionTokenHash: sha256Hex(token) },
  });
  if (row === null) return { state: "none" };
  if (row.status === "revoked" || row.revokedAt !== null) {
    return { state: "revoked", row };
  }
  if (row.expiresAt.getTime() <= Date.now()) return { state: "expired", row };
  if (row.status !== "active") return { state: "revoked", row };
  return { state: "active", row };
}

export async function touchLocalSession(
  store: LocalStore,
  id: string,
): Promise<void> {
  await store.localSession.update({
    where: { id },
    data: { lastActivityAt: new Date() },
  });
}

export async function revokeLocalSession(
  store: LocalStore,
  id: string,
  reason: string,
): Promise<void> {
  await store.localSession.update({
    where: { id },
    data: { status: "revoked", revokedAt: new Date(), revokeReason: reason },
  });
}

export async function revokeByCentralSession(
  store: LocalStore,
  centralSessionId: string,
  reason: string,
): Promise<number> {
  const result = await store.localSession.updateMany({
    where: { status: "active", centralSessionId },
    data: { status: "revoked", revokedAt: new Date(), revokeReason: reason },
  });
  return result.count;
}

export async function revokeByUser(
  store: LocalStore,
  externalUserId: string,
  reason: string,
): Promise<number> {
  const result = await store.localSession.updateMany({
    where: { status: "active", externalUserId },
    data: { status: "revoked", revokedAt: new Date(), revokeReason: reason },
  });
  return result.count;
}

export async function upsertProfile(
  store: LocalStore,
  profile: { sub: string; name: string; email: string; groups: string[] },
): Promise<void> {
  const now = new Date();
  await store.profileCache.upsert({
    where: { externalUserId: profile.sub },
    update: {
      name: profile.name,
      email: profile.email,
      groups: profile.groups,
      syncedAt: now,
    },
    create: {
      externalUserId: profile.sub,
      name: profile.name,
      email: profile.email,
      groups: profile.groups,
      syncedAt: now,
    },
  });
}
