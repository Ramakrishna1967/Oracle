import { scoringQueue } from '../queue/queues.js';
import { createLogger } from '../shared/utils/logger.js';
import { HOLD_RESCORE_DELAY_MS } from '../shared/constants.js';
import type { EnrichedPattern } from '../shared/types/index.js';

const logger = createLogger({ component: 'confidence-scorer.hold-queue' });

/**
 * Schedule a pattern to be re-scored after the hold delay (10 minutes).
 * Uses BullMQ's built-in delayed job support.
 */
export async function holdAndRescore(pattern: EnrichedPattern): Promise<void> {
  await scoringQueue.add(
    'score',
    { enrichedPattern: pattern },
    {
      jobId: `rescore:${pattern.patternId}:${Date.now()}`,
      delay: HOLD_RESCORE_DELAY_MS,
    },
  );

  logger.info(
    {
      patternId: pattern.patternId,
      rescoreAt: new Date(Date.now() + HOLD_RESCORE_DELAY_MS).toISOString(),
    },
    'Pattern held — scheduled for rescore in 10 minutes',
  );
}
