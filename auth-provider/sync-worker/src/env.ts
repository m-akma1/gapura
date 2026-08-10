import { optionalInt, required } from "@gapura/auth-core";

export interface WorkerEnv {
  databaseUrl: string;
  amqpUrl: string;
  logLevel: string;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  deliveryTimeoutMs: number;
  livenessFile: string;
  signingSecrets: Map<string, string>;
}

function collectSigningSecrets(): Map<string, string> {
  const secrets = new Map<string, string>();
  const prefix = "LOGOUT_SIGNING_SECRET_";
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined || value === "") continue;
    secrets.set(key.slice(prefix.length).toLowerCase().replace(/_/g, "-"), value);
  }
  return secrets;
}

export function loadWorkerEnv(): WorkerEnv {
  return {
    databaseUrl: required("DATABASE_URL"),
    amqpUrl: required("AMQP_URL"),
    logLevel: process.env["LOG_LEVEL"] ?? "info",
    outboxPollIntervalMs: optionalInt("OUTBOX_POLL_INTERVAL_MS", 500),
    outboxBatchSize: optionalInt("OUTBOX_BATCH_SIZE", 20),
    deliveryTimeoutMs: optionalInt("DELIVERY_TIMEOUT_MS", 5000),
    livenessFile: process.env["LIVENESS_FILE"] ?? "/tmp/worker.alive",
    signingSecrets: collectSigningSecrets(),
  };
}

export function signingSecretFor(env: WorkerEnv, key: string): string {
  const secret = env.signingSecrets.get(key);
  if (secret === undefined) {
    throw new Error(`No LOGOUT_SIGNING_SECRET configured for application ${key}`);
  }
  return secret;
}
