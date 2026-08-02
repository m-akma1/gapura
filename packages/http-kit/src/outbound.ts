import { REQUEST_ID_HEADER } from "./request-id.js";

export function correlationHeaders(
  correlationId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...extra, [REQUEST_ID_HEADER]: correlationId };
}
