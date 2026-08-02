import assert from "node:assert/strict";
import { test } from "node:test";
import { constantTimeEqual } from "./hash.js";
import { MAX_SIGNATURE_AGE_SECONDS, signPayload, verifyPayload } from "./hmac.js";

const SECRET = "logout-signing-secret-for-tests";
const BODY = JSON.stringify({ eventId: "e1", eventType: "SessionRevoked" });
const NOW = 1_700_000_000;

test("constantTimeEqual matches identical strings", () => {
  assert.equal(constantTimeEqual("abc123", "abc123"), true);
});

test("constantTimeEqual rejects differing content of equal length", () => {
  assert.equal(constantTimeEqual("abc123", "abc124"), false);
});

test("constantTimeEqual rejects differing lengths without throwing", () => {
  assert.equal(constantTimeEqual("short", "considerably-longer"), false);
  assert.equal(constantTimeEqual("", "x"), false);
});

test("constantTimeEqual treats empty strings as equal", () => {
  assert.equal(constantTimeEqual("", ""), true);
});

test("a signature produced by signPayload verifies", () => {
  const sig = signPayload(SECRET, NOW, BODY);
  assert.deepEqual(verifyPayload(SECRET, String(NOW), BODY, sig, NOW), {
    valid: true,
  });
});

test("a signature from a different secret is rejected", () => {
  const sig = signPayload("other-secret", NOW, BODY);
  const result = verifyPayload(SECRET, String(NOW), BODY, sig, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a tampered body invalidates the signature", () => {
  const sig = signPayload(SECRET, NOW, BODY);
  const tampered = JSON.stringify({ eventId: "e2", eventType: "SessionRevoked" });
  const result = verifyPayload(SECRET, String(NOW), tampered, sig, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("the timestamp is covered by the signature, so it cannot be moved forward", () => {
  const sig = signPayload(SECRET, NOW, BODY);
  const result = verifyPayload(SECRET, String(NOW + 10), BODY, sig, NOW + 10);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a stale timestamp is rejected before the signature is checked", () => {
  const stale = NOW - MAX_SIGNATURE_AGE_SECONDS - 1;
  const sig = signPayload(SECRET, stale, BODY);
  const result = verifyPayload(SECRET, String(stale), BODY, sig, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "stale_timestamp");
});

test("skew is rejected in both directions", () => {
  const future = NOW + MAX_SIGNATURE_AGE_SECONDS + 1;
  const sig = signPayload(SECRET, future, BODY);
  const result = verifyPayload(SECRET, String(future), BODY, sig, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "stale_timestamp");
});

test("a timestamp at the edge of the window is accepted", () => {
  const edge = NOW - MAX_SIGNATURE_AGE_SECONDS;
  const sig = signPayload(SECRET, edge, BODY);
  assert.equal(verifyPayload(SECRET, String(edge), BODY, sig, NOW).valid, true);
});

test("a non-numeric timestamp is rejected", () => {
  const sig = signPayload(SECRET, NOW, BODY);
  const result = verifyPayload(SECRET, "not-a-number", BODY, sig, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_timestamp");
});
