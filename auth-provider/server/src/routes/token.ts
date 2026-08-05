import {
  AuditEvent,
  AuditResult,
  groupNamesForUser,
  writeAudit,
} from "@gapura/auth-core";
import {
  AUTHORIZATION_CODE_GRANT,
  ErrorCode,
  ErrorMessage,
  GapuraError,
  type TokenResponse,
  type UserInfoResponse,
} from "@gapura/contracts";
import { constantTimeEqual, randomToken, sha256Hex, verifyPassword } from "@gapura/crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface TokenBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
}

function clientCredentials(
  request: FastifyRequest<{ Body: TokenBody }>,
): { clientId: string; clientSecret: string } | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  }

  const { client_id: clientId, client_secret: clientSecret } = request.body;
  if (clientId === undefined || clientSecret === undefined) return null;
  return { clientId, clientSecret };
}

export async function registerTokenRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, env } = app.ctx;

  app.post<{ Body: TokenBody }>("/token", async (request) => {
    if ((request.body.grant_type ?? "") !== AUTHORIZATION_CODE_GRANT) {
      throw new GapuraError(
        ErrorCode.UnsupportedGrantType,
        ErrorMessage.InvalidRequest,
      );
    }

    const credentials = clientCredentials(request);
    if (credentials === null) {
      throw new GapuraError(ErrorCode.InvalidClient, ErrorMessage.InvalidClient);
    }

    const application = await prisma.application.findUnique({
      where: { clientId: credentials.clientId },
      select: { id: true, status: true, clientSecretHash: true },
    });

    if (
      application === null ||
      application.clientSecretHash === null ||
      !(await verifyPassword(application.clientSecretHash, credentials.clientSecret))
    ) {
      throw new GapuraError(ErrorCode.InvalidClient, ErrorMessage.InvalidClient);
    }
    if (application.status !== "active") {
      throw new GapuraError(ErrorCode.InvalidClient, ErrorMessage.InvalidClient);
    }

    const code = request.body.code ?? "";
    const redirectUri = request.body.redirect_uri ?? "";

    const issued = await prisma.$transaction(async (tx) => {
      const record = await tx.authorizationCode.findUnique({
        where: { codeHash: sha256Hex(code) },
        select: {
          id: true,
          userId: true,
          applicationId: true,
          ssoSessionId: true,
          redirectUri: true,
          expiresAt: true,
          usedAt: true,
          ssoSession: { select: { status: true, expiresAt: true, revokedAt: true } },
          user: { select: { status: true } },
        },
      });

      const invalid: () => never = () => {
        throw new GapuraError(ErrorCode.InvalidGrant, ErrorMessage.InvalidGrant);
      };

      if (record === null) invalid();
      if (record.usedAt !== null) invalid();
      if (record.expiresAt.getTime() <= Date.now()) invalid();
      if (record.applicationId !== application.id) invalid();
      if (!constantTimeEqual(record.redirectUri, redirectUri)) invalid();
      if (record.user.status !== "active") invalid();
      if (
        record.ssoSession.status !== "active" ||
        record.ssoSession.revokedAt !== null ||
        record.ssoSession.expiresAt.getTime() <= Date.now()
      ) {
        invalid();
      }

      const claimed = await tx.authorizationCode.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) invalid();

      const token = randomToken();
      const expiresAt = new Date(Date.now() + env.accessTokenTtlSeconds * 1000);
      await tx.accessToken.create({
        data: {
          tokenHash: sha256Hex(token),
          userId: record.userId,
          applicationId: application.id,
          ssoSessionId: record.ssoSessionId,
          expiresAt,
        },
      });

      await writeAudit(tx, {
        eventType: AuditEvent.TokenIssued,
        result: AuditResult.Success,
        userId: record.userId,
        applicationId: application.id,
        sessionId: record.ssoSessionId,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });

      return { token, ssoSessionId: record.ssoSessionId };
    });

    const response: TokenResponse = {
      access_token: issued.token,
      token_type: "Bearer",
      expires_in: env.accessTokenTtlSeconds,
      sso_session_id: issued.ssoSessionId,
    };
    return response;
  });

  app.get("/userinfo", async (request) => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new GapuraError(ErrorCode.InvalidToken, ErrorMessage.InvalidToken);
    }

    const record = await prisma.accessToken.findUnique({
      where: { tokenHash: sha256Hex(header.slice(7)) },
      select: {
        userId: true,
        applicationId: true,
        status: true,
        expiresAt: true,
        ssoSession: { select: { status: true, expiresAt: true, revokedAt: true } },
        user: { select: { id: true, name: true, email: true, status: true } },
      },
    });

    const invalid: () => never = () => {
      throw new GapuraError(ErrorCode.InvalidToken, ErrorMessage.InvalidToken);
    };

    if (record === null) invalid();
    if (record.status !== "active") invalid();
    if (record.expiresAt.getTime() <= Date.now()) invalid();
    if (record.user.status !== "active") invalid();
    if (
      record.ssoSession.status !== "active" ||
      record.ssoSession.revokedAt !== null ||
      record.ssoSession.expiresAt.getTime() <= Date.now()
    ) {
      invalid();
    }

    await writeAudit(prisma, {
      eventType: AuditEvent.UserInfoRead,
      result: AuditResult.Success,
      userId: record.userId,
      applicationId: record.applicationId,
      ipAddress: request.ip,
      correlationId: request.correlationId,
    });

    const response: UserInfoResponse = {
      sub: record.user.id,
      name: record.user.name,
      email: record.user.email,
      groups: await groupNamesForUser(prisma, record.userId),
    };
    return response;
  });
}
