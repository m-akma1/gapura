import assert from "node:assert/strict";
import { test } from "node:test";
import { runChecks } from "./checks.js";

const ok = async (): Promise<void> => undefined;
const boom = async (): Promise<void> => {
  throw new Error("connection refused");
};
const hang = async (): Promise<void> => new Promise(() => undefined);
const slow = (ms: number) => async (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("all checks passing reports ready", async () => {
  const report = await runChecks([
    { name: "database", run: ok },
    { name: "broker", run: ok },
  ]);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.checks, {
    database: { status: "ok" },
    broker: { status: "ok" },
  });
});

test("one failing check reports not_ready and names the component", async () => {
  const report = await runChecks([
    { name: "database", run: ok },
    { name: "broker", run: boom },
  ]);
  assert.equal(report.status, "not_ready");
  assert.equal(report.checks["database"]?.status, "ok");
  assert.equal(report.checks["broker"]?.status, "fail");
  assert.equal(report.checks["broker"]?.error, "connection refused");
});

test("a failing check does not hide the results of the others", async () => {
  const report = await runChecks([
    { name: "a", run: boom },
    { name: "b", run: boom },
    { name: "c", run: ok },
  ]);
  assert.equal(Object.keys(report.checks).length, 3);
  assert.equal(report.checks["c"]?.status, "ok");
});

test("a hung check times out rather than hanging the probe", async () => {
  const started = Date.now();
  const report = await runChecks([{ name: "broker", run: hang }], 100);
  const elapsed = Date.now() - started;
  assert.equal(report.status, "not_ready");
  assert.equal(report.checks["broker"]?.error, "timed out");
  assert.ok(elapsed < 1000, `probe took ${elapsed}ms, should have bailed at ~100ms`);
});

test("checks run concurrently, not in series", async () => {
  const started = Date.now();
  await runChecks(
    [
      { name: "a", run: slow(120) },
      { name: "b", run: slow(120) },
      { name: "c", run: slow(120) },
    ],
    2000,
  );
  const elapsed = Date.now() - started;
  
  // Serialized test usually takes around 360ms
  assert.ok(elapsed < 300, `took ${elapsed}ms, checks appear to be serialized`);
});

test("error detail is truncated to one short line", async () => {
  const chatty = async (): Promise<void> => {
    throw new Error(
      `connect ECONNREFUSED 10.0.0.5:5432\n  at TCPConnectWrap\n${"x".repeat(400)}`,
    );
  };
  const report = await runChecks([{ name: "database", run: chatty }]);
  const detail = report.checks["database"]?.error ?? "";
  assert.ok(!detail.includes("\n"), "multi-line detail leaked into the response");
  assert.ok(detail.length <= 120, `detail was ${detail.length} chars`);
});

test("a non-Error throw still produces a safe message", async () => {
  const weird = async (): Promise<void> => {
    throw "just a string";
  };
  const report = await runChecks([{ name: "database", run: weird }]);
  assert.equal(report.checks["database"]?.status, "fail");
  assert.equal(report.checks["database"]?.error, "check failed");
});

test("an empty check list is ready", async () => {
  const report = await runChecks([]);
  assert.equal(report.status, "ready");
});
