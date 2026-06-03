import crypto from 'crypto';
export interface GenericMessageEvent { text?: string; user?: string; ts?: string; channel?: string; subtype?: string; bot_id?: string; [key: string]: any; }
import type { Signal } from '../shared/types/index.js';
import {
  URGENCY_KEYWORDS,
  REACTION_URGENCY_MAP,
} from '../shared/constants.js';

// ─── Entity extraction ────────────────────────────────────────────────────────

const USER_MENTION_RE = /<@([A-Z0-9]+)>/g;
const CHANNEL_MENTION_RE = /<#([A-Z0-9]+)\|([^>]+)>/g;
const URL_RE = /https?:\/\/[^\s>]+/g;

export function extractEntities(text: string): string[] {
  const entities: string[] = [];

  for (const match of text.matchAll(USER_MENTION_RE)) {
    entities.push(`user:${match[1]}`);
  }
  for (const match of text.matchAll(CHANNEL_MENTION_RE)) {
    entities.push(`channel:${match[2]}`);
  }
  for (const match of text.matchAll(URL_RE)) {
    try {
      const url = new URL(match[0]);
      entities.push(`domain:${url.hostname}`);
    } catch {
      // ignore malformed URLs
    }
  }

  const lower = text.toLowerCase();
  for (const kw of URGENCY_KEYWORDS) {
    if (lower.includes(kw)) {
      entities.push(`keyword:${kw}`);
    }
  }

  return [...new Set(entities)];
}

// ─── Urgency scoring ──────────────────────────────────────────────────────────

export function computeUrgencyHint(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const kw of URGENCY_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 1.5;
    }
  }

  // Exclamation marks add a small boost
  const exclamations = (text.match(/!/g) ?? []).length;
  score += Math.min(exclamations * 0.5, 2);

  // ALL CAPS words (3+ chars) signal urgency
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  score += Math.min(capsWords * 1, 3);

  return Math.min(Math.round(score), 10);
}

export function reactionUrgency(reactionName: string): number {
  return REACTION_URGENCY_MAP[reactionName] ?? 1;
}

// ─── Signal ID ────────────────────────────────────────────────────────────────

/**
 * Deterministic signal ID — SHA-256 of key event fields.
 * Guarantees deduplication even across restarts.
 */
export function makeSignalId(
  channelId: string,
  userId: string,
  timestamp: string,
  content: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${channelId}:${userId}:${timestamp}:${content}`)
    .digest('hex')
    .slice(0, 32);
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeMessageEvent(
  event: GenericMessageEvent,
  channelName: string,
  workspaceId: string,
): Signal {
  const text = event.text ?? '';
  const ts = event.ts ?? String(Date.now() / 1000);
  const userId = (event.user || '') ?? 'unknown';

  return {
    signalId: makeSignalId((event.channel || ''), userId, ts, text),
    timestamp: Math.round(parseFloat(ts) * 1000),
    channelId: (event.channel || ''),
    channelName,
    userId,
    eventType: event.thread_ts && event.thread_ts !== ts ? 'thread_reply' : 'message',
    rawContent: text,
    extractedEntities: extractEntities(text),
    urgencyHint: computeUrgencyHint(text),
    threadTs: event.thread_ts,
    workspaceId,
  };
}

export interface ReactionEvent {
  user: string;
  reaction: string;
  item: { type: string; channel: string; ts: string };
  event_ts: string;
}

export function normalizeReactionEvent(
  event: ReactionEvent,
  channelName: string,
  workspaceId: string,
): Signal {
  const content = `reaction:${event.reaction}`;

  return {
    signalId: makeSignalId(
      event.item.channel,
      (event.user || ''),
      event.event_ts,
      content,
    ),
    timestamp: Math.round(parseFloat(event.event_ts) * 1000),
    channelId: event.item.channel,
    channelName,
    userId: (event.user || ''),
    eventType: 'reaction',
    rawContent: content,
    extractedEntities: [`reaction:${event.reaction}`],
    urgencyHint: reactionUrgency(event.reaction),
    workspaceId,
  };
}

export interface MemberJoinEvent {
  user: string;
  channel: string;
  event_ts: string;
}

export function normalizeMemberJoinEvent(
  event: MemberJoinEvent,
  channelName: string,
  workspaceId: string,
): Signal {
  const content = `member_joined:${(event.channel || '')}`;

  return {
    signalId: makeSignalId((event.channel || ''), (event.user || ''), event.event_ts, content),
    timestamp: Math.round(parseFloat(event.event_ts) * 1000),
    channelId: (event.channel || ''),
    channelName,
    userId: (event.user || ''),
    eventType: 'member_joined',
    rawContent: content,
    extractedEntities: [`channel:${(event.channel || '')}`],
    urgencyHint: 1,
    workspaceId,
  };
}
