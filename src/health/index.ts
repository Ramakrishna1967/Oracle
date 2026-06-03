import { getQueueHealth } from '../queue/queues.js';
import { readAuditLog } from '../action-layer/audit.js';
import { createLogger } from '../shared/utils/logger.js';
import { FIRE_RATE_WARNING_THRESHOLD } from '../shared/constants.js';
import type { App } from '@slack/bolt';

const logger = createLogger({ component: 'health' });

export interface ComponentHealth {
  name: string;
  status: 'ok' | 'degraded' | 'unavailable';
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptime: number;
  components: ComponentHealth[];
  queues: Awaited<ReturnType<typeof getQueueHealth>>;
  fireRate: { last60min: number; warning: boolean };
  timestamp: string;
}

const startTime = Date.now();

export async function buildHealthReport(workspaceId: string): Promise<HealthReport> {
  const queues = await getQueueHealth();

  // Count fire events in last 60 min from audit log
  const auditEntries = await readAuditLog(workspaceId, 200);
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recentFires = auditEntries.filter(
    (e) => e.action === 'brief_delivered' && e.timestamp > cutoff,
  );
  const fireCount = recentFires.length;
  const fireWarning = fireCount > FIRE_RATE_WARNING_THRESHOLD;

  if (fireWarning) {
    logger.warn({ fireCount, workspaceId }, '⚠️ Self-diagnostic: fire rate exceeds threshold');
  }

  const components: ComponentHealth[] = [
    { name: 'Signal Watcher', status: 'ok' },
    { name: 'Pattern Engine', status: queues.find(q => q.name.includes('signal'))?.active !== undefined ? 'ok' : 'unavailable' },
    { name: 'Context Enricher', status: queues.find(q => q.name.includes('pattern'))?.active !== undefined ? 'ok' : 'unavailable' },
    { name: 'Confidence Scorer', status: queues.find(q => q.name.includes('scoring'))?.active !== undefined ? 'ok' : 'unavailable' },
    { name: 'Action Layer', status: queues.find(q => q.name.includes('action'))?.active !== undefined ? 'ok' : 'unavailable' },
  ];

  const anyDegraded = components.some(c => c.status !== 'ok');

  return {
    status: anyDegraded ? 'degraded' : 'ok',
    uptime: Math.round((Date.now() - startTime) / 1000),
    components,
    queues,
    fireRate: { last60min: fireCount, warning: fireWarning },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Register the /oracle-health slash command full handler on the Bolt app.
 */
export function registerHealthCommand(app: App, workspaceId: string): void {
  app.command('/oracle-health', async ({ ack, respond }) => {
    await ack();

    const report = await buildHealthReport(workspaceId);

    const lines = [
      `*Oracle Health* — ${report.status === 'ok' ? '🟢 OK' : '🟡 DEGRADED'} | Uptime: ${report.uptime}s`,
      '',
      '*Components:*',
      ...report.components.map(c => `• ${c.name}: ${c.status === 'ok' ? '✅' : '⚠️'} ${c.status}`),
      '',
      '*Queue Depths:*',
      ...report.queues.map(q => `• \`${q.name}\` — waiting: ${q.waiting}, active: ${q.active}, failed: ${q.failed}`),
      '',
      `*Fire Rate (last 60min):* ${report.fireRate.last60min}${report.fireRate.warning ? ' ⚠️ HIGH' : ''}`,
    ];

    await respond({ text: lines.join('\n') });
  });
}
