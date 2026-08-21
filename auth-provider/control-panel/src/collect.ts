import { deliveryStats, queueTargets, type DeliveryStats } from "@gapura/auth-core";
import { summarize, type MetricsSummary } from "@gapura/http-kit";
import { queueDepth, type QueueDepth } from "@gapura/lifecycle";
import type { MetricsPeer } from "./env.js";
import type { PanelContext } from "./app.js";

export interface ServiceMetrics extends MetricsSummary {
  name: string;
  reachable: boolean;
}

export interface DashboardData {
  queues: QueueDepth[];
  dlq: QueueDepth | null;
  awaitingRetry: number;
  services: ServiceMetrics[];
  delivery: DeliveryStats;
  collectedAt: Date;
}

async function fetchSummary(name: string, url: string): Promise<ServiceMetrics> {
  const empty = { requests: 0, errors: 0, errorRate: 0, p50Ms: null, p95Ms: null };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { name, reachable: false, ...empty };
    const body = (await response.json()) as MetricsSummary;
    return { name, reachable: true, ...body };
  } catch {
    return { name, reachable: false, ...empty };
  }
}

const RETRY_QUEUES = ["q.retry.1s", "q.retry.2s", "q.retry.4s", "q.retry.8s", "q.retry.16s"];

export async function collect(ctx: PanelContext): Promise<DashboardData> {
  const targets = await queueTargets(ctx.prisma);

  const [queues, dlq, retries, delivery, own, remote] = await Promise.all([
    Promise.all(
      targets.map((t) =>
        queueDepth(ctx.env.rabbitManagement, t.queue).catch(() => ({
          name: t.queue,
          ready: 0,
          unacked: 0,
          total: 0,
        })),
      ),
    ),
    queueDepth(ctx.env.rabbitManagement, "q.dlq").catch(() => null),
    Promise.all(
      RETRY_QUEUES.map((q) =>
        queueDepth(ctx.env.rabbitManagement, q).catch(() => null),
      ),
    ),
    deliveryStats(ctx.prisma),
    summarize(),
    Promise.all(
      ctx.env.metricsPeers.map((peer: MetricsPeer) => fetchSummary(peer.name, peer.url)),
    ),
  ]);

  return {
    queues,
    dlq,
    awaitingRetry: retries.reduce((sum, q) => sum + (q?.total ?? 0), 0),
    delivery,
    services: [{ name: "Control panel", reachable: true, ...own }, ...remote],
    collectedAt: new Date(),
  };
}
