import { randomUUID } from "node:crypto";
import {
  EventType,
  type GapuraEvent,
  type RevokeReason,
} from "@gapura/contracts";
import type { Tx } from "./client.js";
import { toJson } from "./json.js";

interface EmitBase {
  userId: string;
  reason: RevokeReason;
  correlationId?: string | undefined;
  metadata?: Record<string, unknown>;
}

export interface EmitSessionRevoked extends EmitBase {
  eventType: typeof EventType.SessionRevoked;
  centralSessionId: string;
}

export interface EmitPasswordChanged extends EmitBase {
  eventType: typeof EventType.PasswordChanged;
}

export interface EmitAccessPolicyChanged extends EmitBase {
  eventType: typeof EventType.AccessPolicyChanged;
  applicationId: string;
}

export type EmitEventInput =
  | EmitSessionRevoked
  | EmitPasswordChanged
  | EmitAccessPolicyChanged;

export async function emitEvent(tx: Tx, input: EmitEventInput): Promise<string> {
  const eventId = randomUUID();
  const occurredAt = new Date();

  const metadata: Record<string, unknown> = { ...input.metadata };
  if (input.correlationId !== undefined) {
    metadata["correlationId"] = input.correlationId;
  }

  const centralSessionId =
    input.eventType === EventType.SessionRevoked ? input.centralSessionId : null;
  const applicationId =
    input.eventType === EventType.AccessPolicyChanged ? input.applicationId : null;

  const payload = {
    eventId,
    eventType: input.eventType,
    userId: input.userId,
    centralSessionId,
    applicationId,
    reason: input.reason,
    occurredAt: occurredAt.toISOString(),
    metadata,
  } as GapuraEvent;

  await tx.event.create({
    data: {
      id: eventId,
      eventType: input.eventType,
      userId: input.userId,
      centralSessionId,
      applicationId,
      payload: toJson(payload),
      createdAt: occurredAt,
    },
  });

  return eventId;
}
