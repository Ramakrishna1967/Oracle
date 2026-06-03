// ─── Queue names ─────────────────────────────────────────────────────────────
export const QUEUE_SIGNAL = 'oracle-signal';
export const QUEUE_PATTERN = 'oracle-pattern';
export const QUEUE_SCORING = 'oracle-scoring';
export const QUEUE_ACTION = 'oracle-action';
export const QUEUE_DEAD_LETTER = 'oracle-dlq';

// ─── Queue concurrency limits ─────────────────────────────────────────────────
export const CONCURRENCY_SIGNAL = 50;
export const CONCURRENCY_PATTERN = 20;
export const CONCURRENCY_SCORING = 10;
export const CONCURRENCY_ACTION = 5;

// ─── Confidence thresholds ────────────────────────────────────────────────────
export const FIRE_THRESHOLD = 30;  // Lowered for single-workspace, no MCP
export const HOLD_THRESHOLD = 20;
export const MIN_CONFIDENCE_OVERRIDE = 25;

// ─── Scoring weights (must sum to 100) ────────────────────────────────────────
export const WEIGHT_CHANNEL_SPREAD = 25;
export const WEIGHT_SIGNAL_VELOCITY = 20;
export const WEIGHT_EXTERNAL_CONFIRMATION = 20;
export const WEIGHT_OWNER_AVAILABILITY = 15;
export const WEIGHT_HISTORICAL_MATCH = 10;
export const WEIGHT_SENTIMENT_URGENCY = 10;

// ─── Scoring penalties ────────────────────────────────────────────────────────
export const PENALTY_PER_UNAVAILABLE_MCP = 0; // No penalty if MCP not configured

// ─── Pattern detection windows ───────────────────────────────────────────────
/** 20-minute rolling window for pattern formation */
export const PATTERN_WINDOW_MS = 20 * 60 * 1000;

/** Patterns older than 60 minutes are expired and discarded */
export const PATTERN_EXPIRY_MS = 60 * 60 * 1000;

/** Minimum number of signals to form a pattern */
export const MIN_SIGNALS_FOR_PATTERN = 2; // 2 urgent messages in same channel is enough

/** Re-score held patterns after 10 minutes */
export const HOLD_RESCORE_DELAY_MS = 10 * 60 * 1000;

// ─── Rate limits ──────────────────────────────────────────────────────────────
/** Max Slack RTS API calls per minute per workspace */
export const RTS_MAX_CALLS_PER_MINUTE = 3;

/** Max DMs per user per 60-minute window */
export const MAX_DMS_PER_USER_PER_HOUR = 3;

/** Hard cap: total DMs per workspace per 60-minute window */
export const MAX_DMS_PER_WORKSPACE_PER_HOUR = 20;

/** Self-diagnostic: warn if Oracle fires more than this many times per hour */
export const FIRE_RATE_WARNING_THRESHOLD = 10;

// ─── MCP timeouts ─────────────────────────────────────────────────────────────
/** Max concurrent MCP calls per server */
export const MCP_MAX_CONCURRENT = 10;

/** Timeout per MCP tool call in ms */
export const MCP_CALL_TIMEOUT_MS = 8000;

/** Refresh OAuth token if it expires within this window */
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ─── Retry config ─────────────────────────────────────────────────────────────
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_BACKOFF_DELAY_MS = 1000;

/** Action layer DM retry attempts before falling back to channel */
export const DM_MAX_RETRIES = 2;
export const DM_RETRY_DELAY_MS = 30 * 1000;

// ─── Audit trail ──────────────────────────────────────────────────────────────
export const AUDIT_STREAM_KEY_PREFIX = 'oracle:audit';
export const AUDIT_STREAM_MAX_LEN = 10_000;

// ─── Urgency keywords (used by normalizer) ────────────────────────────────────
export const URGENCY_KEYWORDS: string[] = [
  'down',
  'broken',
  'urgent',
  'help',
  'blocked',
  'critical',
  'outage',
  'fire',
  'incident',
  'p0',
  'p1',
  'alert',
  'failing',
  'error',
  'crash',
  'degraded',
  'latency',
  'timeout',
];

/** Emoji reactions mapped to urgency score (0-10) */
export const REACTION_URGENCY_MAP: Record<string, number> = {
  rotating_light: 10,
  sos: 10,
  fire: 8,
  warning: 7,
  x: 6,
  eyes: 5,
  question: 3,
  thinking_face: 2,
};
