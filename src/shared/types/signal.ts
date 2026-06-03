// Signal — the atomic unit emitted by the Signal Watcher for every Slack event.
// One signal = one normalized Slack event.

export type SignalEventType =
  | 'message'
  | 'reaction'
  | 'member_joined'
  | 'thread_reply';

export interface Signal {
  /** Deterministic SHA-256 hash of channelId+userId+timestamp+content */
  signalId: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  channelId: string;
  channelName: string;
  userId: string;
  eventType: SignalEventType;
  /** Raw text content of the event */
  rawContent: string;
  /** Entities extracted from content: usernames, channel refs, error keywords */
  extractedEntities: string[];
  /** Urgency hint 0–10 derived from keywords, emoji, and reaction spikes */
  urgencyHint: number;
  /** Optional: thread timestamp if this signal is a reply */
  threadTs?: string;
  /** Workspace/tenant ID for multi-tenancy isolation */
  workspaceId: string;
}
