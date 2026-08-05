import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async (_request, reply) => {
    try {
      await app.ctx.prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });
}
