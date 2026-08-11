import { loadCoreEnv, optionalInt, required } from "@gapura/auth-core";
import type { RabbitManagementConfig } from "@gapura/lifecycle";

export interface ServerEnv {
  databaseUrl: string;
  authIssuer: string;
  port: number;
  host: string;
  logLevel: string;
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  centralSessionTtlSeconds: number;
  rabbitManagement: RabbitManagementConfig;
}

export function loadServerEnv(): ServerEnv {
  const core = loadCoreEnv();
  return {
    ...core,
    port: optionalInt("PORT", 3000),
    host: process.env["HOST"] ?? "0.0.0.0",
    rabbitManagement: {
      baseUrl: required("RABBITMQ_MANAGEMENT_URL"),
      username: required("RABBITMQ_USER"),
      password: required("RABBITMQ_PASSWORD"),
    },
  };
}

export { required };
