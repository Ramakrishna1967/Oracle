import { getConfig } from './config/index.js';
import { createLogger } from './shared/utils/logger.js';
import { startSignalWatcher, stopSignalWatcher } from './signal-watcher/index.js';
import { startPatternEngine, stopPatternEngine } from './pattern-engine/index.js';
import { startContextEnricher, stopContextEnricher } from './context-enricher/index.js';
import { startConfidenceScorer, stopConfidenceScorer } from './confidence-scorer/index.js';
import { startActionLayer, stopActionLayer } from './action-layer/index.js';
import { registerActionHandlers } from './action-layer/actions.handler.js';
import { registerHealthCommand } from './health/index.js';
import { createApp } from './server.js';
import { closeAllConnections } from './config/redis.js';

const logger = createLogger({ component: 'bootstrap' });

async function main() {
  logger.info('Starting Oracle...');
  
  // 1. Load config
  const config = getConfig();
  const workspaceId = process.env['SLACK_WORKSPACE_ID'] ?? 'oracle-workspace';

  // 2. Start BullMQ Workers
  startPatternEngine();
  await startContextEnricher();
  startConfidenceScorer();
  startActionLayer();

  // 3. Start Slack Bolt App (Signal Watcher)
  const app = await startSignalWatcher(workspaceId);

  // 4. Register Bolt Handlers for Actions and Health
  registerActionHandlers(app);
  // Overwrite the simple health command with the full one
  registerHealthCommand(app, workspaceId);

  // 5. Start Express API Server
  const expressApp = createApp(workspaceId);
  const server = expressApp.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'Express API server listening');
  });

  // 6. Graceful Shutdown
  const shutdown = async () => {
    logger.info('Shutting down Oracle...');
    
    server.close();
    await stopSignalWatcher();
    await stopActionLayer();
    await stopConfidenceScorer();
    await stopContextEnricher();
    await stopPatternEngine();
    await closeAllConnections();
    
    logger.info('Oracle shutdown complete. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
