import type { TokenResponse, UserInfoResponse } from "@gapura/contracts";
import { correlationHeaders } from "@gapura/http-kit";
import type { RelyingAppConfig } from "./config.js";

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export function buildAuthorizeUrl(
  config: RelyingAppConfig,
  state: string,
): string {
  const url = new URL("/authorize", config.authIssuer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("state", state);
  return url.toString();
}

export function redirectUri(config: RelyingAppConfig): string {
  return `${config.baseUrl}/callback`;
}

export async function exchangeCode(
  config: RelyingAppConfig,
  code: string,
  correlationId: string,
): Promise<TokenResponse> {
  const response = await fetch(new URL("/token", config.authIssuer), {
    method: "POST",
    headers: correlationHeaders(correlationId, {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(
        `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
      ).toString("base64")}`,
    }),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(config),
    }),
  });

  if (!response.ok) {
    throw new OAuthError(
      "Sign in could not be completed",
      `token endpoint returned ${response.status}`,
    );
  }

  return (await response.json()) as TokenResponse;
}

export async function fetchUserInfo(
  config: RelyingAppConfig,
  accessToken: string,
  correlationId: string,
): Promise<UserInfoResponse> {
  const response = await fetch(new URL("/userinfo", config.authIssuer), {
    headers: correlationHeaders(correlationId, {
      authorization: `Bearer ${accessToken}`,
    }),
  });

  if (!response.ok) {
    throw new OAuthError(
      "Sign in could not be completed",
      `userinfo endpoint returned ${response.status}`,
    );
  }

  return (await response.json()) as UserInfoResponse;
}
