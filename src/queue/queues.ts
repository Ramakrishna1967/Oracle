import { Queue } from 'bullmq';
import { getProducerConnection } from '../config/redis.js';
import {
  QUEUE_SIGNAL,
  QUEUE_PATTERN,
  QUEUE_SCORING,
  QUEUE_ACTION,
  QUEUE_DEAD_LETTER,
  JOB_MAX_ATTEMPTS,
  JOB_BACKOFF_DELAY_MS,
} from '../shared/constants.js';
import type {
  SignalJobData,
  PatternJobData,
  ScoringJobData,
  ActionJobData,
  DLQJobData,
} from '../shared/types/index.js';

// ─── Default job options ──────────────────────────────────────────────────────

const defaultJobOptions = {
  attempts: JOB_MAX_ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: JOB_BACKOFF_DELAY_MS,
  },
  removeOnComplete: {
    count: 1000,
    age: 24 * 60 * 60, // 24 hours
  },
  removeOnFail: {
    count: 5000,
    age: 7 * 24 * 60 * 60, // 7 days
  },
};

// ─── Queue instances ──────────────────────────────────────────────────────────

export const signalQueue = new Queue<SignalJobData>(QUEUE_SIGNAL, {
  connection: getProducerConnection() as any,
  defaultJobOptions,
});

export const patternQueue = new Queue<PatternJobData>(QUEUE_PATTERN, {
  connection: getProducerConnection() as any,
  defaultJobOptions,
});

export const scoringQueue = new Queue<ScoringJobData>(QUEUE_SCORING, {
  connection: getProducerConnection() as any,
  defaultJobOptions,
});

export const actionQueue = new Queue<ActionJobData>(QUEUE_ACTION, {
  connection: getProducerConnection() as any,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2, // Action layer uses its own DM retry logic
  },
});

export const deadLetterQueue = new Queue<DLQJobData>(QUEUE_DEAD_LETTER, {
  connection: getProducerConnection() as any,
  defaultJobOptions: {
    removeOnComplete: { count: 10_000, age: 30 * 24 * 60 * 60 },
    removeOnFail: false, // Never auto-remove DLQ failures
  },
});

// ─── Queue health snapshot ────────────────────────────────────────────────────

export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function getQueueHealth(): Promise<QueueHealth[]> {
  const queues = [signalQueue, patternQueue, scoringQueue, actionQueue, deadLetterQueue];

  return Promise.all(
    queues.map(async (q) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getCompletedCount(),
        q.getFailedCount(),
        q.getDelayedCount(),
      ]);
      return {
        name: q.name,
        waiting,
        active,
        completed,
        failed,
        delayed,
      };
    }),
  );
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    signalQueue.close(),
    patternQueue.close(),
    scoringQueue.close(),
    actionQueue.close(),
    deadLetterQueue.close(),
  ]);
}
