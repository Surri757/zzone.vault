import "server-only";

import type { LiveQuote } from "@/lib/live-instruments";

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  quote: LiveQuote;
  fetchedAt: number; // Date.now()
  ttl: number; // milliseconds
}

// ---------------------------------------------------------------------------
// TTL configuration (all values in milliseconds)
// ---------------------------------------------------------------------------

const TTL = {
  /** Licensed real-time (Tushare/Massive) — very short, data is live */
  LICENSED_REALTIME: 3_000,
  /** Public live feed during market hours */
  LIVE_PUBLIC: 4_000,
  /** Delayed public feed */
  DELAYED_PUBLIC: 30_000,
  /** Market closed, last known tick */
  LAST_TICK: 300_000,
  /** Error responses — can retry sooner */
  ERROR: 15_000,
  /** Default fallback when status is unrecognized */
  DEFAULT: 10_000,
} as const;

// A Workers isolate has no dependable background timer — a module-level
// setInterval will not fire between invocations — so eviction is lazy instead:
// reads drop whatever has expired, and a sweep runs before the store grows
// past this bound.
const MAX_ENTRIES = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ttlForQuote(quote: LiveQuote): number {
  switch (quote.feedStatus) {
    case "LICENSED_REALTIME":
      return TTL.LICENSED_REALTIME;
    case "LIVE_PUBLIC":
      return TTL.LIVE_PUBLIC;
    case "DELAYED_PUBLIC":
      return TTL.DELAYED_PUBLIC;
    case "MARKET_CLOSED_LAST_TICK":
      return TTL.LAST_TICK;
    case "ERROR":
      return TTL.ERROR;
    default:
      return TTL.DEFAULT;
  }
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.fetchedAt >= entry.ttl;
}

// ---------------------------------------------------------------------------
// Cache store
// ---------------------------------------------------------------------------

const store = new Map<string, CacheEntry>();

function sweepExpired(now: number): void {
  for (const [id, entry] of store) {
    if (isExpired(entry, now)) store.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const quoteCache = {
  /** Batch get — returns found quotes and a list of missing IDs. */
  getMany(ids: readonly string[]): {
    found: Map<string, LiveQuote>;
    missing: string[];
  } {
    const found = new Map<string, LiveQuote>();
    const missing: string[] = [];
    const now = Date.now();

    for (const id of ids) {
      const entry = store.get(id);
      if (entry && !isExpired(entry, now)) {
        found.set(id, entry.quote);
      } else {
        if (entry) store.delete(id); // expired
        missing.push(id);
      }
    }

    return { found, missing };
  },

  /** Store many quotes at once. */
  setMany(quotes: LiveQuote[]): void {
    const now = Date.now();
    if (store.size + quotes.length > MAX_ENTRIES) sweepExpired(now);

    for (const quote of quotes) {
      store.set(quote.instrument.id, {
        quote,
        fetchedAt: now,
        ttl: ttlForQuote(quote),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Single-flight deduplication
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Collapse concurrent identical upstream fetches into one request.
 *
 * The quote cache is the only one of the three server caches that had no
 * in-flight guard, so two overlapping requests for the same stale ids would
 * each run the full licensed → Tencent → public pipeline and double the
 * subrequest count. Callers must pass data (not a Response) through `work`,
 * because a Response body can only be consumed once.
 */
export async function withQuoteFetchDeduplication<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const pending = work().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
