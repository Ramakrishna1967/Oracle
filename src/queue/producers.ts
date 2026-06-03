import { createLogger } from '../shared/utils/logger.js';
import {
  signalQueue,
  patternQueue,
  scoringQueue,
  actionQueue,
  deadLetterQueue,
} from './queues.js';
import type {
  Signal,
  Pattern,
  EnrichedPattern,
  ScoredPattern,
  SignalJobData,
  PatternJobData,
  ScoringJobData,
  ActionJobData,
  DLQJobData,
} from '../shared/types/index.js';

const logger = createLogger({ component: 'producers' });

// ─── Signal ───────────────────────────────────────────────────────────────────

export async function enqueueSignal(signal: Signal): Promise<void> {
  const data: SignalJobData = { signal };
  await signalQueue.add('signal', data, { jobId: signal.signalId });
  logger.debug(
    { signalId: signal.signalId, channel: signal.channelId },
    'Signal enqueued',
  );
}

// ─── Pattern ──────────────────────────────────────────────────────────────────

export async function enqueuePattern(pattern: Pattern): Promise<void> {
  const data: PatternJobData = { pattern };
  await patternQueue.add('pattern', data, { jobId: pattern.patternId });
  logger.info(
    { patternId: pattern.patternId, channelSpread: pattern.channelSpread },
    'Pattern enqueued for enrichment',
  );
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export async function enqueueScoringJob(
  enrichedPattern: EnrichedPattern,
): Promise<void> {
  const data: ScoringJobData = { enrichedPattern };
  await scoringQueue.add('score', data, {
    jobId: `score-${enrichedPattern.patternId}`,
  });
  logger.debug(
    { patternId: enrichedPattern.patternId },
    'Enriched pattern enqueued for scoring',
  );
}

/**
 * Re-enqueue a pattern for scoring after the hold delay (10 min).
 */
export async function enqueueHeldPattern(
  enrichedPattern: EnrichedPattern,
  delayMs: number,
): Promise<void> {
  const data: ScoringJobData = { enrichedPattern };
  await scoringQueue.add('score', data, {
    jobId: `rescore-${enrichedPattern.patternId}-${Date.now()}`,
    delay: delayMs,
  });
  logger.info(
    { patternId: enrichedPattern.patternId, delayMs },
    'Pattern held — will rescore',
  );
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function enqueueAction(scoredPattern: ScoredPattern): Promise<void> {
  const data: ActionJobData = { scoredPattern };
  await actionQueue.add('action', data, {
    jobId: `action-${scoredPattern.patternId}`,
  });
  logger.info(
    {
      patternId: scoredPattern.patternId,
      confidenceScore: scoredPattern.confidenceScore,
      recipient: scoredPattern.recommendedRecipient,
    },
    'Action enqueued — brief will be delivered',
  );
}

// ─── Dead Letter Queue ────────────────────────────────────────────────────────

export async function enqueueDLQ(entry: DLQJobData): Promise<void> {
  await deadLetterQueue.add('dlq', entry);
  logger.error(
    {
      originalQueue: entry.originalQueue,
      originalJobId: entry.originalJobId,
      error: entry.error,
    },
    'Job moved to dead letter queue',
  );
}
