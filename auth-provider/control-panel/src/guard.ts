import {
  isAdministrator,
  validateSessionToken,
  type ValidSession,
} from "@gapura/auth-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { renderPage } from "./views.js";

export const SSO_COOKIE = "gapura_sso";

declare module "fastify" {
  interface FastifyRequest {
    admin: ValidSession;
  }
}

const PUBLIC_PATHS = new Set(["/admin/health/live", "/admin/health/ready"]);

async function guardPlugin(app: FastifyInstance): Promise<void> {
  const { prisma, env } = app.ctx;

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(request.url.split("?")[0] ?? "")) return;

    const token = request.cookies[SSO_COOKIE];
    const session =
      token === undefined || token === ""
        ? null
        : await validateSessionToken(prisma, token);

    if (session === null) {
      const next = encodeURIComponent(request.url);
      return reply.redirect(`${env.authIssuer}/login?next=${next}`);
    }

    if (!(await isAdministrator(prisma, session.userId))) {
      return reply
        .status(403)
        .type("text/html; charset=utf-8")
        .send(
          renderPage(
            "forbidden",
            {},
            { title: "Not permitted", currentUser: session.user },
          ),
        );
    }

    request.admin = session;
  });
}

export const registerGuard = fp(guardPlugin, { name: "gapura-admin-guard" });
