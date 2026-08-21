import type { PrismaClient } from "./client.js";

export interface DeliveryOutcome {
  status: string;
  count: number;
}

export interface DeliveryStats {
  outcomes: DeliveryOutcome[];
  pendingOutbox: number;
  latencyP50Ms: number | null;
  latencyMaxMs: number | null;
  retrying: number;
  workerLastSeen: Date | null;
}

export async function deliveryStats(
  prisma: PrismaClient,
  windowMinutes = 15,
): Promise<DeliveryStats> {
  const since = new Date(Date.now() - windowMinutes * 60_000);

  const [outcomes, pendingOutbox, latency, retrying, lastSeen] = await Promise.all([
    prisma.eventDelivery.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { event: { createdAt: { gte: since } } },
    }),
    prisma.event.count({ where: { status: "pending" } }),
    prisma.$queryRaw<{ p50: number | null; max: number | null }[]>`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (d.processed_at - e.created_at)) * 1000
        ) AS p50,
        MAX(EXTRACT(EPOCH FROM (d.processed_at - e.created_at)) * 1000) AS max
      FROM event_deliveries d
      JOIN events e ON e.id = d.event_id
      WHERE d.processed_at IS NOT NULL AND e.created_at >= ${since}
    `,
    prisma.eventDelivery.count({ where: { attemptCount: { gt: 1 } } }),
    prisma.eventDelivery.aggregate({ _max: { lastAttemptAt: true } }),
  ]);

  const row = latency[0];
  const round = (value: number | null | undefined): number | null =>
    value === null || value === undefined ? null : Math.round(Number(value));

  return {
    outcomes: outcomes
      .map((o) => ({ status: String(o.status), count: o._count._all }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    pendingOutbox,
    latencyP50Ms: round(row?.p50),
    latencyMaxMs: round(row?.max),
    retrying,
    workerLastSeen: lastSeen._max.lastAttemptAt,
  };
}

export interface AppQueueTarget {
  name: string;
  queue: string;
}

export async function queueTargets(prisma: PrismaClient): Promise<AppQueueTarget[]> {
  const applications = await prisma.application.findMany({
    where: { status: "active" },
    select: { name: true, clientId: true },
    orderBy: { name: "asc" },
  });
  return applications.map((app) => ({
    name: app.name,
    queue: `q.${app.clientId.replace(/-web$/, "")}`,
  }));
}
