import { Worker } from 'bullmq';
import { getWorkerConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import { enqueueDLQ } from '../queue/producers.js';
import { checkRateLimit, recordDelivery } from './rate-limiter.js';
import { formatBrief } from './formatter.js';
import { sendDirectMessage } from './dm-sender.js';
import { logAuditEvent } from './audit.js';
import { cachePatternContext } from './actions.handler.js';
import {
  QUEUE_ACTION,
  CONCURRENCY_ACTION,
  JOB_MAX_ATTEMPTS,
} from '../shared/constants.js';
import type { ActionJobData } from '../shared/types/index.js';

const logger = createLogger({ component: 'action-layer' });

let _worker: Worker | undefined;

export function startActionLayer(): Worker {
  _worker = new Worker<ActionJobData>(
    QUEUE_ACTION,
    async (job) => {
      const { scoredPattern } = job.data;
      const {
        patternId,
        recommendedRecipient,
        confidenceScore,
        workspaceId,
        topicCluster,
        externalContext,
        channelSpread,
      } = scoredPattern;

      const logCtx = { patternId, recipient: recommendedRecipient, score: confidenceScore };
      logger.info(logCtx, 'Delivering brief');

      // ─── Rate limit check ──────────────────────────────────────────────
      const { allowed } = await checkRateLimit(workspaceId, recommendedRecipient);

      if (!allowed) {
        logger.warn(logCtx, 'Rate limit exceeded — brief suppressed');
        await logAuditEvent(workspaceId, {
          patternId,
          action: 'brief_failed',
          recipient: recommendedRecipient,
          timestamp: Date.now(),
          success: false,
          error: 'rate_limit_exceeded',
        });
        return { delivered: false, channel: 'dm' as const };
      }

      // ─── Format brief ──────────────────────────────────────────────────
      const brief = formatBrief(scoredPattern);

      // ─── Cache pattern context for button handlers ─────────────────────
      cachePatternContext(patternId, {
        topicCluster,
        onCallBackup: externalContext.onCallBackup,
        workspaceId,
        channelSpread,
      });

      // ─── Send DM ──────────────────────────────────────────────────────
      let delivered = false;
      let deliveryChannel: 'dm' | 'fallback' = 'dm';
      let messageTs: string | undefined;

      try {
        const result = await sendDirectMessage(recommendedRecipient, brief);
        deliveryChannel = result.channel;
        messageTs = result.messageTs;
        delivered = true;

        await recordDelivery(workspaceId, recommendedRecipient);
        await logAuditEvent(workspaceId, {
          patternId,
          action: 'brief_delivered',
          recipient: recommendedRecipient,
          timestamp: Date.now(),
          success: true,
        });

        logger.info(
          { ...logCtx, channel: deliveryChannel, messageTs },
          'Brief delivered successfully',
        );
      } catch (err) {
        await logAuditEvent(workspaceId, {
          patternId,
          action: 'brief_failed',
          recipient: recommendedRecipient,
          timestamp: Date.now(),
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // Let BullMQ handle retry
      }

      return { delivered, channel: deliveryChannel, messageTs };
    },
    {
      connection: getWorkerConnection() as any,
      concurrency: CONCURRENCY_ACTION,
    },
  );

  _worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ jobId: job.id, err: err.message }, 'Action job failed');

    if (job.attemptsMade >= JOB_MAX_ATTEMPTS) {
      await enqueueDLQ({
        originalQueue: QUEUE_ACTION,
        originalJobId: job.id,
        jobName: job.name,
        data: job.data,
        error: err.message,
        stacktrace: job.stacktrace ?? [],
        failedAt: new Date().toISOString(),
      });
    }
  });

  logger.info({ concurrency: CONCURRENCY_ACTION }, 'Action Layer started');
  return _worker;
}

export async function stopActionLayer(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = undefined;
    logger.info({}, 'Action Layer stopped');
  }
}
