import type { FastifyReply } from "fastify";

const FLASH_COOKIE = "gapura_admin_flash";

export function setFlash(reply: FastifyReply, message: string): void {
  void reply.setCookie(FLASH_COOKIE, message, {
    httpOnly: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: 30,
  });
}

export function takeFlash(
  request: { cookies: Record<string, string | undefined> },
  reply: FastifyReply,
): string | undefined {
  const value = request.cookies[FLASH_COOKIE];
  if (value === undefined || value === "") return undefined;
  void reply.clearCookie(FLASH_COOKIE, { path: "/admin" });
  return value;
}
