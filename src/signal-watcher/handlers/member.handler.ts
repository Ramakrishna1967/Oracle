import type { App } from '@slack/bolt';
import { createLogger } from '../../shared/utils/logger.js';
import { normalizeMemberJoinEvent } from '../normalizer.js';
import { enqueueSignal } from '../../queue/producers.js';

const logger = createLogger({ component: 'signal-watcher.member' });

export function registerMemberHandler(app: App, workspaceId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('member_joined_channel', async ({ event, client }: any) => {
    try {
      // Skip bot joins
      if (event.inviter === undefined && event.subtype === 'channel_join') return;

      let channelName = event.channel;
      try {
        const info = await client.conversations.info({ channel: event.channel });
        channelName = (info.channel as { name?: string }).name ?? event.channel;
      } catch {
        // fallback
      }

      const signal = normalizeMemberJoinEvent(
        {
          user: event.user,
          channel: event.channel,
          event_ts: event.event_ts,
        },
        channelName,
        workspaceId,
      );

      await enqueueSignal(signal);
      logger.debug({ signalId: signal.signalId, channel: channelName }, 'Member join signal enqueued');
    } catch (err) {
      logger.error({ err }, 'Failed to handle member_joined_channel event');
    }
  });
}
