import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { buildHealthReport } from '../index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetQueueHealth = jest.fn<() => Promise<Array<{ name: string; waiting: number; active: number; failed: number }>>>();
jest.mock('../../queue/queues.js', () => ({
  getQueueHealth: mockGetQueueHealth,
}));

const mockReadAuditLog = jest.fn<() => Promise<Array<{ action: string; timestamp: number }>>>();
jest.mock('../../action-layer/audit.js', () => ({
  readAuditLog: mockReadAuditLog,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildHealthReport', () => {
  beforeEach(() => {
    mockGetQueueHealth.mockReset().mockResolvedValue([
      { name: 'oracle:signal', waiting: 0, active: 1, failed: 0 },
      { name: 'oracle:pattern', waiting: 0, active: 1, failed: 0 },
      { name: 'oracle:scoring', waiting: 0, active: 1, failed: 0 },
      { name: 'oracle:action', waiting: 0, active: 1, failed: 0 },
    ]);
    mockReadAuditLog.mockReset().mockResolvedValue([]);
  });

  it('returns status ok when all components are healthy', async () => {
    const report = await buildHealthReport('WTEST');
    expect(report.status).toBe('ok');
    expect(report.components.every(c => c.status === 'ok')).toBe(true);
  });

  it('returns status degraded when a worker queue is missing', async () => {
    mockGetQueueHealth.mockResolvedValue([
      { name: 'oracle:signal', waiting: 0, active: 1, failed: 0 },
      // pattern queue missing
      { name: 'oracle:scoring', waiting: 0, active: 1, failed: 0 },
      { name: 'oracle:action', waiting: 0, active: 1, failed: 0 },
    ]);

    const report = await buildHealthReport('WTEST');
    expect(report.status).toBe('degraded');
    
    const patternComp = report.components.find(c => c.name === 'Context Enricher');
    expect(patternComp?.status).toBe('unavailable');
  });

  it('sets fire warning flag when fire rate exceeds threshold', async () => {
    // Threshold is 10/hour
    const recentFires = Array(15).fill({ action: 'brief_delivered', timestamp: Date.now() });
    mockReadAuditLog.mockResolvedValue(recentFires);

    const report = await buildHealthReport('WTEST');
    expect(report.fireRate.last60min).toBe(15);
    expect(report.fireRate.warning).toBe(true);
  });

  it('does not set fire warning flag when under threshold', async () => {
    const recentFires = Array(5).fill({ action: 'brief_delivered', timestamp: Date.now() });
    mockReadAuditLog.mockResolvedValue(recentFires);

    const report = await buildHealthReport('WTEST');
    expect(report.fireRate.last60min).toBe(5);
    expect(report.fireRate.warning).toBe(false);
  });
});
