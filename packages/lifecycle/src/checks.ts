export interface CheckResult {
  status: "ok" | "fail";
  error?: string;
}

export interface HealthReport {
  status: "ready" | "not_ready";
  checks: Record<string, CheckResult>;
}

export type Check = () => Promise<unknown>;

export interface CheckDefinition {
  name: string;
  run: Check;
}

export const CHECK_TIMEOUT_MS = 2000;

async function withTimeout(run: Check, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "check failed";
  // Some drivers put a blank first line before the useful text, so take the
  // first line that actually says something. An empty detail names the failing
  // component without explaining it, which is the point of the field.
  const line = error.message
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return (line ?? error.name ?? "check failed").slice(0, 120);
}

export async function runChecks(
  definitions: CheckDefinition[],
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<HealthReport> {
  const settled = await Promise.all(
    definitions.map(async (definition): Promise<[string, CheckResult]> => {
      try {
        await withTimeout(definition.run, timeoutMs);
        return [definition.name, { status: "ok" }];
      } catch (error) {
        return [definition.name, { status: "fail", error: describe(error) }];
      }
    }),
  );

  const checks = Object.fromEntries(settled);
  const healthy = settled.every(([, result]) => result.status === "ok");
  return { status: healthy ? "ready" : "not_ready", checks };
}
