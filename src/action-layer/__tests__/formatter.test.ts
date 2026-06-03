import { describe, it, expect } from '@jest/globals';
import { formatBrief } from '../formatter.js';
import type { ScoredPattern } from '../../shared/types/index.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeScoredPattern(overrides: Partial<ScoredPattern> = {}): ScoredPattern {
  return {
    patternId: 'PAT-001',
    topicCluster: 'database-outage',
    relatedSignals: [
      {
        signalId: 'A',
        timestamp: Date.now() - 5000,
        channelId: 'C001',
        channelName: 'engineering',
        userId: 'U001',
        eventType: 'message',
        rawContent: 'DB is down',
        extractedEntities: ['keyword:down'],
        urgencyHint: 9,
        workspaceId: 'WTEST',
      },
      {
        signalId: 'B',
        timestamp: Date.now(),
        channelId: 'C002',
        channelName: 'incidents',
        userId: 'U002',
        eventType: 'message',
        rawContent: 'critical DB outage',
        extractedEntities: ['keyword:critical', 'keyword:outage'],
        urgencyHint: 10,
        workspaceId: 'WTEST',
      },
    ],
    channelSpread: 2,
    timeWindow: { start: Date.now() - 10000, end: Date.now() },
    rawContextSummary: 'DB outage across 2 channels',
    signalVelocity: 2.5,
    workspaceId: 'WTEST',
    externalContext: {
      deployStatus: [{
        sha: 'abc123',
        status: 'failure',
        repo: 'org/backend',
        deployedAt: new Date().toISOString(),
        url: 'https://github.com/org/backend/actions/1',
      }],
      ownerAvailability: 'available',
      currentMeeting: null,
      relatedTickets: [{
        id: 'BUG-42',
        title: 'Database connection pool exhausted',
        status: 'Open',
        priority: 'P1',
        assignee: 'Alice',
        url: 'https://jira.example.com/browse/BUG-42',
      }],
      onCallBackup: 'U999',
      unavailableSources: [],
    },
    confidenceScore: 91,
    scoreBreakdown: {
      channelSpread: 60,
      signalVelocity: 75,
      externalConfirmation: 100,
      ownerAvailability: 100,
      historicalMatch: 50,
      sentimentUrgency: 95,
      penalties: 0,
      total: 91,
    },
    recommendedRecipient: 'U001',
    recommendedAction: 'Investigate the failed deployment in org/backend and assess rollback.',
    scoredAt: Date.now(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('formatBrief', () => {
  it('returns blocks and fallback text', () => {
    const brief = formatBrief(makeScoredPattern());
    expect(brief.blocks).toBeDefined();
    expect(brief.text).toBeDefined();
    expect(brief.text.length).toBeGreaterThan(0);
  });

  it('includes confidence score in output', () => {
    const brief = formatBrief(makeScoredPattern({ confidenceScore: 91 }));
    const fullText = JSON.stringify(brief);
    expect(fullText).toContain('91');
  });

  it('includes topic cluster in situation block', () => {
    const brief = formatBrief(makeScoredPattern({ topicCluster: 'database-outage' }));
    const fullText = JSON.stringify(brief);
    expect(fullText).toContain('database-outage');
  });

  it('includes all 4 action buttons', () => {
    const brief = formatBrief(makeScoredPattern());
    const actionsBlock = brief.blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    const elements = (actionsBlock as { elements?: unknown[] }).elements ?? [];
    expect(elements).toHaveLength(4);
  });

  it('action buttons have correct action_ids', () => {
    const brief = formatBrief(makeScoredPattern());
    const actionsBlock = brief.blocks.find((b) => b.type === 'actions') as {
      elements: Array<{ action_id: string }>;
    };
    const actionIds = actionsBlock.elements.map((e) => e.action_id);
    expect(actionIds).toContain('oracle_notify_backup');
    expect(actionIds).toContain('oracle_post_status');
    expect(actionIds).toContain('oracle_escalate');
    expect(actionIds).toContain('oracle_dismiss');
  });

  it('shows UNAVAILABLE for missing deploy data', () => {
    const brief = formatBrief(makeScoredPattern({
      externalContext: {
        deployStatus: 'UNAVAILABLE',
        ownerAvailability: 'UNAVAILABLE',
        currentMeeting: 'UNAVAILABLE',
        relatedTickets: 'UNAVAILABLE',
        onCallBackup: 'UNAVAILABLE',
        unavailableSources: ['github', 'jira'],
      },
    }));
    const fullText = JSON.stringify(brief);
    expect(fullText).toContain('UNAVAILABLE');
  });

  it('button values contain pattern ID for routing', () => {
    const brief = formatBrief(makeScoredPattern({ patternId: 'PAT-XYZ' }));
    const actionsBlock = brief.blocks.find((b) => b.type === 'actions') as {
      elements: Array<{ value: string }>;
    };
    const values = actionsBlock.elements.map((e) => e.value);
    expect(values.every((v) => v === 'PAT-XYZ')).toBe(true);
  });
});
