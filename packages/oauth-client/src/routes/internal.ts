import {
  EventType,
  RevokeReason,
  type GapuraEvent,
  type LogoutNotification,
  type LogoutNotificationResponse,
} from "@gapura/contracts";
import { verifyPayload } from "@gapura/crypto";
import type { FastifyInstance } from "fastify";
import {
  ActivityEvent,
  logActivity,
  revokeByCentralSession,
  revokeByUser,
  type LocalStore,
} from "../store.js";

async function applyEvent(
  store: LocalStore,
  event: GapuraEvent,
): Promise<{ revokedCount: number }> {
  switch (event.eventType) {
    case EventType.SessionRevoked:
      return {
        revokedCount: await revokeByCentralSession(
          store,
          event.centralSessionId,
          RevokeReason.SsoLogout,
        ),
      };
    case EventType.PasswordChanged:
      return {
        revokedCount: await revokeByUser(
          store,
          event.userId,
          RevokeReason.PasswordChanged,
        ),
      };
    case EventType.AccessPolicyChanged:
      return {
        revokedCount: await revokeByUser(
          store,
          event.userId,
          RevokeReason.AccessRevoked,
        ),
      };
  }
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  const { config, store } = app.rely;

  // The raw body is needed byte for byte: the signature covers exactly what was
  // sent, and re-serializing a parsed object would not reproduce it.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => done(null, { raw: body as string }),
  );

  app.post<{ Body: { raw: string } }>("/internal/logout", async (request, reply) => {
    const raw = request.body.raw ?? "";
    const timestamp = request.headers["x-gapura-timestamp"];
    const signature = request.headers["x-gapura-signature"];

    if (typeof timestamp !== "string" || typeof signature !== "string") {
      await logActivity(store, ActivityEvent.LogoutNotificationRejected, request.correlationId, {
        reason: "missing_signature_headers",
      });
      return reply.status(401).send({ error: "unauthorized" });
    }

    const verification = verifyPayload(
      config.logoutSigningSecret,
      timestamp,
      raw,
      signature,
    );
    if (!verification.valid) {
      await logActivity(store, ActivityEvent.LogoutNotificationRejected, request.correlationId, {
        reason: verification.reason ?? "invalid",
      });
      return reply.status(401).send({ error: "unauthorized" });
    }

    let notification: LogoutNotification;
    try {
      notification = JSON.parse(raw) as LogoutNotification;
    } catch {
      return reply.status(400).send({ error: "invalid payload" });
    }

    const event = notification.event;

    /**
     * Idempotency. The relay gives every application its own copy of one event,
     * all sharing a single eventId, so a redelivery lands here with an id that
     * is already present. Returning success without repeating the work is what
     * makes at-least-once delivery safe.
     */
    const seen = await store.processedEvent.findUnique({
      where: { eventId: event.eventId },
    });
    if (seen !== null) {
      const response: LogoutNotificationResponse = {
        result: "already_processed",
        revokedCount: 0,
      };
      return reply.send(response);
    }

    const { revokedCount } = await applyEvent(store, event);

    await store.processedEvent.create({
      data: {
        eventId: event.eventId,
        eventType: event.eventType,
        result:
          revokedCount > 0 ? `revoked ${revokedCount} local session(s)` : "no matching sessions",
        processedAt: new Date(),
      },
    });

    await logActivity(store, ActivityEvent.LogoutNotificationReceived, request.correlationId, {
      eventId: event.eventId,
      eventType: event.eventType,
      revokedCount,
    });

    const response: LogoutNotificationResponse = {
      result: revokedCount > 0 ? "revoked" : "no_matching_sessions",
      revokedCount,
    };
    return reply.send(response);
  });
}
