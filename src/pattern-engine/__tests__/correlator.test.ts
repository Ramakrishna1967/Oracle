import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SignalStore, _resetStore } from '../store.js';
import type { Signal } from '../../shared/types/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    signalId: `sig-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    channelId: 'C001',
    channelName: 'general',
    userId: 'U001',
    eventType: 'message',
    rawContent: 'service is down',
    extractedEntities: ['keyword:down'],
    urgencyHint: 5,
    workspaceId: 'WTEST',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignalStore', () => {
  let store: SignalStore;

  beforeEach(() => {
    _resetStore();
    store = new SignalStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it('buckets signals by keyword entity', () => {
    const s = makeSignal({ extractedEntities: ['keyword:outage'] });
    const keys = store.add(s);
    expect(keys).toContain('WTEST:keyword:outage');
    expect(store.get('WTEST:keyword:outage')).toBeDefined();
  });

  it('falls back to channel bucket when no topic entities', () => {
    const s = makeSignal({ extractedEntities: [] });
    const keys = store.add(s);
    expect(keys).toContain('WTEST:channel:C001');
  });

  it('deduplicates signals with the same signalId', () => {
    const s = makeSignal({ signalId: 'FIXED', extractedEntities: ['keyword:down'] });
    store.add(s);
    store.add(s); // duplicate
    const bucket = store.get('WTEST:keyword:down');
    expect(bucket?.signals).toHaveLength(1);
  });

  it('tracks channel spread correctly', () => {
    const s1 = makeSignal({ channelId: 'C001', extractedEntities: ['keyword:down'], signalId: 'A' });
    const s2 = makeSignal({ channelId: 'C002', extractedEntities: ['keyword:down'], signalId: 'B' });
    store.add(s1);
    store.add(s2);
    const bucket = store.get('WTEST:keyword:down');
    expect(bucket?.channels.size).toBe(2);
  });

  it('evicts stale signals after window expires', () => {
    const oldSignal = makeSignal({
      signalId: 'OLD',
      extractedEntities: ['keyword:down'],
      timestamp: Date.now() - 25 * 60 * 1000, // 25 min ago (outside 20-min window)
    });
    store.add(oldSignal);
    // Force eviction by calling get
    const bucket = store.get('WTEST:keyword:down');
    expect(bucket).toBeUndefined(); // removed because all signals are stale
  });

  it('marks pattern IDs as emitted', () => {
    const s = makeSignal({ extractedEntities: ['keyword:outage'] });
    store.add(s);
    store.markPatternEmitted('WTEST:keyword:outage', 'PAT-001');
    const bucket = store.get('WTEST:keyword:outage');
    expect(bucket?.emittedPatternIds.has('PAT-001')).toBe(true);
  });
});
