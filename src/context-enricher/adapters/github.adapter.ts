import { createLogger } from '../../shared/utils/logger.js';
import { MCPUnavailableError } from '../../shared/utils/errors.js';
import type { MCPClient } from '../mcp-client.js';
import type { DeployRef } from '../../shared/types/index.js';

const logger = createLogger({ component: 'context-enricher.github' });

export interface GitHubContext {
  deployStatus: DeployRef[];
  openIncidents: string[];
}

/**
 * Query GitHub MCP for recent deploy status and open incident-tagged issues.
 * Returns UNAVAILABLE sentinel on any MCP failure.
 */
export async function fetchGitHubContext(
  client: MCPClient,
  entities: string[],
): Promise<GitHubContext | 'UNAVAILABLE'> {
  if (!client.isConnected) return 'UNAVAILABLE';

  // Extract relevant repo names from entities (domain:github.com paths)
  const repos = entities
    .filter((e) => e.startsWith('domain:github.com'))
    .map((e) => e.replace('domain:github.com/', ''))
    .slice(0, 3);

  const deploys: DeployRef[] = [];
  const incidents: string[] = [];

  try {
    // Get recent workflow runs (deployments)
    const runsResult = await client.callTool('list_workflow_runs', {
      repo: repos[0] ?? '',
      status: 'all',
      per_page: 5,
    });

    const runsText = runsResult.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');

    // Parse JSON response if possible
    try {
      const parsed = JSON.parse(runsText);
      const runs = Array.isArray(parsed) ? parsed : (parsed.workflow_runs ?? []);

      for (const run of runs.slice(0, 5)) {
        deploys.push({
          sha: run.head_sha ?? 'unknown',
          status: mapGitHubStatus(run.conclusion ?? run.status),
          repo: run.repository?.full_name ?? repos[0] ?? '',
          deployedAt: run.created_at ?? new Date().toISOString(),
          url: run.html_url ?? '',
        });
      }
    } catch {
      // Non-JSON response — treat as raw text
      logger.debug({ runsText: runsText.slice(0, 200) }, 'GitHub runs response is not JSON');
    }
  } catch (err) {
    if (err instanceof MCPUnavailableError) return 'UNAVAILABLE';
    logger.warn({ err }, 'GitHub workflow runs fetch failed');
  }

  try {
    // Get open issues tagged as incidents or bugs
    const issuesResult = await client.callTool('search_issues', {
      query: `is:open label:incident OR label:outage`,
      per_page: 5,
    });

    const issuesText = issuesResult.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');

    try {
      const parsed = JSON.parse(issuesText);
      const items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      for (const issue of items.slice(0, 5)) {
        incidents.push(`#${issue.number}: ${issue.title} (${issue.html_url})`);
      }
    } catch {
      // ignore parse errors for incident list
    }
  } catch (err) {
    if (err instanceof MCPUnavailableError) return 'UNAVAILABLE';
    logger.warn({ err }, 'GitHub issues fetch failed');
  }

  return { deployStatus: deploys, openIncidents: incidents };
}

function mapGitHubStatus(
  raw: string,
): 'success' | 'failure' | 'in_progress' | 'queued' {
  switch (raw) {
    case 'success':
    case 'completed':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'cancelled':
      return 'failure';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'queued';
  }
}
