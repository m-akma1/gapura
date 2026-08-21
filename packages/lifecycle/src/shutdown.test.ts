import assert from "node:assert/strict";
import { test } from "node:test";
import { gracefulShutdown, type ShutdownEvent } from "./shutdown.js";

const noSignals: NodeJS.Signals[] = [];

test("steps run in the order they were given", async () => {
  const order: string[] = [];
  const controller = gracefulShutdown({
    signals: noSignals,
    steps: [
      { name: "a", run: async () => void order.push("a") },
      { name: "b", run: async () => void order.push("b") },
      { name: "c", run: async () => void order.push("c") },
    ],
  });
  await controller.shutdown();
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("a later step waits for an earlier slow one", async () => {
  const order: string[] = [];
  const controller = gracefulShutdown({
    signals: noSignals,
    steps: [
      {
        name: "slow",
        run: async () => {
          await new Promise((r) => setTimeout(r, 60));
          order.push("slow");
        },
      },
      { name: "fast", run: async () => void order.push("fast") },
    ],
  });
  await controller.shutdown();
  assert.deepEqual(order, ["slow", "fast"]);
});

test("a failing step does not stop the ones after it", async () => {
  const order: string[] = [];
  const events: ShutdownEvent[] = [];
  const controller = gracefulShutdown({
    signals: noSignals,
    onEvent: (e) => void events.push(e),
    steps: [
      {
        name: "broker",
        run: async () => {
          throw new Error("already closed");
        },
      },
      { name: "database", run: async () => void order.push("database") },
    ],
  });
  await controller.shutdown();
  assert.deepEqual(order, ["database"]);
  const failed = events.find((e) => e.type === "step_failed");
  assert.equal(failed?.type === "step_failed" ? failed.name : undefined, "broker");
});

test("a second shutdown is ignored", async () => {
  let runs = 0;
  const controller = gracefulShutdown({
    signals: noSignals,
    steps: [{ name: "once", run: async () => void (runs += 1) }],
  });
  await Promise.all([controller.shutdown(), controller.shutdown()]);
  await controller.shutdown();
  assert.equal(runs, 1);
});

test("isShuttingDown flips before any step runs", async () => {
  let seenDuringStep: boolean | undefined;
  const controller = gracefulShutdown({
    signals: noSignals,
    steps: [
      {
        name: "observe",
        run: async () => {
          seenDuringStep = controller.isShuttingDown();
        },
      },
    ],
  });
  assert.equal(controller.isShuttingDown(), false);
  await controller.shutdown();
  assert.equal(seenDuringStep, true);
});

test("finishing early does not wait for the timeout", async () => {
  const startedAt = Date.now();
  const controller = gracefulShutdown({
    signals: noSignals,
    timeoutMs: 5000,
    steps: [{ name: "quick", run: async () => undefined }],
  });
  await controller.shutdown();
  assert.ok(Date.now() - startedAt < 500, "shutdown waited on its own timer");
});
