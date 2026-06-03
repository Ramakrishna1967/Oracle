import { z } from 'zod';
import { ConfigError } from '../shared/utils/errors.js';
import {
  MIN_CONFIDENCE_OVERRIDE,
  MAX_DMS_PER_USER_PER_HOUR,
  MAX_DMS_PER_WORKSPACE_PER_HOUR,
  FIRE_THRESHOLD,
} from '../shared/constants.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
  // Slack
  slack: z.object({
    botToken: z.string().min(1).startsWith('xoxb-'),
    appToken: z.string().min(1).startsWith('xapp-'),
    signingSecret: z.string().min(1),
  }),

  // Redis
  redis: z.object({
    url: z.string().url().default('redis://127.0.0.1:6379'),
  }),

  // Oracle tuning
  oracle: z.object({
    confidenceThreshold: z
      .number()
      .int()
      .min(MIN_CONFIDENCE_OVERRIDE)
      .max(100)
      .default(FIRE_THRESHOLD),
    maxDmsPerUserPerHour: z.number().int().positive().default(MAX_DMS_PER_USER_PER_HOUR),
    maxDmsPerWorkspacePerHour: z
      .number()
      .int()
      .positive()
      .default(MAX_DMS_PER_WORKSPACE_PER_HOUR),
    fallbackChannelId: z.string().default(''),
  }),

  // MCP
  mcp: z.object({
    github: z
      .object({
        command: z.string(),
        args: z.array(z.string()),
      })
      .optional(),
    jira: z
      .object({
        command: z.string(),
        args: z.array(z.string()),
      })
      .optional(),
  }),

  // Server
  server: z.object({
    port: z.number().int().positive().default(3000),
    logLevel: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  }),
});

export type OracleConfig = z.infer<typeof configSchema>;

// ─── Loader ───────────────────────────────────────────────────────────────────

function parseMCPArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim());
}

function loadConfig(): OracleConfig {
  const raw = {
    slack: {
      botToken: process.env['SLACK_BOT_TOKEN'],
      appToken: process.env['SLACK_APP_TOKEN'],
      signingSecret: process.env['SLACK_SIGNING_SECRET'],
    },
    redis: {
      url: process.env['REDIS_URL'],
    },
    oracle: {
      confidenceThreshold: process.env['CONFIDENCE_THRESHOLD']
        ? parseInt(process.env['CONFIDENCE_THRESHOLD'], 10)
        : undefined,
      maxDmsPerUserPerHour: process.env['MAX_DMS_PER_USER_PER_HOUR']
        ? parseInt(process.env['MAX_DMS_PER_USER_PER_HOUR'], 10)
        : undefined,
      maxDmsPerWorkspacePerHour: process.env['MAX_DMS_PER_WORKSPACE_PER_HOUR']
        ? parseInt(process.env['MAX_DMS_PER_WORKSPACE_PER_HOUR'], 10)
        : undefined,
      fallbackChannelId: process.env['FALLBACK_CHANNEL_ID'],
    },
    mcp: {
      github:
        process.env['MCP_GITHUB_COMMAND']
          ? {
              command: process.env['MCP_GITHUB_COMMAND'],
              args: parseMCPArgs(process.env['MCP_GITHUB_ARGS']),
            }
          : undefined,
      jira:
        process.env['MCP_JIRA_COMMAND']
          ? {
              command: process.env['MCP_JIRA_COMMAND'],
              args: parseMCPArgs(process.env['MCP_JIRA_ARGS']),
            }
          : undefined,
    },
    server: {
      port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : undefined,
      logLevel: process.env['LOG_LEVEL'],
      nodeEnv: process.env['NODE_ENV'],
    },
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _config: OracleConfig | undefined;

export function getConfig(): OracleConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset cached config — for testing only */
export function _resetConfig(): void {
  _config = undefined;
}
