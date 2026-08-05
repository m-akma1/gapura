import type { FastifyReply } from "fastify";

export const SSO_COOKIE = "gapura_sso";

export function setSsoCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  void reply.setCookie(SSO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: false,
  });
}

export function clearSsoCookie(reply: FastifyReply): void {
  void reply.clearCookie(SSO_COOKIE, { path: "/" });
}
