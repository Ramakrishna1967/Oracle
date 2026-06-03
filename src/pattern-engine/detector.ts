import { randomUUID } from 'crypto';
import type { Pattern, Signal } from '../shared/types/index.js';
import { correlate, labelTopicCluster, buildContextSummary } from './correlator.js';
import type { SignalBucket } from './store.js';

// ─── Pattern detection ────────────────────────────────────────────────────────

export interface DetectionResult {
  pattern: Pattern | null;
  /** Whether this bucket was correlated at all */
  correlated: boolean;
  /** Human-readable reason for non-detection (for debugging) */
  reason?: string;
}

/**
 * Attempt to detect a new pattern from a signal bucket.
 * Returns null if the bucket does not meet pattern thresholds.
 *
 * A pattern is emitted at most once per bucket state — once emitted,
 * the pattern ID is recorded in `bucket.emittedPatternIds` to prevent
 * re-emission on subsequent signals until the topic changes meaningfully.
 */
export function detectPattern(
  bucket: SignalBucket,
  workspaceId: string,
): DetectionResult {
  const result = correlate(bucket);

  if (!result.isCorrelated) {
    return {
      pattern: null,
      correlated: false,
      reason: `Not correlated: ${bucket.signals.length} signals, ` +
        `${result.channelSpread} channels, velocity=${result.signalVelocity.toFixed(2)}/min`,
    };
  }

  // Build a fingerprint of the current bucket state to avoid re-emitting
  // the same pattern when nothing materially changed
  const fingerprint = buildBucketFingerprint(bucket);
  if (bucket.emittedPatternIds.has(fingerprint)) {
    return {
      pattern: null,
      correlated: true,
      reason: 'Pattern already emitted for this bucket state',
    };
  }

  const topicCluster = labelTopicCluster(result.topicKey);
  const signals = [...result.signals]; // snapshot

  const pattern: Pattern = {
    patternId: randomUUID(),
    topicCluster,
    relatedSignals: signals,
    channelSpread: result.channelSpread,
    timeWindow: {
      start: Math.min(...signals.map((s) => s.timestamp)),
      end: Math.max(...signals.map((s) => s.timestamp)),
    },
    rawContextSummary: buildContextSummary(signals, topicCluster),
    signalVelocity: result.signalVelocity,
    workspaceId,
  };

  // Record the fingerprint so we don't re-emit
  bucket.emittedPatternIds.add(fingerprint);

  return { pattern, correlated: true };
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * Build a stable fingerprint for the current state of a bucket.
 * Changes when new signals arrive or channels change.
 */
function buildBucketFingerprint(bucket: SignalBucket): string {
  const signalIds = bucket.signals.map((s: Signal) => s.signalId).sort().join(',');
  const channels = [...bucket.channels].sort().join(',');
  return `${signalIds}|${channels}`;
}
