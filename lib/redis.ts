import { createClient, type RedisClientType } from "redis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL env var is not defined");
}

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (client && client.isOpen) {
    return client;
  }

  if (!connectPromise) {
    client = createClient({ url: redisUrl });
    client.on("error", err => {
      console.error("Redis connection error", err);
    });
    connectPromise = client.connect().then(() => client!);
  }

  return connectPromise;
}
