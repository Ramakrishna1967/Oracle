import { getGeneralConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import {
  AUDIT_STREAM_KEY_PREFIX,
  AUDIT_STREAM_MAX_LEN,
} from '../shared/constants.js';
import type { ActionOutcome } from '../shared/types/index.js';

const logger = createLogger({ component: 'action-layer.audit' });

/**
 * Append an action outcome to the workspace's Redis audit stream.
 * Uses XADD with MAXLEN to cap stream at AUDIT_STREAM_MAX_LEN entries.
 */
export async function logAuditEvent(
  workspaceId: string,
  outcome: ActionOutcome,
): Promise<void> {
  const redis = getGeneralConnection();
  const key = `${AUDIT_STREAM_KEY_PREFIX}:${workspaceId}`;

  try {
    await redis.xadd(
      key,
      'MAXLEN',
      '~',
      String(AUDIT_STREAM_MAX_LEN),
      '*', // auto-generate stream ID
      'patternId', outcome.patternId,
      'action', outcome.action,
      'recipient', outcome.recipient,
      'timestamp', String(outcome.timestamp),
      'success', outcome.success ? '1' : '0',
      'error', outcome.error ?? '',
    );
  } catch (err) {
    // Audit failures must never crash the action layer
    logger.error({ err, patternId: outcome.patternId }, 'Failed to write audit log');
  }
}

/**
 * Read the last N audit entries for a workspace.
 */
export async function readAuditLog(
  workspaceId: string,
  count = 50,
): Promise<ActionOutcome[]> {
  const redis = getGeneralConnection();
  const key = `${AUDIT_STREAM_KEY_PREFIX}:${workspaceId}`;

  try {
    const entries = await redis.xrevrange(key, '+', '-', 'COUNT', count);

    return entries.map(([_id, fields]: [string, string[]]) => {
      const f = Object.fromEntries(
        fields.reduce<[string, string][]>((acc: [string, string][], val: string, idx: number) => {
          if (idx % 2 === 0) acc.push([val, fields[idx + 1] ?? '']);
          return acc;
        }, []),
      );

      return {
        patternId: f['patternId'] ?? '',
        action: (f['action'] ?? 'brief_delivered') as ActionOutcome['action'],
        recipient: f['recipient'] ?? '',
        timestamp: parseInt(f['timestamp'] ?? '0', 10),
        success: f['success'] === '1',
        error: f['error'] || undefined,
      };
    });
  } catch (err) {
    logger.error({ err }, 'Failed to read audit log');
    return [];
  }
}
