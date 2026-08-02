import type { Tx } from "./client.js";
import { toJson } from "./json.js";

export const AuditEvent = {
  LoginSucceeded: "login.succeeded",
  LoginFailed: "login.failed",
  AccessDenied: "access.denied",
  PolicyDenied: "policy.denied",
  AuthorizationCodeIssued: "authorization_code.issued",
  TokenIssued: "token.issued",
  UserInfoRead: "userinfo.read",
  Logout: "logout",
  PasswordChanged: "password.changed",
  UserCreated: "user.created",
  UserUpdated: "user.updated",
  UserActivated: "user.activated",
  UserDeactivated: "user.deactivated",
  GroupCreated: "group.created",
  GroupUpdated: "group.updated",
  GroupDeleted: "group.deleted",
  GroupMemberAdded: "group.member_added",
  GroupMemberRemoved: "group.member_removed",
  ApplicationCreated: "application.created",
  ApplicationUpdated: "application.updated",
  ApplicationSecretRotated: "application.secret_rotated",
  PolicyCreated: "policy.created",
  PolicyDeleted: "policy.deleted",
  SessionRevoked: "session.revoked",
} as const;
export type AuditEvent = (typeof AuditEvent)[keyof typeof AuditEvent];

export const AuditResult = {
  Success: "success",
  Failed: "failed",
} as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

export interface AuditInput {
  eventType: AuditEvent;
  result: AuditResult;
  actorId?: string | null;
  userId?: string | null;
  applicationId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  correlationId?: string | undefined;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  const metadata: Record<string, unknown> = { ...input.metadata };
  if (input.correlationId !== undefined) {
    metadata["correlationId"] = input.correlationId;
  }

  await tx.auditLog.create({
    data: {
      eventType: input.eventType,
      result: input.result,
      actorId: input.actorId ?? null,
      userId: input.userId ?? null,
      applicationId: input.applicationId ?? null,
      sessionId: input.sessionId ?? null,
      ipAddress: input.ipAddress ?? null,
      metadata: toJson(metadata),
    },
  });
}
