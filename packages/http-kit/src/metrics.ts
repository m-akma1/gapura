import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Counter, Registry, Summary, collectDefaultMetrics } from "prom-client";

export interface MetricsOptions {
  pathPrefix?: string;
}

export interface MetricsSummary {
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

const duration = new Summary({
  name: "http_request_duration_seconds",
  help: "Request duration in seconds",
  labelNames: ["method", "route"],
  percentiles: [0.5, 0.95],
  maxAgeSeconds: 300,
  ageBuckets: 5,
  registers: [registry],
});

const requests = new Counter({
  name: "http_requests_total",
  help: "Requests by outcome",
  labelNames: ["method", "route", "status_class"],
  registers: [registry],
});

async function metricsPlugin(
  app: FastifyInstance,
  options: MetricsOptions,
): Promise<void> {
  const prefix = options.pathPrefix ?? "";

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    if (route.includes("/metrics") || route.includes("/health/")) return;

    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    duration.observe({ method: request.method, route }, reply.elapsedTime / 1000);
    requests.inc({ method: request.method, route, status_class: statusClass });
  });

  app.get(`${prefix}/metrics`, async (_request, reply) => {
    void reply.type(registry.contentType);
    return registry.metrics();
  });

  app.get(`${prefix}/internal/metrics.json`, async () => summarize());
}

export async function summarize(): Promise<MetricsSummary> {
  const collected = await registry.getMetricsAsJSON();

  let requestCount = 0;
  let errorCount = 0;
  const totals = collected.find((m) => m.name === "http_requests_total");
  for (const value of totals?.values ?? []) {
    const count = typeof value.value === "number" ? value.value : 0;
    requestCount += count;
    const statusClass = String(value.labels?.["status_class"] ?? "");
    if (statusClass === "4xx" || statusClass === "5xx") errorCount += count;
  }

  const summary = collected.find((m) => m.name === "http_request_duration_seconds");
  const quantile = (q: number): number | null => {
    const matches = (summary?.values ?? [])
      .filter((v) => v.labels?.["quantile"] === q && typeof v.value === "number")
      .map((v) => Number(v.value))
      .filter((v) => Number.isFinite(v));
    if (matches.length === 0) return null;
    return Math.round(Math.max(...matches) * 1000);
  };

  return {
    requests: requestCount,
    errors: errorCount,
    errorRate: requestCount === 0 ? 0 : errorCount / requestCount,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
  };
}

export const metrics = fp(metricsPlugin, { name: "gapura-metrics" });
