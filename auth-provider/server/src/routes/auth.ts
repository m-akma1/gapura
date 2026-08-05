import {
  AuditEvent,
  AuditResult,
  createSession,
  writeAudit,
} from "@gapura/auth-core";
import { ErrorMessage } from "@gapura/contracts";
import { verifyPassword } from "@gapura/crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { setSsoCookie } from "../cookies.js";
import { currentSession, safeNextPath } from "../session-context.js";
import { renderPage } from "../views.js";

interface LoginBody {
  email?: string;
  password?: string;
  next?: string;
}

function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, env } = app.ctx;

  app.get("/login", async (request, reply) => {
    const context = await currentSession(request);
    const next = safeNextPath((request.query as { next?: string }).next);

    if (context !== null) {
      return reply.redirect(next ?? "/");
    }

    return reply
      .type("text/html; charset=utf-8")
      .send(
        renderPage(
          "login",
          { error: null, email: "", next },
          { title: "Sign in" },
        ),
      );
  });

  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    const email = (request.body.email ?? "").trim().toLowerCase();
    const password = request.body.password ?? "";
    const next = safeNextPath(request.body.next);

    const renderFailure = (): unknown =>
      reply
        .status(401)
        .type("text/html; charset=utf-8")
        .send(
          renderPage(
            "login",
            { error: ErrorMessage.InvalidCredentials, email, next },
            { title: "Sign in" },
          ),
        );

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, status: true },
    });

    if (user === null) {
      // Hash throwaway value for time sync
      await verifyPassword(
        "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$Zm9vYmFyYmF6cXV4",
        password,
      );
      await writeAudit(prisma, {
        eventType: AuditEvent.LoginFailed,
        result: AuditResult.Failed,
        ipAddress: clientIp(request),
        correlationId: request.correlationId,
        metadata: { reason: "unknown_email" },
      });
      return renderFailure();
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk || user.status !== "active") {
      await writeAudit(prisma, {
        eventType: AuditEvent.LoginFailed,
        result: AuditResult.Failed,
        userId: user.id,
        ipAddress: clientIp(request),
        correlationId: request.correlationId,
        metadata: { reason: passwordOk ? "user_inactive" : "bad_password" },
      });
      return renderFailure();
    }

    const created = await prisma.$transaction(async (tx) => {
      const session = await createSession(tx, {
        userId: user.id,
        ttlSeconds: env.centralSessionTtlSeconds,
        ipAddress: clientIp(request),
        userAgent: request.headers["user-agent"],
      });
      await writeAudit(tx, {
        eventType: AuditEvent.LoginSucceeded,
        result: AuditResult.Success,
        userId: user.id,
        actorId: user.id,
        sessionId: session.id,
        ipAddress: clientIp(request),
        correlationId: request.correlationId,
      });
      return session;
    });

    setSsoCookie(reply, created.token, created.expiresAt);
    return reply.redirect(next ?? "/");
  });
}
