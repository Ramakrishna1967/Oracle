import { WebClient } from '@slack/web-api';
import { getConfig } from '../config/index.js';
import { createLogger } from '../shared/utils/logger.js';
import { DeliveryError } from '../shared/utils/errors.js';
import { DM_MAX_RETRIES, DM_RETRY_DELAY_MS } from '../shared/constants.js';
import type { FormattedBrief } from './formatter.js';

const logger = createLogger({ component: 'action-layer.dm-sender' });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── DM delivery ──────────────────────────────────────────────────────────────

/**
 * Send a DM to a user. Two-step: conversations.open → chat.postMessage.
 * Retries twice with 30-second intervals before falling back to channel.
 */
export async function sendDirectMessage(
  userId: string,
  brief: FormattedBrief,
): Promise<{ channel: 'dm' | 'fallback'; messageTs: string }> {
  const config = getConfig();
  const client = new WebClient(config.slack.botToken);

  for (let attempt = 1; attempt <= DM_MAX_RETRIES + 1; attempt++) {
    try {
      // Open DM conversation
      const conv = await client.conversations.open({ users: userId });
      const dmChannelId = (conv.channel as { id?: string }).id;

      if (!dmChannelId) {
        throw new Error('conversations.open returned no channel ID');
      }

      // Send the brief
      const result = await client.chat.postMessage({
        channel: dmChannelId,
        text: brief.text,
        blocks: brief.blocks as any,
      });

      const messageTs = (result as { ts?: string }).ts ?? '';
      logger.info({ userId, dmChannelId, messageTs, attempt }, 'Brief delivered via DM');
      return { channel: 'dm', messageTs };
    } catch (err) {
      logger.warn({ err, userId, attempt }, `DM delivery attempt ${attempt} failed`);

      if (attempt <= DM_MAX_RETRIES) {
        await sleep(DM_RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted — fall back to configured channel
  const fallbackChannelId = config.oracle.fallbackChannelId;

  if (!fallbackChannelId) {
    throw new DeliveryError(userId, DM_MAX_RETRIES + 1);
  }

  try {
    const fallbackText = `[WARN] Could not DM <@${userId}>. Brief:\n${brief.text}`;
    const result = await client.chat.postMessage({
      channel: fallbackChannelId,
      text: fallbackText,
      blocks: brief.blocks as any,
    });

    const messageTs = (result as { ts?: string }).ts ?? '';
    logger.warn({ userId, fallbackChannelId, messageTs }, 'Brief delivered to fallback channel');
    return { channel: 'fallback', messageTs };
  } catch (err) {
    throw new DeliveryError(userId, DM_MAX_RETRIES + 1, err);
  }
}
