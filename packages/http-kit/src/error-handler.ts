import {
  ErrorCode,
  ErrorMessage,
  GapuraError,
  errorBody,
  statusForCode,
} from "@gapura/contracts";
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";

export interface ErrorHandlerOptions {
  renderPage?: (
    reply: FastifyReply,
    view: { status: number; code: ErrorCode; message: string; requestId: string },
  ) => Promise<unknown> | unknown;
}

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}

async function errorHandlerPlugin(
  app: FastifyInstance,
  options: ErrorHandlerOptions,
): Promise<void> {
  app.setNotFoundHandler(async (request, reply) => {
    await send(request, reply, ErrorCode.NotFound, ErrorMessage.NotFound, options);
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error instanceof GapuraError) {
      request.log.warn(
        { code: error.code, detail: error.detail, requestId: request.correlationId },
        error.message,
      );
      await send(request, reply, error.code, error.message, options);
      return;
    }

    if (error.validation !== undefined) {
      request.log.warn({ requestId: request.correlationId }, "request validation failed");
      await send(
        request,
        reply,
        ErrorCode.InvalidRequest,
        ErrorMessage.InvalidRequest,
        options,
      );
      return;
    }

    request.log.error({ err: error, requestId: request.correlationId }, "unhandled error");
    await send(request, reply, ErrorCode.ServerError, ErrorMessage.ServerError, options);
  });
}

async function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  options: ErrorHandlerOptions,
): Promise<void> {
  const status = statusForCode(code);
  const requestId = request.correlationId;
  void reply.status(status);

  if (options.renderPage !== undefined && wantsHtml(request)) {
    await options.renderPage(reply, { status, code, message, requestId });
    return;
  }

  void reply.send(errorBody(code, message, requestId));
}

export const errorHandler = fp(errorHandlerPlugin, {
  name: "gapura-error-handler",
  dependencies: ["gapura-request-id"],
});
