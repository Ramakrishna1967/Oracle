import type { ScoredPattern } from '../shared/types/index.js';

// ─── Slack Block Kit types (minimal) ─────────────────────────────────────────

type MrkdwnText = { type: 'mrkdwn'; text: string };
type PlainText = { type: 'plain_text'; text: string; emoji?: boolean };

interface SectionBlock {
  type: 'section';
  text: MrkdwnText;
}

interface ContextBlock {
  type: 'context';
  elements: MrkdwnText[];
}

interface ActionsBlock {
  type: 'actions';
  elements: ButtonElement[];
}

interface ButtonElement {
  type: 'button';
  text: PlainText;
  action_id: string;
  value: string;
  style?: 'primary' | 'danger';
}

type Block = SectionBlock | ContextBlock | ActionsBlock;

export interface FormattedBrief {
  text: string; // Fallback plain text
  blocks: Block[];
}

// ─── Formatter ────────────────────────────────────────────────────────────────

/**
 * Format a ScoredPattern into a Slack Block Kit message.
 * Structure:
 *  1. SITUATION — what is happening (2 sentences max)
 *  2. CONTEXT   — bullet points: deploy, tickets, channels
 *  3. CONFIDENCE — score + top 2 factors
 *  4. ACTION BUTTONS — 4 one-click buttons
 */
export function formatBrief(pattern: ScoredPattern): FormattedBrief {
  const { scoreBreakdown } = pattern;

  // ─── SITUATION ─────────────────────────────────────────────────────────
  const situationText = buildSituationText(pattern);

  // ─── CONTEXT ───────────────────────────────────────────────────────────
  const contextBullets = buildContextBullets(pattern);

  // ─── CONFIDENCE ────────────────────────────────────────────────────────
  const topFactors = getTopTwoFactors(scoreBreakdown);
  const confidenceText =
    `*Confidence:* ${pattern.confidenceScore}/100 ` +
    `| Top factors: ${topFactors.join(', ')}`;

  // ─── SUGGESTED ACTION ──────────────────────────────────────────────────
  const actionText = `*Suggested:* ${pattern.recommendedAction}`;

  const blocks: Block[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*SITUATION*\n${situationText}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*CONTEXT*\n${contextBullets}` },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: confidenceText },
        { type: 'mrkdwn', text: actionText },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Notify Backup', emoji: false },
          action_id: 'oracle_notify_backup',
          value: pattern.patternId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Post Status Update', emoji: false },
          action_id: 'oracle_post_status',
          value: pattern.patternId,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Escalate', emoji: false },
          action_id: 'oracle_escalate',
          value: pattern.patternId,
          style: 'danger',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss', emoji: false },
          action_id: 'oracle_dismiss',
          value: pattern.patternId,
        },
      ],
    },
  ];

  const fallbackText =
    `Oracle Alert (${pattern.confidenceScore}/100): ` +
    `${situationText} — ${pattern.recommendedAction}`;

  return { text: fallbackText, blocks };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSituationText(pattern: ScoredPattern): string {
  const channels = [
    ...new Set(pattern.relatedSignals.map((s) => `#${s.channelName}`)),
  ].join(', ');

  return (
    `Topic *"${pattern.topicCluster}"* is surfacing across ${channels} ` +
    `(${pattern.relatedSignals.length} signals, ${pattern.channelSpread} channels in 20 min).`
  );
}

function buildContextBullets(pattern: ScoredPattern): string {
  const { externalContext } = pattern;
  const bullets: string[] = [];

  // ── Deploy status ──────────────────────────────────────────────────────────
  if (Array.isArray(externalContext.deployStatus) && externalContext.deployStatus.length > 0) {
    const latest = externalContext.deployStatus[0];
    const statusText = latest?.status === 'failure' ? '[FAILED]' : latest?.status === 'in_progress' ? '[IN PROGRESS]' : '[SUCCESS]';
    bullets.push(`${statusText} *Deploy:* ${latest?.repo ?? 'unknown'} — ${latest?.status ?? 'unknown'}`);
  } else {
    // Derive deploy status from signal velocity & urgency
    const avgUrgency = pattern.relatedSignals.reduce((s, r) => s + (r.urgencyHint ?? 0), 0) / Math.max(pattern.relatedSignals.length, 1);
    const velocityHigh = pattern.signalVelocity >= 0.5;
    if (avgUrgency >= 7 || velocityHigh) {
      bullets.push(`[WARN] *Deploy:* Possible degradation detected — no CI/CD token configured`);
    } else if (avgUrgency >= 4) {
      bullets.push(`[INFO] *Deploy:* Status uncertain — connect GitHub to verify`);
    } else {
      bullets.push(`[OK] *Deploy:* No deployment signals detected`);
    }
  }

  // ── Jira / ticket status ───────────────────────────────────────────────────
  if (Array.isArray(externalContext.relatedTickets) && externalContext.relatedTickets.length > 0) {
    const t = externalContext.relatedTickets[0];
    bullets.push(`*Ticket:* ${t?.id} — ${t?.title} (${t?.priority}, assigned: ${t?.assignee})`);
  } else {
    // Derive a smart ticket summary from extracted entities & topic
    const allEntities = pattern.relatedSignals.flatMap((s) => s.extractedEntities);
    const keywords = [...new Set(
      allEntities
        .filter((e) => e.startsWith('keyword:'))
        .map((e) => e.replace('keyword:', ''))
    )].slice(0, 3);
    const topic = pattern.topicCluster.startsWith('C0')   // raw channel ID fallback
      ? keywords.join(', ') || 'unknown'
      : pattern.topicCluster;
    const signalCount = pattern.relatedSignals.length;
    bullets.push(`*Tickets:* No open ticket found — ${signalCount} signal${signalCount !== 1 ? 's' : ''} around *${topic}* (connect Jira to auto-link)`);
  }

  // ── Channels affected ──────────────────────────────────────────────────────
  const affected = [...new Set(pattern.relatedSignals.map((s) => `#${s.channelName}`))];
  bullets.push(`*Channels:* ${affected.join(', ')}`);

  // ── Velocity ───────────────────────────────────────────────────────────────
  bullets.push(`*Velocity:* ${pattern.signalVelocity.toFixed(1)} signals/min`);

  return bullets.map((b) => `• ${b}`).join('\n');
}

function getTopTwoFactors(breakdown: ScoredPattern['scoreBreakdown']): string[] {
  const factors = [
    { name: 'channel spread', score: breakdown.channelSpread },
    { name: 'signal velocity', score: breakdown.signalVelocity },
    { name: 'external confirmation', score: breakdown.externalConfirmation },
    { name: 'owner availability', score: breakdown.ownerAvailability },
    { name: 'historical match', score: breakdown.historicalMatch },
    { name: 'sentiment urgency', score: breakdown.sentimentUrgency },
  ];

  return factors
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((f) => `${f.name} (${f.score})`);
}
