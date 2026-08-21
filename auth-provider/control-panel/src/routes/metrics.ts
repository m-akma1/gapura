import type { FastifyInstance } from "fastify";
import { collect } from "../collect.js";
import { renderPage, renderPartial } from "../views.js";

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/observability", async (request, reply) => {
    const data = await collect(app.ctx);
    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "metrics",
        { data },
        {
          title: "Observability",
          currentUser: request.admin.user,
          activeNav: "metrics",
        },
      ),
    );
  });

  app.get("/admin/fragments/metrics", async (_request, reply) => {
    const data = await collect(app.ctx);
    return reply
      .type("text/html; charset=utf-8")
      .send(renderPartial("partials/metrics", { data }));
  });
}
