import { type ChannelModel, type Channel, connect } from "amqplib";
import type { Logger } from "pino";

export async function connectWithRetry(
  url: string,
  log: Logger,
  attempts = 30,
  delayMs = 2000,
): Promise<ChannelModel> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect(url);
    } catch (error) {
      if (attempt === attempts) throw error;
      log.warn({ attempt }, "broker not ready, retrying");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}

export async function openChannel(connection: ChannelModel): Promise<Channel> {
  const channel = await connection.createChannel();
  await channel.prefetch(1);
  return channel;
}
