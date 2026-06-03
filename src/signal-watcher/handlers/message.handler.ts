import type { App } from '@slack/bolt';
export interface GenericMessageEvent { text?: string; user?: string; ts?: string; channel?: string; subtype?: string; bot_id?: string; [key: string]: any; }
import { createLogger } from '../../shared/utils/logger.js';
import { normalizeMessageEvent } from '../normalizer.js';
import { enqueueSignal } from '../../queue/producers.js';

const logger = createLogger({ component: 'signal-watcher.message' });

export function registerMessageHandler(app: App, workspaceId: string): void {
  app.message(async ({ message, client }) => {
    try {
      // Only handle plain messages — filter out subtypes (edits, deletes, bots)
      if (message.subtype !== undefined) return;

      const msg = message as GenericMessageEvent;

      // Skip bot messages
      if (msg.bot_id) return;

      // Resolve channel name (best-effort — falls back to ID)
      let channelName = (msg.channel || '');
      try {
        const info = await client.conversations.info({ channel: (msg.channel || '') });
        channelName = (info.channel as { name?: string }).name ?? (msg.channel || '');
      } catch {
        // Non-critical — use channel ID as fallback
      }

      const signal = normalizeMessageEvent(msg, channelName, workspaceId);
      await enqueueSignal(signal);

      logger.debug(
        { signalId: signal.signalId, channel: channelName, urgencyHint: signal.urgencyHint },
        'Message signal enqueued',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to handle message event');
    }
  });
}
