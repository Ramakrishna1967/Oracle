import { getGeneralConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import { RateLimitError } from '../shared/utils/errors.js';
import {
  MAX_DMS_PER_USER_PER_HOUR,
  MAX_DMS_PER_WORKSPACE_PER_HOUR,
} from '../shared/constants.js';

const logger = createLogger({ component: 'action-layer.rate-limiter' });

const WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const USER_KEY_PREFIX = 'oracle:rl:user';
const WORKSPACE_KEY_PREFIX = 'oracle:rl:workspace';

// ─── Sliding window counter ───────────────────────────────────────────────────

async function incrementCounter(
  key: string,
  windowMs: number,
): Promise<number> {
  const redis = getGeneralConnection();
  const now = Date.now();
  const windowStart = now - windowMs;

  // Remove entries outside the window
  await redis.zremrangebyscore(key, '-inf', windowStart);
  // Add current timestamp
  await redis.zadd(key, now, `${now}:${Math.random()}`);
  // Set expiry
  await redis.pexpire(key, windowMs * 2);
  // Return current count
  return redis.zcard(key);
}

// ─── Check and enforce rate limits ────────────────────────────────────────────

export interface RateLimitCheck {
  allowed: boolean;
  userCount: number;
  workspaceCount: number;
  shouldBatch: boolean;
}

/**
 * Check whether Oracle is allowed to DM a user right now.
 * Enforces both per-user and per-workspace limits.
 *
 * @returns RateLimitCheck — if allowed=false, the brief should be batched or dropped.
 */
export async function checkRateLimit(
  workspaceId: string,
  userId: string,
): Promise<RateLimitCheck> {
  const userKey = `${USER_KEY_PREFIX}:${workspaceId}:${userId}`;
  const wsKey = `${WORKSPACE_KEY_PREFIX}:${workspaceId}`;

  // Peek at current counts without incrementing
  const redis = getGeneralConnection();
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  await redis.zremrangebyscore(userKey, '-inf', windowStart);
  await redis.zremrangebyscore(wsKey, '-inf', windowStart);

  const userCount = await redis.zcard(userKey);
  const workspaceCount = await redis.zcard(wsKey);

  const userAllowed = userCount < MAX_DMS_PER_USER_PER_HOUR;
  const wsAllowed = workspaceCount < MAX_DMS_PER_WORKSPACE_PER_HOUR;
  const allowed = userAllowed && wsAllowed;

  // Workspace at 90% of cap = batch mode
  const shouldBatch = workspaceCount >= Math.floor(MAX_DMS_PER_WORKSPACE_PER_HOUR * 0.9);

  if (!allowed) {
    logger.warn(
      { workspaceId, userId, userCount, workspaceCount },
      'Rate limit exceeded — DM blocked',
    );
  }

  return { allowed, userCount, workspaceCount, shouldBatch };
}

/**
 * Record that a DM was sent to a user.
 * Call this only after a successful delivery.
 */
export async function recordDelivery(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const userKey = `${USER_KEY_PREFIX}:${workspaceId}:${userId}`;
  const wsKey = `${WORKSPACE_KEY_PREFIX}:${workspaceId}`;

  await Promise.all([
    incrementCounter(userKey, WINDOW_MS),
    incrementCounter(wsKey, WINDOW_MS),
  ]);

  logger.debug({ workspaceId, userId }, 'DM delivery recorded in rate limiter');
}

/**
 * Throws RateLimitError if the user is at their DM cap.
 */
export async function enforceRateLimit(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const check = await checkRateLimit(workspaceId, userId);
  if (!check.allowed) {
    throw new RateLimitError(
      `DM to ${userId} in workspace ${workspaceId}`,
      WINDOW_MS,
    );
  }
}
