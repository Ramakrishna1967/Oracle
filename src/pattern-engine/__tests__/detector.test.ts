import { describe, it, expect } from '@jest/globals';
import { detectPattern } from '../detector.js';
import type { SignalBucket } from '../store.js';
import type { Signal } from '../../shared/types/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(id: string, channelId: string, urgency = 5): Signal {
  return {
    signalId: id,
    timestamp: Date.now(),
    channelId,
    channelName: `#channel-${channelId}`,
    userId: 'U001',
    eventType: 'message',
    rawContent: 'outage detected',
    extractedEntities: ['keyword:outage'],
    urgencyHint: urgency,
    workspaceId: 'WTEST',
  };
}

function makeBucket(signals: Signal[]): SignalBucket {
  return {
    topicKey: 'WTEST:keyword:outage',
    signals,
    channels: new Set(signals.map((s) => s.channelId)),
    firstSeen: signals[0]?.timestamp ?? Date.now(),
    lastSeen: signals[signals.length - 1]?.timestamp ?? Date.now(),
    emittedPatternIds: new Set(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectPattern', () => {
  it('returns null for fewer than 2 signals', () => {
    const bucket = makeBucket([makeSignal('A', 'C001')]);
    const result = detectPattern(bucket, 'WTEST');
    expect(result.pattern).toBeNull();
    expect(result.correlated).toBe(false);
  });

  it('detects a cross-channel pattern with 2 signals', () => {
    const bucket = makeBucket([
      makeSignal('A', 'C001'),
      makeSignal('B', 'C002'),
    ]);
    const result = detectPattern(bucket, 'WTEST');
    expect(result.pattern).not.toBeNull();
    expect(result.pattern?.channelSpread).toBe(2);
    expect(result.pattern?.patternId).toBeTruthy();
    expect(result.pattern?.workspaceId).toBe('WTEST');
  });

  it('includes topic cluster label in emitted pattern', () => {
    const bucket = makeBucket([
      makeSignal('A', 'C001'),
      makeSignal('B', 'C002'),
    ]);
    const result = detectPattern(bucket, 'WTEST');
    expect(result.pattern?.topicCluster).toBe('outage');
  });

  it('does not re-emit pattern for the same bucket fingerprint', () => {
    const bucket = makeBucket([
      makeSignal('A', 'C001'),
      makeSignal('B', 'C002'),
    ]);

    const r1 = detectPattern(bucket, 'WTEST');
    expect(r1.pattern).not.toBeNull();

    const r2 = detectPattern(bucket, 'WTEST');
    expect(r2.pattern).toBeNull();
    expect(r2.reason).toContain('already emitted');
  });

  it('emits a new pattern when new signals arrive', () => {
    const signals = [makeSignal('A', 'C001'), makeSignal('B', 'C002')];
    const bucket = makeBucket(signals);

    const r1 = detectPattern(bucket, 'WTEST');
    expect(r1.pattern).not.toBeNull();

    // Add a new signal to the bucket
    const newSignal = makeSignal('C', 'C003');
    bucket.signals.push(newSignal);
    bucket.channels.add('C003');

    const r2 = detectPattern(bucket, 'WTEST');
    expect(r2.pattern).not.toBeNull();
    expect(r2.pattern?.patternId).not.toBe(r1.pattern?.patternId);
  });

  it('time window spans earliest to latest signal', () => {
    const t1 = Date.now() - 5000;
    const t2 = Date.now();
    const s1 = { ...makeSignal('A', 'C001'), timestamp: t1 };
    const s2 = { ...makeSignal('B', 'C002'), timestamp: t2 };
    const bucket = makeBucket([s1, s2]);
    const result = detectPattern(bucket, 'WTEST');
    expect(result.pattern?.timeWindow.start).toBe(t1);
    expect(result.pattern?.timeWindow.end).toBe(t2);
  });
});
