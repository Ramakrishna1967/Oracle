import { Worker } from 'bullmq';
import { getWorkerConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import { enqueueAction, enqueueDLQ } from '../queue/producers.js';
import { holdAndRescore } from './hold-queue.js';
import { scorePattern, recommendRecipient, recommendAction } from './scorer.js';
import {
  QUEUE_SCORING,
  CONCURRENCY_SCORING,
  JOB_MAX_ATTEMPTS,
} from '../shared/constants.js';
import type { ScoringJobData, ScoredPattern } from '../shared/types/index.js';

const logger = createLogger({ component: 'confidence-scorer' });

let _worker: Worker | undefined;

export function startConfidenceScorer(): Worker {
  _worker = new Worker<ScoringJobData>(
    QUEUE_SCORING,
    async (job) => {
      const { enrichedPattern } = job.data;
      const logCtx = {
        patternId: enrichedPattern.patternId,
        topic: enrichedPattern.topicCluster,
      };

      logger.debug(logCtx, 'Scoring enriched pattern');

      const { score, breakdown, decision } = scorePattern(enrichedPattern);

      logger.info(
        { ...logCtx, score, decision, penalties: breakdown.penalties },
        'Pattern scored',
      );

      if (decision === 'FIRE') {
        const recipient = recommendRecipient(enrichedPattern);
        const action = recommendAction(enrichedPattern, breakdown);

        const scoredPattern: ScoredPattern = {
          ...enrichedPattern,
          confidenceScore: score,
          scoreBreakdown: breakdown,
          recommendedRecipient: recipient,
          recommendedAction: action,
          scoredAt: Date.now(),
        };

        logger.info(
          { ...logCtx, score, recipient },
          '🔥 Confidence threshold met — firing action',
        );

        await enqueueAction(scoredPattern);
      } else if (decision === 'HOLD') {
        logger.info({ ...logCtx, score }, '⏸ Pattern held — will rescore in 10 minutes');
        await holdAndRescore(enrichedPattern);
      } else {
        logger.debug({ ...logCtx, score }, '🗑 Pattern discarded (below threshold)');
      }

      return { decision, confidenceScore: score };
    },
    {
      connection: getWorkerConnection() as any,
      concurrency: CONCURRENCY_SCORING,
    },
  );

  _worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ jobId: job.id, err: err.message }, 'Scoring job failed');

    if (job.attemptsMade >= JOB_MAX_ATTEMPTS) {
      await enqueueDLQ({
        originalQueue: QUEUE_SCORING,
        originalJobId: job.id,
        jobName: job.name,
        data: job.data,
        error: err.message,
        stacktrace: job.stacktrace ?? [],
        failedAt: new Date().toISOString(),
      });
    }
  });

  logger.info({ concurrency: CONCURRENCY_SCORING }, 'Confidence Scorer started');
  return _worker;
}

export async function stopConfidenceScorer(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = undefined;
    logger.info({}, 'Confidence Scorer stopped');
  }
}
