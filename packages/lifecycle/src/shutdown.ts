export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownOptions {
  steps: ShutdownStep[];
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  onEvent?: (event: ShutdownEvent) => void;
}

export type ShutdownEvent =
  | { type: "started"; signal: NodeJS.Signals }
  | { type: "step"; name: string; ms: number }
  | { type: "step_failed"; name: string; error: string }
  | { type: "finished"; ms: number }
  | { type: "timed_out"; ms: number };

export const SHUTDOWN_TIMEOUT_MS = 25_000;

export interface ShutdownController {
  isShuttingDown: () => boolean;
  shutdown: (signal?: NodeJS.Signals) => Promise<void>;
}

export function gracefulShutdown(options: ShutdownOptions): ShutdownController {
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const signals = options.signals ?? (["SIGTERM", "SIGINT"] as NodeJS.Signals[]);
  const emit = options.onEvent ?? ((): void => undefined);
  let shuttingDown = false;

  const runSteps = async (): Promise<void> => {
    for (const step of options.steps) {
      const startedAt = Date.now();
      try {
        await step.run();
        emit({ type: "step", name: step.name, ms: Date.now() - startedAt });
      } catch (error) {
        emit({
          type: "step_failed",
          name: step.name,
          error: error instanceof Error ? error.message : "failed",
        });
      }
    }
  };

  const shutdown = async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    emit({ type: "started", signal });

    const startedAt = Date.now();
    // The timer must not keep the loop alive on its own, or a process that has
    // finished draining would sit here until the deadline.
    const timer = setTimeout(() => {
      emit({ type: "timed_out", ms: Date.now() - startedAt });
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    await runSteps();
    clearTimeout(timer);
    emit({ type: "finished", ms: Date.now() - startedAt });
  };

  for (const signal of signals) {
    process.once(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }

  return { isShuttingDown: () => shuttingDown, shutdown };
}
