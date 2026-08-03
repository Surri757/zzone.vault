"use client";

import { useEffect, useState } from "react";
import type { LiveQuote } from "@/lib/live-instruments";
import type { StockMarket } from "@/lib/stock-catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuoteStreamState {
  quotes: Map<string, LiveQuote>;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  /** Connection status for the polling loop */
  connected: boolean;
}

export interface UseQuoteStreamOptions {
  /** Stock IDs to subscribe to */
  ids: string[];
  /** Active market (affects polling interval) */
  market: StockMarket;
  /** Poll interval override (ms). Default: 5s during market hours, 60s otherwise. */
  interval?: number;
  /** Whether to auto-start polling. Default: true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Market hours helper
// ---------------------------------------------------------------------------

function isStockMarketOpen(market: StockMarket, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market === "CN" ? "Asia/Shanghai" : "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (market === "US") return minutes >= 570 && minutes < 960;
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

// ---------------------------------------------------------------------------
// Default intervals
// ---------------------------------------------------------------------------

const DEFAULT_ACTIVE_INTERVAL = 5_000; // 5s during market hours
const DEFAULT_IDLE_INTERVAL = 60_000; // 60s when market is closed
const MAX_IDS_PER_REQUEST = 200;

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useQuoteStream({
  ids,
  market,
  interval: intervalOverride,
  enabled = true,
}: UseQuoteStreamOptions): QuoteStreamState {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const idsKey = ids.join(",");

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setConnected(false);
      return;
    }

    const subscribedIds = idsKey.split(",").filter(Boolean);
    if (subscribedIds.length === 0) {
      setQuotes(new Map());
      setLoading(false);
      setError(null);
      setConnected(false);
      return;
    }

    let disposed = false;
    let requestInFlight = false;
    let controller: AbortController | null = null;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const pollingInterval = () =>
      intervalOverride ??
      (isStockMarketOpen(market) ? DEFAULT_ACTIVE_INTERVAL : DEFAULT_IDLE_INTERVAL);

    const scheduleNext = () => {
      if (disposed || document.hidden) return;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        void fetchQuotes();
      }, pollingInterval());
    };

    async function fetchQuotes() {
      if (disposed || requestInFlight || document.hidden) return;

      requestInFlight = true;
      controller = new AbortController();

      try {
        const idChunks = chunkIds(subscribedIds, MAX_IDS_PER_REQUEST);
        const responses = await Promise.all(
          idChunks.map(async (chunk) => {
            const response = await fetch(
              `/api/live/quotes?ids=${encodeURIComponent(chunk.join(","))}`,
              { cache: "no-store", signal: controller?.signal }
            );
            if (!response.ok) throw new Error(`quotes ${response.status}`);
            return (await response.json()) as {
              quotes: LiveQuote[];
              generatedAt: string;
            };
          })
        );

        if (disposed || controller.signal.aborted) return;

        const allQuotes = responses.flatMap((response) => response.quotes);
        const nextQuotes = new Map<string, LiveQuote>();
        for (const quote of allQuotes) {
          nextQuotes.set(quote.instrument.id, quote);
        }

        setQuotes(nextQuotes);
        setLastUpdated(responses[0]?.generatedAt ?? new Date().toISOString());
        setError(allQuotes.length > 0 ? null : "行情源暂未返回数据");
        setConnected(allQuotes.length > 0);
      } catch (reason) {
        if (!disposed && !controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setConnected(false);
        }
      } finally {
        requestInFlight = false;
        controller = null;
        if (!disposed) {
          setLoading(false);
          scheduleNext();
        }
      }
    }

    const handleVisibilityChange = () => {
      clearTimer();
      if (!document.hidden) void fetchQuotes();
    };

    setLoading(true);
    timer = window.setTimeout(() => {
      timer = null;
      void fetchQuotes();
    }, 0);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, idsKey, intervalOverride, market]);

  return {
    quotes,
    loading,
    error,
    lastUpdated,
    connected,
  };
}
