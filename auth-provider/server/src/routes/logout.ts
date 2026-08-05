import {
  AuditEvent,
  AuditResult,
  emitEvent,
  revokeAllUserSessions,
  revokeSession,
  writeAudit,
} from "@gapura/auth-core";
import { ErrorMessage, EventType, RevokeReason } from "@gapura/contracts";
import { hashPassword, verifyPassword } from "@gapura/crypto";
import type { FastifyInstance } from "fastify";
import { clearSsoCookie } from "../cookies.js";
import { currentSession } from "../session-context.js";
import { renderPage } from "../views.js";

interface PasswordBody {
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
}

export async function registerLogoutRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.ctx;

  /**
   * SSO logout. Revokes exactly one central session, the one this browser
   * holds, and emits SessionRevoked carrying its id. Sessions in other browsers
   * survive, which is what makes the event's matching rule observable.
   */
  app.post("/logout", async (request, reply) => {
    const context = await currentSession(request);
    if (context === null) {
      clearSsoCookie(reply);
      return reply.redirect("/");
    }

    await prisma.$transaction(async (tx) => {
      const revoked = await revokeSession(
        tx,
        context.session.id,
        RevokeReason.SsoLogout,
      );
      if (!revoked) return;

      await emitEvent(tx, {
        eventType: EventType.SessionRevoked,
        userId: context.session.userId,
        centralSessionId: context.session.id,
        reason: RevokeReason.SsoLogout,
        correlationId: request.correlationId,
      });

      await writeAudit(tx, {
        eventType: AuditEvent.Logout,
        result: AuditResult.Success,
        userId: context.session.userId,
        actorId: context.session.userId,
        sessionId: context.session.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });
    });

    clearSsoCookie(reply);
    return reply.redirect("/");
  });

  app.get("/password", async (request, reply) => {
    const context = await currentSession(request);
    if (context === null) {
      return reply.redirect("/login?next=%2Fpassword");
    }
    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "password",
        { error: null },
        {
          title: "Change password",
          currentUser: context.session.user,
          isAdmin: context.isAdmin,
        },
      ),
    );
  });

  /**
   * Self-service only. Admins can activate and deactivate users but cannot set
   * passwords.
   *
   * A successful change revokes every central session for the user, including
   * the one performing the change, and emits one PasswordChanged event.
   */
  app.post<{ Body: PasswordBody }>("/password", async (request, reply) => {
    const context = await currentSession(request);
    if (context === null) {
      return reply.redirect("/login?next=%2Fpassword");
    }

    const current = request.body.current_password ?? "";
    const next = request.body.new_password ?? "";
    const confirm = request.body.confirm_password ?? "";

    const fail = (message: string): unknown =>
      reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(
          renderPage(
            "password",
            { error: message },
            {
              title: "Change password",
              currentUser: context.session.user,
              isAdmin: context.isAdmin,
            },
          ),
        );

    if (next.length < 8) {
      return fail("New password must be at least 8 characters");
    }
    if (next !== confirm) {
      return fail("New password and confirmation do not match");
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: context.session.userId },
      select: { id: true, passwordHash: true },
    });

    if (!(await verifyPassword(user.passwordHash, current))) {
      await writeAudit(prisma, {
        eventType: AuditEvent.PasswordChanged,
        result: AuditResult.Failed,
        userId: user.id,
        actorId: user.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });
      return fail(ErrorMessage.InvalidCredentials);
    }

    const newHash = await hashPassword(next);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });

      await revokeAllUserSessions(tx, user.id, RevokeReason.PasswordChanged);

      // One event for the user, not one per session: the consumers match
      // PasswordChanged on user id and destroy every local session they hold.
      await emitEvent(tx, {
        eventType: EventType.PasswordChanged,
        userId: user.id,
        reason: RevokeReason.PasswordChanged,
        correlationId: request.correlationId,
      });

      await writeAudit(tx, {
        eventType: AuditEvent.PasswordChanged,
        result: AuditResult.Success,
        userId: user.id,
        actorId: user.id,
        sessionId: context.session.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });
    });

    clearSsoCookie(reply);
    return reply.redirect("/login");
  });
}
