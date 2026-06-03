import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLogger } from '../shared/utils/logger.js';
import { MCPUnavailableError, MCPTimeoutError } from '../shared/utils/errors.js';
import { MCP_CALL_TIMEOUT_MS, MCP_MAX_CONCURRENT } from '../shared/constants.js';

const logger = createLogger({ component: 'context-enricher.mcp-client' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// ─── Semaphore ────────────────────────────────────────────────────────────────

class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}

// ─── MCP Client Wrapper ───────────────────────────────────────────────────────

export class MCPClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private readonly semaphore: Semaphore;
  private connected = false;

  constructor(private readonly config: MCPServerConfig) {
    this.semaphore = new Semaphore(MCP_MAX_CONCURRENT);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
      });

      this.client = new Client(
        { name: 'oracle', version: '0.1.0' },
        { capabilities: { } },
      );

      await this.client.connect(this.transport);
      this.connected = true;

      logger.info({ server: this.config.name }, 'MCP client connected');
    } catch (err) {
      this.connected = false;
      throw new MCPUnavailableError(this.config.name, err);
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    if (!this.client || !this.connected) {
      throw new MCPUnavailableError(this.config.name);
    }

    await this.semaphore.acquire();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new MCPTimeoutError(this.config.name, toolName)),
            MCP_CALL_TIMEOUT_MS,
          );
        }),
      ]);

      logger.debug({ server: this.config.name, toolName }, 'MCP tool call succeeded');
      return result as MCPToolResult;
    } catch (err) {
      if (err instanceof MCPTimeoutError) {
        logger.warn({ server: this.config.name, toolName }, 'MCP tool call timed out');
        throw err;
      }
      logger.error({ err, server: this.config.name, toolName }, 'MCP tool call failed');
      throw new MCPUnavailableError(this.config.name, err);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.semaphore.release();
    }
  }

  async listTools(): Promise<string[]> {
    if (!this.client || !this.connected) return [];
    try {
      const { tools } = await this.client.listTools();
      return tools.map((t) => t.name);
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.connected = false;
      logger.info({ server: this.config.name }, 'MCP client disconnected');
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get serverName(): string {
    return this.config.name;
  }
}

// ─── Parse tool result text ───────────────────────────────────────────────────

export function parseToolResultText(result: MCPToolResult): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
    .trim();
}
