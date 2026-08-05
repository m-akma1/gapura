import type { FastifyInstance } from "fastify";
import { renderPage } from "../views.js";

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(renderPage("home", {}, { title: "Gapura" })),
  );
}
