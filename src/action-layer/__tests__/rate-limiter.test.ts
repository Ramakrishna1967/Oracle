import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const mockZremrangebyscore = jest.fn<() => Promise<number>>().mockResolvedValue(0);
const mockZcard = jest.fn<() => Promise<number>>().mockResolvedValue(0);
const mockZadd = jest.fn<() => Promise<number>>().mockResolvedValue(1);
const mockPexpire = jest.fn<() => Promise<number>>().mockResolvedValue(1);

jest.mock('../../config/redis.js', () => ({
  getGeneralConnection: jest.fn(() => ({
    zremrangebyscore: mockZremrangebyscore,
    zcard: mockZcard,
    zadd: mockZadd,
    pexpire: mockPexpire,
  })),
}));

// Import after mocks
const { checkRateLimit, recordDelivery } = await import('../rate-limiter.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    mockZcard.mockReset().mockResolvedValue(0);
    mockZremrangebyscore.mockReset().mockResolvedValue(0);
  });

  it('allows DM when under both limits', async () => {
    mockZcard.mockResolvedValue(0);
    const result = await checkRateLimit('WTEST', 'U001');
    expect(result.allowed).toBe(true);
    expect(result.userCount).toBe(0);
  });

  it('blocks DM when user is at their limit', async () => {
    mockZcard
      .mockResolvedValueOnce(3) // user count = 3 (at limit)
      .mockResolvedValueOnce(5); // workspace count

    const result = await checkRateLimit('WTEST', 'U001');
    expect(result.allowed).toBe(false);
  });

  it('blocks DM when workspace is at its limit', async () => {
    mockZcard
      .mockResolvedValueOnce(1)  // user count = 1 (fine)
      .mockResolvedValueOnce(20); // workspace count = 20 (at limit)

    const result = await checkRateLimit('WTEST', 'U001');
    expect(result.allowed).toBe(false);
  });

  it('activates batch mode at 90% workspace capacity', async () => {
    mockZcard
      .mockResolvedValueOnce(1)  // user
      .mockResolvedValueOnce(18); // workspace at 90% of 20

    const result = await checkRateLimit('WTEST', 'U001');
    expect(result.shouldBatch).toBe(true);
  });

  it('does not activate batch mode below 90%', async () => {
    mockZcard
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(10); // 50% of 20

    const result = await checkRateLimit('WTEST', 'U001');
    expect(result.shouldBatch).toBe(false);
  });
});

describe('recordDelivery', () => {
  it('increments both user and workspace counters', async () => {
    mockZremrangebyscore.mockResolvedValue(0);
    mockZcard.mockResolvedValue(1);
    mockZadd.mockResolvedValue(1);
    mockPexpire.mockResolvedValue(1);

    await recordDelivery('WTEST', 'U001');

    // zadd called twice: once for user key, once for workspace key
    expect(mockZadd).toHaveBeenCalledTimes(2);
  });
});
