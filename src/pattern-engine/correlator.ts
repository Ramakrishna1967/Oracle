import type { Signal } from '../shared/types/index.js';
import type { SignalBucket } from './store.js';

// ─── Jaccard similarity ───────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two entity sets.
 * Returns 0-1 where 1 = identical sets.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Signal velocity ──────────────────────────────────────────────────────────

/**
 * Compute signal velocity in signals per minute over the last windowMs.
 */
export function computeSignalVelocity(
  signals: Signal[],
  windowMs: number = 5 * 60 * 1000,
): number {
  const cutoff = Date.now() - windowMs;
  const recent = signals.filter((s) => s.timestamp >= cutoff);
  const windowMinutes = windowMs / 60_000;
  return recent.length / windowMinutes;
}

// ─── Correlation ─────────────────────────────────────────────────────────────

export interface CorrelationResult {
  topicKey: string;
  signals: Signal[];
  channelSpread: number;
  signalVelocity: number;
  /** Average urgency hint across all signals in the bucket */
  avgUrgency: number;
  isCorrelated: boolean;
}

/**
 * Analyze a signal bucket for cross-channel correlation.
 * Returns a CorrelationResult indicating whether this bucket constitutes a pattern.
 */
export function correlate(bucket: SignalBucket): CorrelationResult {
  const { signals, channels, topicKey } = bucket;

  const channelSpread = channels.size;
  const signalVelocity = computeSignalVelocity(signals);
  const avgUrgency =
    signals.length > 0
      ? signals.reduce((sum, s) => sum + s.urgencyHint, 0) / signals.length
      : 0;

  // A bucket is correlated if:
  // - ≥ 2 signals in the window (minimum pattern threshold), AND
  // - Has a velocity spike OR high urgency (single channel is fine)
  const meetsMinSignals = signals.length >= 2;
  const isVelocitySpike = signalVelocity >= 0.1; // very relaxed: any 2 messages in 20min window
  const isHighUrgency = avgUrgency >= 3;

  const isCorrelated = meetsMinSignals && (isVelocitySpike || isHighUrgency);

  return {
    topicKey,
    signals,
    channelSpread,
    signalVelocity,
    avgUrgency,
    isCorrelated,
  };
}

// ─── Topic cluster summary ────────────────────────────────────────────────────

/**
 * Produce a human-readable topic cluster label from the entity key.
 * e.g. "workspace:keyword:outage" → "outage"
 */
export function labelTopicCluster(topicKey: string): string {
  const parts = topicKey.split(':');
  // Strip workspace prefix and entity type prefix
  return parts.slice(2).join(':') || topicKey;
}

/**
 * Generate a plain-English context summary for a group of signals.
 */
export function buildContextSummary(signals: Signal[], topicCluster: string): string {
  const channels = [...new Set(signals.map((s) => s.channelName))];
  const uniqueUsers = new Set(signals.map((s) => s.userId)).size;
  const oldest = new Date(Math.min(...signals.map((s) => s.timestamp)));
  const newest = new Date(Math.max(...signals.map((s) => s.timestamp)));

  return (
    `Topic "${topicCluster}" surfaced in ${channels.join(', ')} ` +
    `(${signals.length} signals from ${uniqueUsers} users ` +
    `between ${oldest.toISOString()} and ${newest.toISOString()})`
  );
}
