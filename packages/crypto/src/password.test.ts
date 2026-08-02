import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("a password verifies against its own hash", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword(stored, "correct horse battery staple"), true);
});

test("a wrong password does not verify", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword(stored, "Correct horse battery staple"), false);
});

test("hashing the same password twice yields different hashes", async () => {
  const a = await hashPassword("same-input");
  const b = await hashPassword("same-input");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(a, "same-input"), true);
  assert.equal(await verifyPassword(b, "same-input"), true);
});

test("the plaintext never appears in the stored hash", async () => {
  const stored = await hashPassword("plaintext-marker");
  assert.equal(stored.includes("plaintext-marker"), false);
});

test("a corrupt stored hash returns false instead of throwing", async () => {
  assert.equal(await verifyPassword("not-a-valid-argon2-hash", "anything"), false);
  assert.equal(await verifyPassword("", "anything"), false);
});
