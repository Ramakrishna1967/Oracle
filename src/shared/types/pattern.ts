import type { Signal } from './signal.js';

// ─── Raw Pattern ──────────────────────────────────────────────────────────────

export interface Pattern {
  /** UUID v4 */
  patternId: string;
  /** The dominant topic/entity cluster driving this pattern */
  topicCluster: string;
  /** All correlated signals that form this pattern */
  relatedSignals: Signal[];
  /** Number of distinct channels where the topic appeared */
  channelSpread: number;
  timeWindow: {
    /** Unix ms — earliest signal */
    start: number;
    /** Unix ms — latest signal */
    end: number;
  };
  /** Human-readable summary of what signals say collectively */
  rawContextSummary: string;
  /** Signals per minute on this topic at time of pattern detection */
  signalVelocity: number;
  workspaceId: string;
}

// ─── MCP Enrichment ──────────────────────────────────────────────────────────

export type MCPFieldValue<T> = T | 'UNAVAILABLE';

export interface TicketRef {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  url: string;
}

export interface DeployRef {
  sha: string;
  status: 'success' | 'failure' | 'in_progress' | 'queued';
  repo: string;
  deployedAt: string;
  url: string;
}

export interface ExternalContext {
  deployStatus: MCPFieldValue<DeployRef[]>;
  ownerAvailability: MCPFieldValue<string>;
  currentMeeting: MCPFieldValue<string | null>;
  relatedTickets: MCPFieldValue<TicketRef[]>;
  onCallBackup: MCPFieldValue<string>;
  /** Which MCP sources were unavailable */
  unavailableSources: string[];
}

export interface EnrichedPattern extends Pattern {
  externalContext: ExternalContext;
}

// ─── Scored Pattern ───────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  channelSpread: number;
  signalVelocity: number;
  externalConfirmation: number;
  ownerAvailability: number;
  historicalMatch: number;
  sentimentUrgency: number;
  /** Sum of penalties for unavailable MCP sources */
  penalties: number;
  total: number;
}

export interface ScoredPattern extends EnrichedPattern {
  confidenceScore: number;
  scoreBreakdown: ScoreBreakdown;
  /** Slack user ID of the person who should receive the brief */
  recommendedRecipient: string;
  /** One sentence — the clearest next action */
  recommendedAction: string;
  scoredAt: number;
}

// ─── Action Outcome ───────────────────────────────────────────────────────────

export type ActionType =
  | 'notify_backup'
  | 'post_status_update'
  | 'escalate'
  | 'dismiss';

export interface ActionOutcome {
  patternId: string;
  action: ActionType | 'brief_delivered' | 'brief_failed';
  recipient: string;
  timestamp: number;
  success: boolean;
  error?: string;
}
