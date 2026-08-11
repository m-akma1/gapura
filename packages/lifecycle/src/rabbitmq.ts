export interface RabbitManagementConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface QueueDepth {
  name: string;
  ready: number;
  unacked: number;
  total: number;
}

function authHeader(config: RabbitManagementConfig): string {
  const raw = `${config.username}:${config.password}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function get(
  config: RabbitManagementConfig,
  path: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetch(new URL(path, config.baseUrl), {
    headers: { authorization: authHeader(config) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`broker returned ${response.status}`);
  }
  return response.json();
}

export async function checkRabbitHealth(
  config: RabbitManagementConfig,
  timeoutMs = 2000,
): Promise<void> {
  const body = (await get(config, "/api/health/checks/alarms", timeoutMs)) as {
    status?: string;
  };
  if (body.status !== "ok") {
    throw new Error("broker reported an alarm");
  }
}

export async function queueDepth(
  config: RabbitManagementConfig,
  queue: string,
  timeoutMs = 2000,
): Promise<QueueDepth> {
  const body = (await get(
    config,
    `/api/queues/%2F/${encodeURIComponent(queue)}`,
    timeoutMs,
  )) as { messages?: number; messages_ready?: number; messages_unacknowledged?: number };

  return {
    name: queue,
    ready: body.messages_ready ?? 0,
    unacked: body.messages_unacknowledged ?? 0,
    total: body.messages ?? 0,
  };
}
