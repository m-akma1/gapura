import type { RevokeReason } from "./enums.js";

export const EventType = {
  SessionRevoked: "SessionRevoked",
  PasswordChanged: "PasswordChanged",
  AccessPolicyChanged: "AccessPolicyChanged",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export interface EventMetadata {
  correlationId?: string;
  [key: string]: unknown;
}

interface EventBase {
  eventId: string;
  userId: string;
  occurredAt: string;
  reason: RevokeReason;
  metadata: EventMetadata;
}

export interface SessionRevokedEvent extends EventBase {
  eventType: typeof EventType.SessionRevoked;
  centralSessionId: string;
  applicationId: null;
}

export interface PasswordChangedEvent extends EventBase {
  eventType: typeof EventType.PasswordChanged;
  centralSessionId: null;
  applicationId: null;
}

export interface AccessPolicyChangedEvent extends EventBase {
  eventType: typeof EventType.AccessPolicyChanged;
  centralSessionId: null;
  applicationId: string;
}

export type GapuraEvent =
  | SessionRevokedEvent
  | PasswordChangedEvent
  | AccessPolicyChangedEvent;

export interface LogoutNotification {
  event: GapuraEvent;
  targetApplicationId: string;
}

export interface LogoutNotificationResponse {
  result: "revoked" | "no_matching_sessions" | "already_processed";
  revokedCount: number;
}
