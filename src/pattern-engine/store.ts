import { PATTERN_WINDOW_MS, PATTERN_EXPIRY_MS } from '../shared/constants.js';
import type { Signal } from '../shared/types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalBucket {
  topicKey: string;
  signals: Signal[];
  channels: Set<string>;
  firstSeen: number;
  lastSeen: number;
  emittedPatternIds: Set<string>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * In-memory sliding-window store for signals, keyed by topic/entity.
 * Signals older than PATTERN_WINDOW_MS are evicted on each access.
 * Full expiry cleanup runs every PATTERN_EXPIRY_MS.
 */
export class SignalStore {
  private readonly buckets = new Map<string, SignalBucket>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic full cleanup of expired buckets
    this.cleanupTimer = setInterval(() => this.evictExpired(), PATTERN_EXPIRY_MS);
  }

  /**
   * Add a signal to its matching topic bucket(s).
   * Returns the topic keys that this signal was bucketed under.
   */
  add(signal: Signal): string[] {
    const keys = this.topicKeysFor(signal);

    for (const key of keys) {
      let bucket = this.buckets.get(key);

      if (!bucket) {
        bucket = {
          topicKey: key,
          signals: [],
          channels: new Set(),
          firstSeen: signal.timestamp,
          lastSeen: signal.timestamp,
          emittedPatternIds: new Set(),
        };
        this.buckets.set(key, bucket);
      }

      // Evict stale signals from this bucket
      this.evictStale(bucket);

      // Deduplicate by signalId
      if (!bucket.signals.some((s) => s.signalId === signal.signalId)) {
        bucket.signals.push(signal);
        bucket.channels.add(signal.channelId);
        bucket.lastSeen = signal.timestamp;
      }
    }

    return keys;
  }

  /** Get a bucket by topic key (with stale eviction) */
  get(topicKey: string): SignalBucket | undefined {
    const bucket = this.buckets.get(topicKey);
    if (!bucket) return undefined;
    this.evictStale(bucket);
    if (bucket.signals.length === 0) {
      this.buckets.delete(topicKey);
      return undefined;
    }
    return bucket;
  }

  /** Get all active buckets */
  getAll(): SignalBucket[] {
    for (const [key, bucket] of this.buckets) {
      this.evictStale(bucket);
      if (bucket.signals.length === 0) this.buckets.delete(key);
    }
    return [...this.buckets.values()];
  }

  markPatternEmitted(topicKey: string, patternId: string): void {
    this.buckets.get(topicKey)?.emittedPatternIds.add(patternId);
  }

  get size(): number {
    return this.buckets.size;
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Derive topic keys from a signal's extracted entities.
   * Each meaningful entity becomes its own bucketing key.
   */
  private topicKeysFor(signal: Signal): string[] {
    const keys: string[] = [];

    for (const entity of signal.extractedEntities) {
      // Keyword and domain entities make good topic keys
      if (entity.startsWith('keyword:') || entity.startsWith('domain:')) {
        keys.push(`${signal.workspaceId}:${entity}`);
      }
    }

    // Always bucket by channel to detect channel-wide panics
    keys.push(`${signal.workspaceId}:channel:${signal.channelId}`);

    return keys;
  }

  private evictStale(bucket: SignalBucket): void {
    const cutoff = Date.now() - PATTERN_WINDOW_MS;
    bucket.signals = bucket.signals.filter((s) => s.timestamp >= cutoff);
    bucket.channels = new Set(bucket.signals.map((s) => s.channelId));
  }

  private evictExpired(): void {
    const cutoff = Date.now() - PATTERN_EXPIRY_MS;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeen < cutoff) {
        this.buckets.delete(key);
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _store: SignalStore | undefined;

export function getSignalStore(): SignalStore {
  if (!_store) _store = new SignalStore();
  return _store;
}

/** For testing only */
export function _resetStore(): void {
  _store?.destroy();
  _store = undefined;
}
