import { describe, it, expect } from '@jest/globals';
import {
  extractEntities,
  computeUrgencyHint,
  makeSignalId,
  normalizeMessageEvent,
} from '../normalizer.js';
export interface GenericMessageEvent { text?: string; user?: string; ts?: string; channel?: string; subtype?: string; bot_id?: string; [key: string]: any; }

// ─── extractEntities ──────────────────────────────────────────────────────────

describe('extractEntities', () => {
  it('extracts user mentions', () => {
    const entities = extractEntities('Hey <@U12345> can you check this?');
    expect(entities).toContain('user:U12345');
  });

  it('extracts channel mentions', () => {
    const entities = extractEntities('Please post in <#C99999|incidents>');
    expect(entities).toContain('channel:incidents');
  });

  it('extracts domains from URLs', () => {
    const entities = extractEntities('See https://github.com/org/repo/issues/1');
    expect(entities).toContain('domain:github.com');
  });

  it('extracts urgency keywords', () => {
    const entities = extractEntities('The service is down and broken!');
    expect(entities).toContain('keyword:down');
    expect(entities).toContain('keyword:broken');
  });

  it('deduplicates identical entities', () => {
    const entities = extractEntities('down down down');
    const count = entities.filter((e) => e === 'keyword:down').length;
    expect(count).toBe(1);
  });

  it('returns empty array for plain text with no entities', () => {
    const entities = extractEntities('Hello everyone, have a great day!');
    expect(entities).toEqual([]);
  });
});

// ─── computeUrgencyHint ───────────────────────────────────────────────────────

describe('computeUrgencyHint', () => {
  it('returns 0 for neutral messages', () => {
    expect(computeUrgencyHint('Good morning team')).toBe(0);
  });

  it('scores single urgency keyword', () => {
    const score = computeUrgencyHint('service is down');
    expect(score).toBeGreaterThan(0);
  });

  it('scores multiple urgency keywords higher', () => {
    const low = computeUrgencyHint('service is down');
    const high = computeUrgencyHint('CRITICAL outage! service down and broken!');
    expect(high).toBeGreaterThan(low);
  });

  it('caps at 10', () => {
    const score = computeUrgencyHint(
      'CRITICAL OUTAGE!!! service down broken error crash FIRE P0 P1 alert timeout latency',
    );
    expect(score).toBeLessThanOrEqual(10);
  });
});

// ─── makeSignalId ─────────────────────────────────────────────────────────────

describe('makeSignalId', () => {
  it('produces a 32-char hex string', () => {
    const id = makeSignalId('C123', 'U456', '1234567890.000', 'hello');
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });

  it('is deterministic for the same inputs', () => {
    const id1 = makeSignalId('C123', 'U456', '1234567890.000', 'hello');
    const id2 = makeSignalId('C123', 'U456', '1234567890.000', 'hello');
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different content', () => {
    const id1 = makeSignalId('C123', 'U456', '1234567890.000', 'hello');
    const id2 = makeSignalId('C123', 'U456', '1234567890.000', 'world');
    expect(id1).not.toBe(id2);
  });
});

// ─── normalizeMessageEvent ────────────────────────────────────────────────────

describe('normalizeMessageEvent', () => {
  const mockEvent = {
    type: 'message',
    channel: 'C111',
    user: 'U222',
    text: 'The API is down! Critical outage.',
    ts: '1700000000.000',
    channel_type: 'channel',
  } as GenericMessageEvent;

  it('creates a valid signal', () => {
    const signal = normalizeMessageEvent(mockEvent, 'incidents', 'W999');
    expect(signal.channelId).toBe('C111');
    expect(signal.channelName).toBe('incidents');
    expect(signal.userId).toBe('U222');
    expect(signal.eventType).toBe('message');
    expect(signal.workspaceId).toBe('W999');
    expect(signal.signalId).toHaveLength(32);
  });

  it('detects urgency keywords in text', () => {
    const signal = normalizeMessageEvent(mockEvent, 'incidents', 'W999');
    expect(signal.urgencyHint).toBeGreaterThan(0);
    expect(signal.extractedEntities).toContain('keyword:down');
    expect(signal.extractedEntities).toContain('keyword:critical');
    expect(signal.extractedEntities).toContain('keyword:outage');
  });

  it('classifies thread replies correctly', () => {
    const threadEvent = {
      ...mockEvent,
      thread_ts: '1700000000.000',
      ts: '1700000001.000',
    } as GenericMessageEvent;
    const signal = normalizeMessageEvent(threadEvent, 'incidents', 'W999');
    expect(signal.eventType).toBe('thread_reply');
  });
});
