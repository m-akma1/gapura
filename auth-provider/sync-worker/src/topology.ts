import type { Channel } from "amqplib";

export const EVENTS_EXCHANGE = "gapura.events";
export const DLQ_EXCHANGE = "gapura.dlq";
export const DLQ_QUEUE = "q.dlq";

export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const label = (ms: number): string => `${ms / 1000}s`;

export const retryExchange = (ms: number): string => `gapura.retry.${label(ms)}`;
export const retryQueue = (ms: number): string => `q.retry.${label(ms)}`;

export function appKey(clientId: string): string {
  return clientId.replace(/-web$/, "");
}

export function queueForApp(clientId: string): string {
  return `q.${appKey(clientId)}`;
}

export function routingKeyForApp(clientId: string): string {
  return appKey(clientId);
}

export async function declareTopology(
  channel: Channel,
  routingKeys: string[],
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(DLQ_EXCHANGE, "fanout", { durable: true });

  await channel.assertQueue(DLQ_QUEUE, { durable: true });
  await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "");

  for (const key of routingKeys) {
    const queue = `q.${key}`;
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, EVENTS_EXCHANGE, key);
  }

  for (const delay of RETRY_DELAYS_MS) {
    const exchange = retryExchange(delay);
    const queue = retryQueue(delay);
    await channel.assertExchange(exchange, "fanout", { durable: true });
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-message-ttl": delay,
        "x-dead-letter-exchange": EVENTS_EXCHANGE,
      },
    });
    await channel.bindQueue(queue, exchange, "");
  }
}
