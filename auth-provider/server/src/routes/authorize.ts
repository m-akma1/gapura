import {
  AuditEvent,
  AuditResult,
  DenialReason,
  evaluateAuthorization,
  writeAudit,
} from "@gapura/auth-core";
import { ErrorCode, ErrorMessage } from "@gapura/contracts";
import { randomToken, sha256Hex } from "@gapura/crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { currentSession } from "../session-context.js";
import { renderPage } from "../views.js";

interface AuthorizeQuery {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  response_type?: string;
}

const RENDER_LOCALLY = new Set<string>([
  DenialReason.UnknownClient,
  DenialReason.ApplicationInactive,
  DenialReason.RedirectUriNotRegistered,
]);

function localError(
  reply: FastifyReply,
  requestId: string,
  message: string,
  status = 400,
): unknown {
  return reply
    .status(status)
    .type("text/html; charset=utf-8")
    .send(
      renderPage(
        "error",
        { message, requestId, code: ErrorCode.InvalidRequest, status },
        { title: "Error" },
      ),
    );
}

export async function registerAuthorizeRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, env } = app.ctx;

  app.get<{ Querystring: AuthorizeQuery }>("/authorize", async (request, reply) => {
    const clientId = request.query.client_id ?? "";
    const redirectUri = request.query.redirect_uri ?? "";
    const state = request.query.state ?? "";
    const responseType = request.query.response_type ?? "code";

    if (clientId === "" || redirectUri === "") {
      return localError(reply, request.correlationId, ErrorMessage.InvalidRequest);
    }

    const context = await currentSession(request);
    if (context === null) {
      // Not signed in: collect credentials, then resume this exact request.
      const resume = `/authorize${new URL(request.url, env.authIssuer).search}`;
      return reply.redirect(`/login?next=${encodeURIComponent(resume)}`);
    }

    const evaluation = await evaluateAuthorization(prisma, {
      clientId,
      redirectUri,
      userId: context.session.userId,
    });

    if (!evaluation.ok) {
      await writeAudit(prisma, {
        eventType:
          evaluation.reason === DenialReason.NoPolicy
            ? AuditEvent.PolicyDenied
            : AuditEvent.AccessDenied,
        result: AuditResult.Failed,
        userId: context.session.userId,
        actorId: context.session.userId,
        applicationId: evaluation.application?.id ?? null,
        sessionId: context.session.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
        // The internal reason is recorded here and never shown to the client.
        metadata: { reason: evaluation.reason, clientId },
      });

      if (RENDER_LOCALLY.has(evaluation.reason)) {
        return localError(
          reply,
          request.correlationId,
          ErrorMessage.InvalidRequest,
        );
      }

      const denied = new URL(redirectUri);
      denied.searchParams.set("error", "access_denied");
      if (state !== "") denied.searchParams.set("state", state);
      return reply.redirect(denied.toString());
    }

    if (responseType !== "code") {
      const unsupported = new URL(redirectUri);
      unsupported.searchParams.set("error", "unsupported_response_type");
      if (state !== "") unsupported.searchParams.set("state", state);
      return reply.redirect(unsupported.toString());
    }

    const code = randomToken();
    await prisma.$transaction(async (tx) => {
      await tx.authorizationCode.create({
        data: {
          codeHash: sha256Hex(code),
          userId: context.session.userId,
          applicationId: evaluation.application.id,
          ssoSessionId: context.session.id,
          redirectUri,
          expiresAt: new Date(Date.now() + env.authCodeTtlSeconds * 1000),
        },
      });
      await writeAudit(tx, {
        eventType: AuditEvent.AuthorizationCodeIssued,
        result: AuditResult.Success,
        userId: context.session.userId,
        actorId: context.session.userId,
        applicationId: evaluation.application.id,
        sessionId: context.session.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });
    });

    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state !== "") target.searchParams.set("state", state);
    return reply.redirect(target.toString());
  });
}
