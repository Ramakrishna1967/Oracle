import { Worker } from 'bullmq';
import { getWorkerConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import { enqueuePattern, enqueueDLQ } from '../queue/producers.js';
import { getSignalStore } from './store.js';
import { detectPattern } from './detector.js';
import {
  QUEUE_SIGNAL,
  CONCURRENCY_PATTERN,
  JOB_MAX_ATTEMPTS,
} from '../shared/constants.js';
import type { SignalJobData } from '../shared/types/index.js';

const logger = createLogger({ component: 'pattern-engine' });

let _worker: Worker | undefined;

export function startPatternEngine(): Worker {
  const store = getSignalStore();

  _worker = new Worker<SignalJobData>(
    QUEUE_SIGNAL,
    async (job) => {
      const { signal } = job.data;
      const logCtx = { signalId: signal.signalId, channel: signal.channelId };

      logger.debug(logCtx, 'Processing signal');

      // Add signal to the store — get back topic keys it was bucketed under
      const topicKeys = store.add(signal);

      // Check each topic bucket for pattern formation
      for (const key of topicKeys) {
        const bucket = store.get(key);
        if (!bucket) continue;

        const { pattern, correlated, reason } = detectPattern(bucket, signal.workspaceId);

        if (pattern) {
          logger.info(
            {
              patternId: pattern.patternId,
              topicCluster: pattern.topicCluster,
              channelSpread: pattern.channelSpread,
              signalCount: pattern.relatedSignals.length,
            },
            'Pattern detected — enqueueing for enrichment',
          );

          store.markPatternEmitted(key, pattern.patternId);
          await enqueuePattern(pattern);
        } else if (correlated) {
          logger.debug({ ...logCtx, reason }, 'Correlated but no new pattern emitted');
        }
      }

      return { patternEmitted: topicKeys.length > 0 };
    },
    {
      connection: getWorkerConnection() as any,
      concurrency: CONCURRENCY_PATTERN,
    },
  );

  _worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error(
      { jobId: job.id, err: err.message },
      'Signal processing job failed',
    );

    if (job.attemptsMade >= JOB_MAX_ATTEMPTS) {
      await enqueueDLQ({
        originalQueue: QUEUE_SIGNAL,
        originalJobId: job.id,
        jobName: job.name,
        data: job.data,
        error: err.message,
        stacktrace: job.stacktrace ?? [],
        failedAt: new Date().toISOString(),
      });
    }
  });

  logger.info({ concurrency: CONCURRENCY_PATTERN }, 'Pattern Engine started');
  return _worker;
}

export async function stopPatternEngine(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = undefined;
    logger.info({}, 'Pattern Engine stopped');
  }
}
