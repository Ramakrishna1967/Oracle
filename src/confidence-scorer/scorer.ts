import {
  WEIGHT_CHANNEL_SPREAD,
  WEIGHT_SIGNAL_VELOCITY,
  WEIGHT_EXTERNAL_CONFIRMATION,
  WEIGHT_OWNER_AVAILABILITY,
  WEIGHT_HISTORICAL_MATCH,
  WEIGHT_SENTIMENT_URGENCY,
  PENALTY_PER_UNAVAILABLE_MCP,
  FIRE_THRESHOLD,
  HOLD_THRESHOLD,
} from '../shared/constants.js';
import type { EnrichedPattern, ScoreBreakdown, ScoringDecision } from '../shared/types/index.js';

// ─── Factor scorers (each returns 0-100) ─────────────────────────────────────

/**
 * Score based on how many distinct channels the pattern spans.
 * 1 channel = 30, 2 = 60, 3 = 80, 4+ = 100
 */
function scoreChannelSpread(channelSpread: number): number {
  if (channelSpread >= 4) return 100;
  if (channelSpread === 3) return 80;
  if (channelSpread === 2) return 60;
  return 30;
}

/**
 * Score based on signal velocity (signals/minute).
 * ≥ 5/min = 100, ≥ 2/min = 75, ≥ 1/min = 50, < 1/min = 25
 */
function scoreSignalVelocity(velocity: number): number {
  if (velocity >= 5) return 100;
  if (velocity >= 2) return 75;
  if (velocity >= 1) return 50;
  return 25;
}

/**
 * Score based on MCP external system corroboration.
 * A failed deploy = 100, open incidents = 80, open Jira tickets = 60, nothing = 20
 */
function scoreExternalConfirmation(pattern: EnrichedPattern): number {
  const { deployStatus, relatedTickets } = pattern.externalContext;

  // Failing or in-progress deploy at same time as signal = strong corroboration
  if (Array.isArray(deployStatus) && deployStatus.length > 0) {
    const hasFailure = deployStatus.some((d) => d.status === 'failure');
    const hasInProgress = deployStatus.some((d) => d.status === 'in_progress');
    if (hasFailure) return 100;
    if (hasInProgress) return 80;
  }

  // Open Jira tickets matching the topic = moderate corroboration
  if (Array.isArray(relatedTickets) && relatedTickets.length > 0) {
    return 60;
  }

  // MCP responded but found nothing
  if (deployStatus !== 'UNAVAILABLE' || relatedTickets !== 'UNAVAILABLE') {
    return 20;
  }

  // All sources unavailable — lowest corroboration
  return 10;
}

/**
 * Score based on owner availability.
 * Available now = 100, in meeting = 40, UNAVAILABLE = 50 (neutral, no penalty here)
 */
function scoreOwnerAvailability(pattern: EnrichedPattern): number {
  const { ownerAvailability, currentMeeting } = pattern.externalContext;

  if (ownerAvailability === 'UNAVAILABLE') return 50; // neutral
  if (currentMeeting !== 'UNAVAILABLE' && currentMeeting !== null) return 40; // in meeting
  return 100; // available
}

/**
 * Score based on historical pattern match.
 * For now: always 50 (no history store yet — upgraded in future phases).
 */
function scoreHistoricalMatch(_pattern: EnrichedPattern): number {
  return 50;
}

/**
 * Score based on average urgency hint across all signals (0-10 → 0-100).
 */
function scoreSentimentUrgency(pattern: EnrichedPattern): number {
  const signals = pattern.relatedSignals;
  if (signals.length === 0) return 0;
  const avg = signals.reduce((sum, s) => sum + s.urgencyHint, 0) / signals.length;
  return Math.round((avg / 10) * 100);
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export interface ScoringResult {
  score: number;
  breakdown: ScoreBreakdown;
  decision: ScoringDecision;
}

export function scorePattern(pattern: EnrichedPattern): ScoringResult {
  const channelSpread = scoreChannelSpread(pattern.channelSpread);
  const signalVelocity = scoreSignalVelocity(pattern.signalVelocity);
  const externalConfirmation = scoreExternalConfirmation(pattern);
  const ownerAvailability = scoreOwnerAvailability(pattern);
  const historicalMatch = scoreHistoricalMatch(pattern);
  const sentimentUrgency = scoreSentimentUrgency(pattern);

  // Weighted sum
  const weightedSum =
    (channelSpread * WEIGHT_CHANNEL_SPREAD +
      signalVelocity * WEIGHT_SIGNAL_VELOCITY +
      externalConfirmation * WEIGHT_EXTERNAL_CONFIRMATION +
      ownerAvailability * WEIGHT_OWNER_AVAILABILITY +
      historicalMatch * WEIGHT_HISTORICAL_MATCH +
      sentimentUrgency * WEIGHT_SENTIMENT_URGENCY) /
    100;

  // Penalties for unavailable MCP sources
  const unavailableCount = pattern.externalContext.unavailableSources.length;
  const penalties = unavailableCount * PENALTY_PER_UNAVAILABLE_MCP;

  const total = Math.max(0, Math.min(100, Math.round(weightedSum - penalties)));

  const breakdown: ScoreBreakdown = {
    channelSpread,
    signalVelocity,
    externalConfirmation,
    ownerAvailability,
    historicalMatch,
    sentimentUrgency,
    penalties,
    total,
  };

  let decision: ScoringDecision;
  if (total >= FIRE_THRESHOLD) {
    decision = 'FIRE';
  } else if (total >= HOLD_THRESHOLD) {
    decision = 'HOLD';
  } else {
    decision = 'DISCARD';
  }

  return { score: total, breakdown, decision };
}

// ─── Recommended recipient ────────────────────────────────────────────────────

/**
 * Determine the best recipient for a brief.
 * Currently: the user with the most signals in the pattern (most involved).
 * Future: integrate on-call schedules.
 */
export function recommendRecipient(pattern: EnrichedPattern): string {
  const counts = new Map<string, number>();

  for (const signal of pattern.relatedSignals) {
    counts.set(signal.userId, (counts.get(signal.userId) ?? 0) + 1);
  }

  let topUser = 'UNKNOWN';
  let topCount = 0;

  for (const [userId, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topUser = userId;
    }
  }

  return topUser;
}

/**
 * Generate a one-sentence suggested next action based on scoring context.
 */
export function recommendAction(pattern: EnrichedPattern, breakdown: ScoreBreakdown): string {
  const { deployStatus, relatedTickets } = pattern.externalContext;

  if (Array.isArray(deployStatus) && deployStatus.some((d) => d.status === 'failure')) {
    return `Investigate the failed deployment in ${deployStatus[0]?.repo ?? 'the affected repo'} and assess rollback.`;
  }

  if (Array.isArray(relatedTickets) && relatedTickets.length > 0) {
    return `Review open ticket ${relatedTickets[0]?.id} (${relatedTickets[0]?.title}) and update status.`;
  }

  if (breakdown.channelSpread >= 3) {
    return `Coordinate a response across ${pattern.channelSpread} affected channels and post a status update.`;
  }

  return `Investigate the "${pattern.topicCluster}" signal in ${pattern.relatedSignals[0]?.channelName ?? 'the affected channel'}.`;
}
