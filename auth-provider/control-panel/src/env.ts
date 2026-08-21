import { loadCoreEnv, optionalInt, required } from "@gapura/auth-core";
import type { RabbitManagementConfig } from "@gapura/lifecycle";

export interface MetricsPeer {
  name: string;
  url: string;
}

export interface PanelEnv {
  databaseUrl: string;
  authIssuer: string;
  port: number;
  host: string;
  logLevel: string;
  rabbitManagement: RabbitManagementConfig;
  metricsPeers: MetricsPeer[];
}

export function loadPanelEnv(): PanelEnv {
  const core = loadCoreEnv();
  return {
    databaseUrl: core.databaseUrl,
    authIssuer: core.authIssuer,
    logLevel: core.logLevel,
    port: optionalInt("PORT", 3000),
    host: process.env["HOST"] ?? "0.0.0.0",
    rabbitManagement: {
      baseUrl: required("RABBITMQ_MANAGEMENT_URL"),
      username: required("RABBITMQ_USER"),
      password: required("RABBITMQ_PASSWORD"),
    },
    metricsPeers: [
      { name: "Auth server", url: "http://auth-server:3000/internal/metrics.json" },
      { name: "Keraton", url: "http://keraton:3000/internal/metrics.json" },
      { name: "Joglo", url: "http://joglo:3000/internal/metrics.json" },
    ],
  };
}

export { required };
