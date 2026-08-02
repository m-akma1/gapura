import { createHmac } from "node:crypto";
import { constantTimeEqual } from "./hash.js";

export const MAX_SIGNATURE_AGE_SECONDS = 300;

export function signPayload(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

export interface SignatureVerification {
  valid: boolean;
  reason?: "stale_timestamp" | "bad_timestamp" | "signature_mismatch";
}

export function verifyPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  maxAgeSeconds: number = MAX_SIGNATURE_AGE_SECONDS,
): SignatureVerification {
  const parsed = Number(timestamp);
  if (!Number.isInteger(parsed)) {
    return { valid: false, reason: "bad_timestamp" };
  }
  if (Math.abs(nowSeconds - parsed) > maxAgeSeconds) {
    return { valid: false, reason: "stale_timestamp" };
  }
  const expected = signPayload(secret, parsed, rawBody);
  if (!constantTimeEqual(expected, signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  return { valid: true };
}
