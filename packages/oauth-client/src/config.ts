export interface RelyingAppConfig {
  name: string;
  title: string;
  tagline: string;
  accent: string;

  clientId: string;
  clientSecret: string;
  authIssuer: string;
  baseUrl: string;

  sessionCookie: string;
  stateCookie: string;

  localSessionTtlSeconds: number;
  logoutSigningSecret: string;

  databaseUrl: string;
  port: number;
  host: string;
  logLevel: string;
}

export const STATE_COOKIE_TTL_SECONDS = 300;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export interface AppIdentity {
  name: string;
  title: string;
  tagline: string;
  accent: string;
  envPrefix: string;
  sessionCookie: string;
  stateCookie: string;
}

export function loadConfig(identity: AppIdentity): RelyingAppConfig {
  const prefix = identity.envPrefix;
  return {
    name: identity.name,
    title: identity.title,
    tagline: identity.tagline,
    accent: identity.accent,
    clientId: required(`${prefix}_CLIENT_ID`),
    clientSecret: required(`${prefix}_CLIENT_SECRET`),
    authIssuer: required("AUTH_ISSUER"),
    baseUrl: required(`${prefix}_BASE_URL`),
    sessionCookie: identity.sessionCookie,
    stateCookie: identity.stateCookie,
    localSessionTtlSeconds: optionalInt("LOCAL_SESSION_TTL_SECONDS", 3600),
    logoutSigningSecret: required(`LOGOUT_SIGNING_SECRET_${prefix}`),
    databaseUrl: required("DATABASE_URL"),
    port: optionalInt("PORT", 3000),
    host: process.env["HOST"] ?? "0.0.0.0",
    logLevel: process.env["LOG_LEVEL"] ?? "info",
  };
}
