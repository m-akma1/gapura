import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export const REQUEST_ID_HEADER = "x-request-id";

async function requestIdPlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const id = typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
    request.correlationId = id;
    void reply.header(REQUEST_ID_HEADER, id);
  });
}

export const requestId = fp(requestIdPlugin, { name: "gapura-request-id" });

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}
