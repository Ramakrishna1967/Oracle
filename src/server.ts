import express from 'express';
import { buildHealthReport } from './health/index.js';
import { createLogger } from './shared/utils/logger.js';

const logger = createLogger({ component: 'server' });

export function createApp(workspaceId: string): express.Express {
  const app = express();

  app.use(express.json());

  // ─── Health endpoint ──────────────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    try {
      const report = await buildHealthReport(workspaceId);
      const statusCode = report.status === 'ok' ? 200 : 503;
      res.status(statusCode).json(report);
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      res.status(500).json({ status: 'error', error: 'Health check failed' });
    }
  });

  // ─── Root ─────────────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.json({ service: 'oracle', version: '0.1.0', status: 'running' });
  });

  // ─── 404 ──────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ─── Error handler ────────────────────────────────────────────────────
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled Express error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
