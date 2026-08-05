import { loadCoreEnv, optionalInt, required } from "@gapura/auth-core";

export interface PanelEnv {
  databaseUrl: string;
  authIssuer: string;
  port: number;
  host: string;
  logLevel: string;
}

export function loadPanelEnv(): PanelEnv {
  const core = loadCoreEnv();
  return {
    databaseUrl: core.databaseUrl,
    authIssuer: core.authIssuer,
    logLevel: core.logLevel,
    port: optionalInt("PORT", 3000),
    host: process.env["HOST"] ?? "0.0.0.0",
  };
}

export { required };
