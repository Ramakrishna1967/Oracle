import type { Signal } from './signal.js';
import type { Pattern, EnrichedPattern, ScoredPattern } from './pattern.js';

// ─── Signal Queue job ─────────────────────────────────────────────────────────

export interface SignalJobData {
  signal: Signal;
}

export interface SignalJobResult {
  patternEmitted: boolean;
  patternId?: string;
}

// ─── Pattern Queue job ────────────────────────────────────────────────────────

export interface PatternJobData {
  pattern: Pattern;
}

export interface PatternJobResult {
  enriched: boolean;
  unavailableSources: string[];
}

// ─── Scoring Queue job ────────────────────────────────────────────────────────

export interface ScoringJobData {
  enrichedPattern: EnrichedPattern;
}

export type ScoringDecision = 'FIRE' | 'HOLD' | 'DISCARD';

export interface ScoringJobResult {
  decision: ScoringDecision;
  confidenceScore: number;
}

// ─── Action Queue job ─────────────────────────────────────────────────────────

export interface ActionJobData {
  scoredPattern: ScoredPattern;
}

export interface ActionJobResult {
  delivered: boolean;
  channel: 'dm' | 'fallback';
  messageTs?: string;
}

// ─── Dead Letter Queue job ────────────────────────────────────────────────────

export interface DLQJobData {
  originalQueue: string;
  originalJobId: string | undefined;
  jobName: string;
  data: unknown;
  error: string;
  stacktrace: string[];
  failedAt: string;
}
