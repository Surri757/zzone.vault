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

const CLEANUP_INTERVAL_MS = 120_000; // purge expired entries every 2 minutes

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

// Stats
let hits = 0;
let misses = 0;

// Periodic cleanup of expired entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (isExpired(entry, now)) {
        store.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const quoteCache = {
  /** Get a cached quote by instrument ID. Returns null if missing or expired. */
  get(id: string): LiveQuote | null {
    const entry = store.get(id);
    if (!entry) {
      misses += 1;
      return null;
    }
    if (isExpired(entry, Date.now())) {
      store.delete(id);
      misses += 1;
      return null;
    }
    hits += 1;
    return entry.quote;
  },

  /** Store a quote in the cache. */
  set(id: string, quote: LiveQuote): void {
    store.set(id, {
      quote,
      fetchedAt: Date.now(),
      ttl: ttlForQuote(quote),
    });
  },

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
        hits += 1;
        found.set(id, entry.quote);
      } else {
        if (entry) store.delete(id); // expired
        misses += 1;
        missing.push(id);
      }
    }

    return { found, missing };
  },

  /** Store many quotes at once. */
  setMany(quotes: LiveQuote[]): void {
    for (const quote of quotes) {
      store.set(quote.instrument.id, {
        quote,
        fetchedAt: Date.now(),
        ttl: ttlForQuote(quote),
      });
    }
  },

  /** Check which IDs are stale (expired or missing) and need a fresh fetch. */
  staleIds(ids: readonly string[]): string[] {
    const now = Date.now();
    return ids.filter((id) => {
      const entry = store.get(id);
      return !entry || isExpired(entry, now);
    });
  },

  /** Check if an ID has a fresh (non-expired) cached value. */
  isFresh(id: string): boolean {
    const entry = store.get(id);
    return entry !== undefined && !isExpired(entry, Date.now());
  },

  /** Remove specific IDs from cache. */
  invalidate(ids?: string[]): void {
    if (!ids) {
      store.clear();
      return;
    }
    for (const id of ids) {
      store.delete(id);
    }
  },

  /** Get cache statistics for monitoring. */
  stats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    return {
      size: store.size,
      hits,
      misses,
      hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
    };
  },
};
