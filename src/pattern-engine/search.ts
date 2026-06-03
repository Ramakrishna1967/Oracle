import { WebClient } from '@slack/web-api';
import { getConfig } from '../config/index.js';
import { getGeneralConnection } from '../config/redis.js';
import { createLogger } from '../shared/utils/logger.js';
import { RTS_MAX_CALLS_PER_MINUTE } from '../shared/constants.js';

const logger = createLogger({ component: 'pattern-engine.search' });

// ─── Rate limiter for RTS API ─────────────────────────────────────────────────

const RATE_KEY = 'oracle:rts:calls';
const WINDOW_MS = 60_000;

async function checkRateLimit(workspaceId: string): Promise<boolean> {
  const redis = getGeneralConnection();
  const key = `${RATE_KEY}:${workspaceId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Remove old entries outside the window
  await redis.zremrangebyscore(key, '-inf', windowStart);
  const count = await redis.zcard(key);

  if (count >= RTS_MAX_CALLS_PER_MINUTE) {
    logger.warn({ workspaceId, count }, 'RTS API rate limit reached — queuing');
    return false;
  }

  await redis.zadd(key, now, `${now}`);
  await redis.pexpire(key, WINDOW_MS * 2);
  return true;
}

// ─── Slack search ─────────────────────────────────────────────────────────────

export interface SearchResult {
  messages: Array<{
    ts: string;
    channel: string;
    text: string;
    user: string;
  }>;
  source: 'rts' | 'history' | 'unavailable';
}

/**
 * Search the workspace for messages related to a topic using the
 * RTS API (assistant.search.context). Falls back to a broader
 * message history scan if rate-limited or unavailable.
 */
export async function searchWorkspaceContext(
  query: string,
  workspaceId: string,
  channelIds: string[],
): Promise<SearchResult> {
  const config = getConfig();
  const client = new WebClient(config.slack.botToken);

  // Try RTS API first
  const allowed = await checkRateLimit(workspaceId);

  if (allowed) {
    try {
      // assistant.search.context is the RTS API method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (client as any).assistant.search.context({
        query,
        limit: 20,
      });

      const messages = (response.context_messages ?? []).map(
        (m: { ts: string; channel: string; text: string; user: string }) => ({
          ts: m.ts,
          channel: m.channel,
          text: m.text,
          user: m.user,
        }),
      );

      logger.debug({ query, resultCount: messages.length }, 'RTS search complete');
      return { messages, source: 'rts' };
    } catch (err) {
      logger.warn({ err, query }, 'RTS API failed — falling back to history');
    }
  }

  // Fallback: search conversations.history in affected channels
  const messages: SearchResult['messages'] = [];

  for (const channelId of channelIds.slice(0, 3)) {
    try {
      const response = await client.conversations.history({
        channel: channelId,
        limit: 10,
        oldest: String((Date.now() - 20 * 60 * 1000) / 1000), // last 20 min
      });

      for (const msg of response.messages ?? []) {
        if (msg.text?.toLowerCase().includes(query.toLowerCase())) {
          messages.push({
            ts: msg.ts ?? '',
            channel: channelId,
            text: msg.text ?? '',
            user: msg.user ?? '',
          });
        }
      }
    } catch (err) {
      logger.warn({ err, channelId }, 'conversations.history fallback failed');
    }
  }

  logger.debug({ query, resultCount: messages.length }, 'History fallback search complete');
  return { messages, source: messages.length > 0 ? 'history' : 'unavailable' };
}
