import IORedis, { type Redis } from 'ioredis';

/**
 * Shared Redis connection for BullMQ.
 *
 * Created lazily, on first use, and never at import time. Every document
 * service imports the enqueue helpers in src/queue/queues.ts, so connecting
 * eagerly would open a socket the moment any of them is imported — including
 * in the test suite, which has no Redis and would hang or fail wholesale.
 *
 * maxRetriesPerRequest MUST be null: BullMQ's blocking commands (BRPOPLPUSH
 * and friends) sit open for far longer than ioredis's default retry budget,
 * and with the default the client aborts them mid-wait.
 */
let connection: Redis | null = null;

export const getRedisConnection = (): Redis => {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL no está configurada: la cola de trabajos no puede iniciarse');
    }
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
};

/** Closes the shared connection. Used by the worker's shutdown path. */
export const closeRedisConnection = async (): Promise<void> => {
  if (connection) {
    await connection.quit();
    connection = null;
  }
};
