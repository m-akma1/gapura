import { loadCoreEnv, optionalInt, required } from "@gapura/auth-core";

export interface ServerEnv {
  databaseUrl: string;
  authIssuer: string;
  port: number;
  host: string;
  logLevel: string;
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  centralSessionTtlSeconds: number;
}

export function loadServerEnv(): ServerEnv {
  const core = loadCoreEnv();
  return {
    ...core,
    port: optionalInt("PORT", 3000),
    host: process.env["HOST"] ?? "0.0.0.0",
  };
}

export { required };
