import { constantTimeEqual, randomToken } from "@gapura/crypto";
import type { FastifyInstance } from "fastify";
import { STATE_COOKIE_TTL_SECONDS } from "../config.js";
import {
  ActivityEvent,
  createLocalSession,
  logActivity,
  readLocalSession,
  revokeLocalSession,
  upsertProfile,
} from "../store.js";
import { buildAuthorizeUrl, exchangeCode, fetchUserInfo } from "../oauth.js";
import { renderPage } from "../views.js";

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { config, store } = app.rely;

  app.get("/login", async (request, reply) => {
    const state = randomToken();

    void reply.setCookie(config.stateCookie, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: STATE_COOKIE_TTL_SECONDS,
    });

    await logActivity(store, ActivityEvent.RedirectToAuthorize, request.correlationId, {
      clientId: config.clientId,
    });

    return reply.redirect(buildAuthorizeUrl(config, state));
  });

  app.get<{ Querystring: CallbackQuery }>("/callback", async (request, reply) => {
    const { code, state, error } = request.query;
    const expected = request.cookies[config.stateCookie];

    await logActivity(store, ActivityEvent.CallbackReceived, request.correlationId, {
      hasCode: code !== undefined,
      error: error ?? null,
    });

    const fail = (message: string): unknown =>
      reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(
          renderPage(
            "error",
            { message, requestId: request.correlationId },
            { config, title: "Sign in failed" },
          ),
        );

    if (error !== undefined) {
      return fail("You do not have access to this application");
    }

    const stateOk =
      typeof state === "string" &&
      expected !== undefined &&
      constantTimeEqual(state, expected);
    void reply.clearCookie(config.stateCookie, { path: "/" });

    if (!stateOk) {
      await logActivity(store, ActivityEvent.StateRejected, request.correlationId);
      return fail("Sign in could not be completed");
    }
    if (code === undefined || code === "") {
      return fail("Sign in could not be completed");
    }

    const tokens = await exchangeCode(config, code, request.correlationId);
    await logActivity(store, ActivityEvent.TokenExchanged, request.correlationId, {
      expiresIn: tokens.expires_in,
    });

    const profile = await fetchUserInfo(config, tokens.access_token, request.correlationId);
    await logActivity(store, ActivityEvent.UserInfoFetched, request.correlationId, {
      sub: profile.sub,
    });

    await upsertProfile(store, profile);

    const session = await createLocalSession(store, {
      token: randomToken(),
      externalUserId: profile.sub,
      centralSessionId: tokens.sso_session_id,
      ttlSeconds: config.localSessionTtlSeconds,
    });

    await logActivity(store, ActivityEvent.LocalSessionCreated, request.correlationId, {
      localSessionId: session.id,
      centralSessionId: tokens.sso_session_id,
    });

    void reply.setCookie(config.sessionCookie, session.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });

    return reply.redirect("/");
  });

  app.post("/logout", async (request, reply) => {
    const current = await readLocalSession(store, request.cookies[config.sessionCookie]);

    if (current.state === "active") {
      await revokeLocalSession(store, current.row.id, "local_logout");
      await logActivity(store, ActivityEvent.LocalLogout, request.correlationId, {
        localSessionId: current.row.id,
      });
    }

    void reply.clearCookie(config.sessionCookie, { path: "/" });
    return reply.redirect("/");
  });
}
