import { Worker } from 'bullmq';
import { getWorkerConnection } from '../config/redis.js';
import { getConfig } from '../config/index.js';
import { createLogger } from '../shared/utils/logger.js';
import { enqueueScoringJob, enqueueDLQ } from '../queue/producers.js';
import { MCPClient } from './mcp-client.js';
import { fetchGitHubContext } from './adapters/github.adapter.js';
import { fetchJiraContext } from './adapters/jira.adapter.js';
import {
  QUEUE_PATTERN,
  CONCURRENCY_SCORING,
  JOB_MAX_ATTEMPTS,
} from '../shared/constants.js';
import type { PatternJobData, EnrichedPattern } from '../shared/types/index.js';

const logger = createLogger({ component: 'context-enricher' });

// ─── MCP client registry ──────────────────────────────────────────────────────

let githubClient: MCPClient | undefined;
let jiraClient: MCPClient | undefined;

async function initMCPClients(): Promise<void> {
  const config = getConfig();

  if (config.mcp.github) {
    githubClient = new MCPClient({
      name: 'github',
      command: config.mcp.github.command,
      args: config.mcp.github.args,
    });
    try {
      await githubClient.connect();
    } catch (err) {
      logger.warn({ err }, 'GitHub MCP unavailable at startup — will retry per call');
    }
  }

  if (config.mcp.jira) {
    jiraClient = new MCPClient({
      name: 'jira',
      command: config.mcp.jira.command,
      args: config.mcp.jira.args,
    });
    try {
      await jiraClient.connect();
    } catch (err) {
      logger.warn({ err }, 'Jira MCP unavailable at startup — will retry per call');
    }
  }
}

async function closeMCPClients(): Promise<void> {
  await Promise.all([githubClient?.close(), jiraClient?.close()]);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let _worker: Worker | undefined;

export async function startContextEnricher(): Promise<Worker> {
  await initMCPClients();

  _worker = new Worker<PatternJobData>(
    QUEUE_PATTERN,
    async (job) => {
      const { pattern } = job.data;
      const logCtx = { patternId: pattern.patternId, topic: pattern.topicCluster };
      logger.info(logCtx, 'Enriching pattern');

      const unavailableSources: string[] = [];
      const allEntities = pattern.relatedSignals.flatMap((s) => s.extractedEntities);

      // ─── GitHub enrichment ───────────────────────────────────────────────
      let deployStatus: EnrichedPattern['externalContext']['deployStatus'] = 'UNAVAILABLE';

      if (githubClient) {
        const ghResult = await fetchGitHubContext(githubClient, allEntities);
        if (ghResult === 'UNAVAILABLE') {
          unavailableSources.push('github');
          logger.warn(logCtx, 'GitHub MCP unavailable');
        } else {
          deployStatus = ghResult.deployStatus;
        }
      } else {
        unavailableSources.push('github');
      }

      // ─── Jira enrichment ─────────────────────────────────────────────────
      let relatedTickets: EnrichedPattern['externalContext']['relatedTickets'] = 'UNAVAILABLE';

      if (jiraClient) {
        const jiraResult = await fetchJiraContext(jiraClient, pattern.topicCluster, allEntities);
        if (jiraResult === 'UNAVAILABLE') {
          unavailableSources.push('jira');
          logger.warn(logCtx, 'Jira MCP unavailable');
        } else {
          relatedTickets = jiraResult.relatedTickets;
        }
      } else {
        unavailableSources.push('jira');
      }

      // ─── Build enriched pattern ───────────────────────────────────────────
      const enrichedPattern: EnrichedPattern = {
        ...pattern,
        externalContext: {
          deployStatus,
          ownerAvailability: 'UNAVAILABLE', // Calendar MCP not in Phase 1 scope
          currentMeeting: 'UNAVAILABLE',
          relatedTickets,
          onCallBackup: 'UNAVAILABLE',
          unavailableSources,
        },
      };

      logger.info(
        { ...logCtx, unavailableSources, ticketCount: Array.isArray(relatedTickets) ? relatedTickets.length : 0 },
        'Pattern enriched — enqueueing for scoring',
      );

      await enqueueScoringJob(enrichedPattern);
      return { enriched: true, unavailableSources };
    },
    {
      connection: getWorkerConnection() as any,
      concurrency: CONCURRENCY_SCORING,
    },
  );

  _worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ jobId: job.id, err: err.message }, 'Enrichment job failed');

    if (job.attemptsMade >= JOB_MAX_ATTEMPTS) {
      await enqueueDLQ({
        originalQueue: QUEUE_PATTERN,
        originalJobId: job.id,
        jobName: job.name,
        data: job.data,
        error: err.message,
        stacktrace: job.stacktrace ?? [],
        failedAt: new Date().toISOString(),
      });
    }
  });

  logger.info({ concurrency: CONCURRENCY_SCORING }, 'Context Enricher started');
  return _worker;
}

export async function stopContextEnricher(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = undefined;
  }
  await closeMCPClients();
  logger.info({}, 'Context Enricher stopped');
}
