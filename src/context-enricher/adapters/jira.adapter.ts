import { createLogger } from '../../shared/utils/logger.js';
import { MCPUnavailableError } from '../../shared/utils/errors.js';
import type { MCPClient } from '../mcp-client.js';
import type { TicketRef } from '../../shared/types/index.js';

const logger = createLogger({ component: 'context-enricher.jira' });

export interface JiraContext {
  relatedTickets: TicketRef[];
  sprintContext: string;
  escalationPath: string;
}

/**
 * Query Jira MCP for open tickets matching the pattern's topic entities.
 * Returns UNAVAILABLE sentinel on any MCP failure.
 */
export async function fetchJiraContext(
  client: MCPClient,
  topicCluster: string,
  entities: string[],
): Promise<JiraContext | 'UNAVAILABLE'> {
  if (!client.isConnected) return 'UNAVAILABLE';

  // Build JQL from keywords in entities
  const keywords = entities
    .filter((e) => e.startsWith('keyword:'))
    .map((e) => e.replace('keyword:', ''))
    .slice(0, 3);

  if (keywords.length === 0) {
    keywords.push(topicCluster);
  }

  const jqlText = keywords.map((k) => `text ~ "${k}"`).join(' OR ');
  const jql = `(${jqlText}) AND status != Done ORDER BY priority DESC`;

  const tickets: TicketRef[] = [];
  let sprintContext = 'Unknown';
  let escalationPath = 'Unknown';

  try {
    const searchResult = await client.callTool('search_issues', {
      jql,
      maxResults: 5,
      fields: ['summary', 'status', 'priority', 'assignee', 'components'],
    });

    const text = searchResult.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');

    try {
      const parsed = JSON.parse(text);
      const issues = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);

      for (const issue of issues.slice(0, 5)) {
        tickets.push({
          id: issue.key ?? issue.id ?? 'UNKNOWN',
          title: issue.fields?.summary ?? 'No title',
          status: issue.fields?.status?.name ?? 'Unknown',
          priority: issue.fields?.priority?.name ?? 'Unknown',
          assignee: issue.fields?.assignee?.displayName ?? 'Unassigned',
          url: `https://jira.example.com/browse/${issue.key}`,
        });
      }
    } catch {
      logger.debug({ textSample: text.slice(0, 200) }, 'Jira response is not JSON');
    }
  } catch (err) {
    if (err instanceof MCPUnavailableError) return 'UNAVAILABLE';
    logger.warn({ err, jql }, 'Jira issue search failed');
  }

  // Try to get current sprint context
  try {
    const sprintResult = await client.callTool('get_sprint', { state: 'active' });
    const sprintText = sprintResult.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();

    if (sprintText) {
      try {
        const sprint = JSON.parse(sprintText);
        const name = Array.isArray(sprint) ? sprint[0]?.name : sprint.name;
        sprintContext = name ?? sprintText.slice(0, 100);
      } catch {
        sprintContext = sprintText.slice(0, 100);
      }
    }
  } catch {
    // Sprint context is non-critical — leave as Unknown
  }

  // Escalation path from assignee of highest-priority ticket
  if (tickets.length > 0 && tickets[0].assignee !== 'Unassigned') {
    escalationPath = `Contact ${tickets[0].assignee} (assigned to ${tickets[0].id})`;
  }

  return { relatedTickets: tickets, sprintContext, escalationPath };
}
