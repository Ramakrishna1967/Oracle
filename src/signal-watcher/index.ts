import { App, LogLevel } from '@slack/bolt';
import { createLogger } from '../shared/utils/logger.js';
import { getConfig } from '../config/index.js';
import { registerMessageHandler } from './handlers/message.handler.js';
import { registerReactionHandler } from './handlers/reaction.handler.js';
import { registerMemberHandler } from './handlers/member.handler.js';

const logger = createLogger({ component: 'signal-watcher' });

let _app: App | undefined;

export function getSlackApp(): App {
  if (!_app) {
    throw new Error('Signal Watcher not initialized. Call startSignalWatcher() first.');
  }
  return _app;
}

export async function startSignalWatcher(workspaceId: string): Promise<App> {
  const config = getConfig();

  _app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
    logLevel: config.server.nodeEnv === 'development' ? LogLevel.DEBUG : LogLevel.WARN,
  });

  // Register all event handlers
  registerMessageHandler(_app, workspaceId);
  registerReactionHandler(_app, workspaceId);
  registerMemberHandler(_app, workspaceId);

  // Register /oracle-health slash command (handled by health module)
  _app.command('/oracle-health', async ({ ack, respond }) => {
    await ack();
    // Health data is computed and responded to by the health module
    // This is just a passthrough — the full handler is registered in src/health/index.ts
    await respond({ text: 'Oracle is running ✅ — use `GET /health` for full diagnostics.' });
  });

  await _app.start();
  logger.info({ workspaceId }, 'Signal Watcher started (Socket Mode)');

  return _app;
}

export async function stopSignalWatcher(): Promise<void> {
  if (_app) {
    await _app.stop();
    _app = undefined;
    logger.info({}, 'Signal Watcher stopped');
  }
}
