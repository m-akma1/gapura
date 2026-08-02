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

export interface CoreEnv {
  databaseUrl: string;
  authIssuer: string;
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  centralSessionTtlSeconds: number;
  logLevel: string;
}

export function loadCoreEnv(): CoreEnv {
  return {
    databaseUrl: required("DATABASE_URL"),
    authIssuer: required("AUTH_ISSUER"),
    authCodeTtlSeconds: optionalInt("AUTH_CODE_TTL_SECONDS", 60),
    accessTokenTtlSeconds: optionalInt("ACCESS_TOKEN_TTL_SECONDS", 300),
    centralSessionTtlSeconds: optionalInt("CENTRAL_SESSION_TTL_SECONDS", 28800),
    logLevel: process.env["LOG_LEVEL"] ?? "info",
  };
}

export { optionalInt, required };
