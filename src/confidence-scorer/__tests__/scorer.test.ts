import { describe, it, expect } from '@jest/globals';
import { scorePattern, recommendRecipient, recommendAction } from '../scorer.js';
import type { EnrichedPattern } from '../../shared/types/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePattern(overrides: Partial<EnrichedPattern> = {}): EnrichedPattern {
  return {
    patternId: 'PAT-001',
    topicCluster: 'outage',
    relatedSignals: [
      {
        signalId: 'A',
        timestamp: Date.now(),
        channelId: 'C001',
        channelName: 'general',
        userId: 'U001',
        eventType: 'message',
        rawContent: 'service is down',
        extractedEntities: ['keyword:down'],
        urgencyHint: 8,
        workspaceId: 'WTEST',
      },
      {
        signalId: 'B',
        timestamp: Date.now(),
        channelId: 'C002',
        channelName: 'incidents',
        userId: 'U002',
        eventType: 'message',
        rawContent: 'critical outage',
        extractedEntities: ['keyword:critical', 'keyword:outage'],
        urgencyHint: 9,
        workspaceId: 'WTEST',
      },
    ],
    channelSpread: 2,
    timeWindow: { start: Date.now() - 5000, end: Date.now() },
    rawContextSummary: 'Outage detected across 2 channels',
    signalVelocity: 2,
    workspaceId: 'WTEST',
    externalContext: {
      deployStatus: 'UNAVAILABLE',
      ownerAvailability: 'UNAVAILABLE',
      currentMeeting: 'UNAVAILABLE',
      relatedTickets: 'UNAVAILABLE',
      onCallBackup: 'UNAVAILABLE',
      unavailableSources: ['github', 'jira'],
    },
    ...overrides,
  };
}

// ─── scorePattern ─────────────────────────────────────────────────────────────

describe('scorePattern', () => {
  it('returns a score between 0 and 100', () => {
    const result = scorePattern(makePattern());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('applies penalties for unavailable MCP sources', () => {
    const withPenalties = makePattern({
      externalContext: {
        deployStatus: 'UNAVAILABLE',
        ownerAvailability: 'UNAVAILABLE',
        currentMeeting: 'UNAVAILABLE',
        relatedTickets: 'UNAVAILABLE',
        onCallBackup: 'UNAVAILABLE',
        unavailableSources: ['github', 'jira'],
      },
    });

    const withoutPenalties = makePattern({
      externalContext: {
        deployStatus: [],
        ownerAvailability: 'available',
        currentMeeting: null,
        relatedTickets: [],
        onCallBackup: 'U999',
        unavailableSources: [],
      },
    });

    const penalised = scorePattern(withPenalties);
    const clean = scorePattern(withoutPenalties);
    expect(clean.score).toBeGreaterThanOrEqual(penalised.score);
  });

  it('routes to FIRE when score >= 85', () => {
    const highSignal = makePattern({
      channelSpread: 4,
      signalVelocity: 10,
      externalContext: {
        deployStatus: [{ sha: 'abc', status: 'failure', repo: 'org/repo', deployedAt: '', url: '' }],
        ownerAvailability: 'available',
        currentMeeting: null,
        relatedTickets: [{ id: 'BUG-1', title: 'Outage', status: 'Open', priority: 'P1', assignee: 'Alice', url: '' }],
        onCallBackup: 'U999',
        unavailableSources: [],
      },
      relatedSignals: Array.from({ length: 5 }, (_, i) => ({
        signalId: String(i),
        timestamp: Date.now(),
        channelId: `C00${i}`,
        channelName: `channel-${i}`,
        userId: `U00${i}`,
        eventType: 'message' as const,
        rawContent: 'CRITICAL OUTAGE fire fire fire!!!',
        extractedEntities: ['keyword:critical', 'keyword:outage', 'keyword:fire'],
        urgencyHint: 10,
        workspaceId: 'WTEST',
      })),
    });

    const result = scorePattern(highSignal);
    expect(result.decision).toBe('FIRE');
  });

  it('routes to DISCARD when score < 65', () => {
    const lowSignal = makePattern({
      channelSpread: 1,
      signalVelocity: 0.1,
      relatedSignals: [
        {
          signalId: 'X',
          timestamp: Date.now(),
          channelId: 'C001',
          channelName: 'random',
          userId: 'U001',
          eventType: 'message',
          rawContent: 'hello everyone',
          extractedEntities: [],
          urgencyHint: 0,
          workspaceId: 'WTEST',
        },
      ],
    });
    const result = scorePattern(lowSignal);
    expect(result.decision).toBe('DISCARD');
  });

  it('includes all breakdown factors', () => {
    const result = scorePattern(makePattern());
    expect(result.breakdown).toHaveProperty('channelSpread');
    expect(result.breakdown).toHaveProperty('signalVelocity');
    expect(result.breakdown).toHaveProperty('externalConfirmation');
    expect(result.breakdown).toHaveProperty('ownerAvailability');
    expect(result.breakdown).toHaveProperty('historicalMatch');
    expect(result.breakdown).toHaveProperty('sentimentUrgency');
    expect(result.breakdown).toHaveProperty('penalties');
    expect(result.breakdown).toHaveProperty('total');
  });
});

// ─── recommendRecipient ───────────────────────────────────────────────────────

describe('recommendRecipient', () => {
  it('recommends the user with the most signals', () => {
    const pattern = makePattern({
      relatedSignals: [
        { signalId: 'A', timestamp: Date.now(), channelId: 'C1', channelName: 'ch', userId: 'U_ACTIVE', eventType: 'message', rawContent: '', extractedEntities: [], urgencyHint: 5, workspaceId: 'W' },
        { signalId: 'B', timestamp: Date.now(), channelId: 'C1', channelName: 'ch', userId: 'U_ACTIVE', eventType: 'message', rawContent: '', extractedEntities: [], urgencyHint: 5, workspaceId: 'W' },
        { signalId: 'C', timestamp: Date.now(), channelId: 'C1', channelName: 'ch', userId: 'U_OTHER', eventType: 'message', rawContent: '', extractedEntities: [], urgencyHint: 5, workspaceId: 'W' },
      ],
    });
    expect(recommendRecipient(pattern)).toBe('U_ACTIVE');
  });
});
