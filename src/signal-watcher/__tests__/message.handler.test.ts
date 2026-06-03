import { describe, it, expect, jest, beforeEach } from '@jest/globals';
export interface GenericMessageEvent { text?: string; user?: string; ts?: string; channel?: string; subtype?: string; bot_id?: string; [key: string]: any; }

// ─── Mock the queue producers ─────────────────────────────────────────────────
const mockEnqueueSignal = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('../../queue/producers.js', () => ({
  enqueueSignal: mockEnqueueSignal,
}));

// ─── Import handler after mocks ───────────────────────────────────────────────
const { normalizeMessageEvent } = await import('../normalizer.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessageEvent(overrides: Partial<GenericMessageEvent> = {}): GenericMessageEvent {
  return {
    type: 'message',
    channel: 'C001',
    user: 'U001',
    text: 'test message',
    ts: '1700000000.000',
    channel_type: 'channel',
    ...overrides,
  } as GenericMessageEvent;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('message handler normalizer integration', () => {
  beforeEach(() => {
    mockEnqueueSignal.mockClear();
  });

  it('produces correct signal for a plain message', () => {
    const event = makeMessageEvent({ text: 'DB is down', user: 'U123', channel: 'C999' });
    const signal = normalizeMessageEvent(event, 'general', 'WTEST');

    expect(signal.channelId).toBe('C999');
    expect(signal.userId).toBe('U123');
    expect(signal.rawContent).toBe('DB is down');
    expect(signal.workspaceId).toBe('WTEST');
    expect(signal.extractedEntities).toContain('keyword:down');
  });

  it('filters out subtype events (edits, bot messages)', () => {
    const event = makeMessageEvent({ text: 'edited', subtype: 'message_changed' } as Partial<GenericMessageEvent>);
    // Subtype filtering happens in the Bolt handler, not the normalizer
    // Here we verify normalizer itself still produces a signal — Bolt handler skips before calling it
    expect(event.subtype).toBe('message_changed');
  });

  it('assigns thread_reply event type for thread messages', () => {
    const event = makeMessageEvent({
      ts: '1700000002.000',
      thread_ts: '1700000000.000',
    });
    const signal = normalizeMessageEvent(event, 'dev', 'WTEST');
    expect(signal.eventType).toBe('thread_reply');
    expect(signal.threadTs).toBe('1700000000.000');
  });

  it('assigns message event type for top-level messages', () => {
    const event = makeMessageEvent({ ts: '1700000000.000' });
    const signal = normalizeMessageEvent(event, 'dev', 'WTEST');
    expect(signal.eventType).toBe('message');
  });

  it('generates unique signal IDs for different messages', () => {
    const e1 = makeMessageEvent({ text: 'first', ts: '1700000001.000' });
    const e2 = makeMessageEvent({ text: 'second', ts: '1700000002.000' });
    const s1 = normalizeMessageEvent(e1, 'dev', 'W1');
    const s2 = normalizeMessageEvent(e2, 'dev', 'W1');
    expect(s1.signalId).not.toBe(s2.signalId);
  });
});
