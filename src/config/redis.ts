import { Redis } from 'ioredis';
import { createLogger } from '../shared/utils/logger.js';
import { getConfig } from './index.js';

const logger = createLogger({ component: 'redis' });

// ─── Connection factory ───────────────────────────────────────────────────────

/**
 * Creates a Redis connection suitable for BullMQ producers.
 * Producers use enableOfflineQueue: false to fail fast when Redis is down.
 */
export function createProducerConnection(): Redis {
  const { redis } = getConfig();

  return new Redis(redis.url, {
    // REQUIRED for BullMQ blocking commands
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy(times: number) {
      if (times > 3) return null; // Give up after 3 attempts for producers
      return Math.min(times * 500, 2000);
    },
  });
}

/**
 * Creates a Redis connection suitable for BullMQ workers.
 * Workers are more tolerant of transient disconnects.
 */
export function createWorkerConnection(): Redis {
  const { redis } = getConfig();

  return new Redis(redis.url, {
    // REQUIRED for BullMQ blocking commands
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ component: 'redis', attempt: times }, 'Redis reconnecting');
      return delay;
    },
  });
}

/**
 * Creates a general-purpose Redis connection for rate limiters, stores, etc.
 */
export function createGeneralConnection(): Redis {
  const { redis } = getConfig();

  return new Redis(redis.url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
}

// ─── Shared singleton connections ─────────────────────────────────────────────

let _producerConn: Redis | undefined;
let _workerConn: Redis | undefined;
let _generalConn: Redis | undefined;

export function getProducerConnection(): Redis {
  if (!_producerConn) {
    _producerConn = createProducerConnection();
    _producerConn.on('error', (err: any) =>
      logger.error({ err, component: 'redis-producer' }, 'Redis producer error'),
    );
  }
  return _producerConn;
}

export function getWorkerConnection(): Redis {
  if (!_workerConn) {
    _workerConn = createWorkerConnection();
    _workerConn.on('error', (err: any) =>
      logger.error({ err, component: 'redis-worker' }, 'Redis worker error'),
    );
  }
  return _workerConn;
}

export function getGeneralConnection(): Redis {
  if (!_generalConn) {
    _generalConn = createGeneralConnection();
    _generalConn.on('error', (err: any) =>
      logger.error({ err, component: 'redis-general' }, 'Redis general error'),
    );
  }
  return _generalConn;
}

export async function closeAllConnections(): Promise<void> {
  await Promise.all([
    _producerConn?.quit(),
    _workerConn?.quit(),
    _generalConn?.quit(),
  ]);
  _producerConn = undefined;
  _workerConn = undefined;
  _generalConn = undefined;
  logger.info({ component: 'redis' }, 'All Redis connections closed');
}
