/**
 * Tiny in-memory cache with a time-to-live and a bounded size.
 *
 * Generalizes the hand-rolled `Map<string, { value, expiresAt }>` that
 * `OrderRouteService` used, now that the Google Maps proxies need the same
 * thing. Every entry Google serves is billed, and the order form recomputes on
 * a 600 ms debounce, so a few seconds of memory saves real money.
 *
 * Per-process and deliberately so: these are cheap, idempotent lookups where a
 * cold instance costs one extra call, not a correctness problem. Eviction is
 * FIFO, which `Map` gives for free through its insertion order.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T): void {
    // Re-inserting must move the key to the back of the eviction queue.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Coordinate rounded to a stable cache key. Four decimals is about 11 m: a
 * marker jitter hits the cache, a real drag misses it.
 */
export function roundCoord(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}
