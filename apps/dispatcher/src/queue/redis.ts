import { Redis } from 'ioredis';

/** BullMQ requires `maxRetriesPerRequest: null` on connections used by workers. */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
