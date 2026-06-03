import type { App } from '@slack/bolt';
import { createLogger } from '../../shared/utils/logger.js';
import { normalizeReactionEvent } from '../normalizer.js';
import { enqueueSignal } from '../../queue/producers.js';

const logger = createLogger({ component: 'signal-watcher.reaction' });

// Track reaction counts per message to detect spikes
// Key: `${channelId}:${messageTs}`, Value: { count, firstSeen }
const reactionWindow = new Map<string, { count: number; firstSeen: number }>();
const REACTION_SPIKE_THRESHOLD = 3;
const REACTION_SPIKE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isReactionSpike(channelId: string, messageTs: string): boolean {
  const key = `${channelId}:${messageTs}`;
  const now = Date.now();
  const entry = reactionWindow.get(key);

  if (!entry || now - entry.firstSeen > REACTION_SPIKE_WINDOW_MS) {
    reactionWindow.set(key, { count: 1, firstSeen: now });
    return false;
  }

  entry.count += 1;
  return entry.count >= REACTION_SPIKE_THRESHOLD;
}

export function registerReactionHandler(app: App, workspaceId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('reaction_added', async ({ event, client }: any) => {
    try {
      if (event.item.type !== 'message') return;

      const channelId: string = event.item.channel;
      const messageTs: string = event.item.ts;
      const spike = isReactionSpike(channelId, messageTs);

      // Only enqueue reaction signals for urgency reactions OR reaction spikes
      const isUrgentReaction = [
        'rotating_light', 'sos', 'fire', 'warning', 'x',
      ].includes(event.reaction);

      if (!isUrgentReaction && !spike) return;

      // Resolve channel name
      let channelName = channelId;
      try {
        const info = await client.conversations.info({ channel: channelId });
        channelName = (info.channel as { name?: string }).name ?? channelId;
      } catch {
        // fallback to ID
      }

      const signal = normalizeReactionEvent(
        {
          user: event.user,
          reaction: event.reaction,
          item: { type: event.item.type, channel: channelId, ts: messageTs },
          event_ts: event.event_ts,
        },
        channelName,
        workspaceId,
      );

      await enqueueSignal(signal);

      logger.debug(
        { signalId: signal.signalId, reaction: event.reaction, spike },
        'Reaction signal enqueued',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to handle reaction_added event');
    }
  });
}
