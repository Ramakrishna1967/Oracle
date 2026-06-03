import pino from 'pino';

const level = process.env['LOG_LEVEL'] ?? 'info';

/** Root logger — use createLogger() to get a component-scoped child */
export const rootLogger = pino({
  level,
  base: { service: 'oracle' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export interface LogContext {
  component: string;
  patternId?: string;
  signalId?: string;
  workspaceId?: string;
  durationMs?: number;
  status?: 'ok' | 'error' | 'skipped';
  errorCode?: string;
}

/**
 * Creates a child logger scoped to a specific component.
 * Every log entry will include the component name automatically.
 */
export function createLogger(context: LogContext): pino.Logger {
  return rootLogger.child(context);
}
