import { runChecks, type CheckDefinition } from "@gapura/lifecycle";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface HealthOptions {
  checks: CheckDefinition[];
  pathPrefix?: string;
  isDraining?: () => boolean;
}

async function healthPlugin(
  app: FastifyInstance,
  options: HealthOptions,
): Promise<void> {
  const prefix = options.pathPrefix ?? "";

  app.get(`${prefix}/health/live`, async () => ({ status: "alive" }));

  app.get(`${prefix}/health/ready`, async (_request, reply) => {
    if (options.isDraining?.() === true) {
      return reply.status(503).send({ status: "shutting_down", checks: {} });
    }

    const report = await runChecks(options.checks);
    if (report.status !== "ready") {
      return reply.status(503).send(report);
    }
    return report;
  });
}

export const health = fp(healthPlugin, { name: "gapura-health" });
