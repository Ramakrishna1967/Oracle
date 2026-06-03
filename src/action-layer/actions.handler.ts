import type { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { getConfig } from '../config/index.js';
import { createLogger } from '../shared/utils/logger.js';
import { logAuditEvent } from './audit.js';

const logger = createLogger({ component: 'action-layer.actions' });

// In-memory store of patternId → ScoredPattern for button context
// In production, this would be a Redis-backed lookup
const patternStore = new Map<string, {
  topicCluster: string;
  onCallBackup: string | 'UNAVAILABLE';
  workspaceId: string;
  channelSpread: number;
}>();

export function cachePatternContext(patternId: string, context: {
  topicCluster: string;
  onCallBackup: string | 'UNAVAILABLE';
  workspaceId: string;
  channelSpread: number;
}): void {
  patternStore.set(patternId, context);
  // TTL: 2 hours
  setTimeout(() => patternStore.delete(patternId), 2 * 60 * 60 * 1000);
}

export function registerActionHandlers(app: App): void {
  const config = getConfig();
  const client = new WebClient(config.slack.botToken);

  // ─── Notify Backup ──────────────────────────────────────────────────────
  app.action('oracle_notify_backup', async ({ body, ack, respond }) => {
    await ack();
    const patternId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value ?? '';
    const ctx = patternStore.get(patternId);
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (ctx && ctx.onCallBackup !== 'UNAVAILABLE') {
      try {
        await client.chat.postMessage({
          channel: ctx.onCallBackup,
          text: `[ALERT] <@${userId}> flagged a "${ctx.topicCluster}" incident. You are listed as on-call backup. Please review.`,
        });
        await logAuditEvent(ctx.workspaceId, {
          patternId,
          action: 'notify_backup',
          recipient: ctx.onCallBackup,
          timestamp: Date.now(),
          success: true,
        });
        await respond({ text: '[SUCCESS] On-call backup has been notified.', replace_original: false });
      } catch (err) {
        logger.error({ err, patternId }, 'Failed to notify backup');
        await respond({ text: '[ERROR] Failed to notify backup. Check the fallback channel.', replace_original: false });
      }
    } else {
      await respond({ text: '[WARN] No on-call backup available. Notify manually.', replace_original: false });
    }
  });

  // ─── Post Status Update ─────────────────────────────────────────────────
  app.action('oracle_post_status', async ({ body, ack, respond }) => {
    await ack();
    const patternId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value ?? '';
    const ctx = patternStore.get(patternId);
    const userId = (body as { user?: { id?: string } }).user?.id;
    const fallbackId = config.oracle.fallbackChannelId;

    if (fallbackId) {
      try {
        await client.chat.postMessage({
          channel: fallbackId,
          text: `[UPDATE] *Status Update* — <@${userId}> is investigating the *"${ctx?.topicCluster ?? 'unknown'}"* incident. Updates to follow.`,
        });
        await respond({ text: '[SUCCESS] Status update posted.', replace_original: false });
      } catch (err) {
        logger.error({ err, patternId }, 'Failed to post status update');
        await respond({ text: '[ERROR] Could not post status update.', replace_original: false });
      }
    } else {
      await respond({ text: '[WARN] No fallback channel configured. Set FALLBACK_CHANNEL_ID.', replace_original: false });
    }
  });

  // ─── Escalate ───────────────────────────────────────────────────────────
  app.action('oracle_escalate', async ({ body, ack, respond }) => {
    await ack();
    const patternId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value ?? '';
    const ctx = patternStore.get(patternId);

    await respond({
      text: `[ESCALATED] Escalation triggered for *"${ctx?.topicCluster ?? 'unknown'}"*. ` +
        `Please contact your on-call manager directly and file an incident ticket.`,
      replace_original: false,
    });

    if (ctx) {
      await logAuditEvent(ctx.workspaceId, {
        patternId,
        action: 'escalate',
        recipient: (body as { user?: { id?: string } }).user?.id ?? '',
        timestamp: Date.now(),
        success: true,
      });
    }
  });

  // ─── Dismiss ────────────────────────────────────────────────────────────
  app.action('oracle_dismiss', async ({ body, ack, respond }) => {
    await ack();
    const patternId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value ?? '';
    const ctx = patternStore.get(patternId);

    await respond({ text: 'Dismissed. Oracle will continue monitoring.', replace_original: true });

    if (ctx) {
      await logAuditEvent(ctx.workspaceId, {
        patternId,
        action: 'dismiss',
        recipient: (body as { user?: { id?: string } }).user?.id ?? '',
        timestamp: Date.now(),
        success: true,
      });
      patternStore.delete(patternId);
    }

    logger.info({ patternId }, 'Brief dismissed by user');
  });
}
