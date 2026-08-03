"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StockBarsApiResponse,
  StockBarsResult,
  StockChartPeriod,
} from "@/lib/stock-bars";
import type { StockMarket } from "@/lib/stock-catalog";

type UseStockBarsOptions = {
  instrumentId: string;
  period: StockChartPeriod;
  market: StockMarket;
  marketOpen: boolean;
  refreshToken?: number;
};

type StockBarsState = {
  data: StockBarsResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  refresh: () => void;
};

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `stock bars ${response.status}`;
  } catch {
    return `stock bars ${response.status}`;
  }
}

function isScheduledMarketOpen(market: StockMarket, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market === "CN" ? "Asia/Shanghai" : "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((record, part) => {
      if (part.type !== "literal") record[part.type] = part.value;
      return record;
    }, {});

  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (market === "US") return minutes >= 570 && minutes < 960;
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

export function useStockBars({
  instrumentId,
  period,
  market,
  marketOpen,
  refreshToken = 0,
}: UseStockBarsOptions): StockBarsState {
  const [data, setData] = useState<StockBarsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const previousMarketOpenRef = useRef(marketOpen);
  const activeRequestKeyRef = useRef("");
  const errorKeyRef = useRef("");
  const staleOpenProbeCountRef = useRef(0);
  const requestKey = `${instrumentId}:${period}`;

  const load = useCallback(
    async (silent = false, force = false) => {
      if (!instrumentId || (silent && inFlightRef.current && !force)) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;

      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({ ids: instrumentId, period });
        const response = await fetch(`/api/live/bars?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseError(response));

        const payload = (await response.json()) as StockBarsApiResponse;
        const next = payload.results[0];
        if (!next || next.bars.length === 0) {
          throw new Error("真实行情源暂未返回该周期数据");
        }
        if (next.instrument.id !== instrumentId || next.period !== period) {
          throw new Error("行情响应与当前股票或周期不匹配");
        }
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          setData(next);
          if (next.stale) {
            errorKeyRef.current = requestKey;
            setError(next.staleReason || "真实行情源刷新失败");
          } else {
            errorKeyRef.current = "";
            setError("");
          }
        }
      } catch (reason) {
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          errorKeyRef.current = requestKey;
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [instrumentId, period, requestKey]
  );

  const currentData =
    data?.instrument.id === instrumentId && data.period === period ? data : null;
  const currentError = errorKeyRef.current === requestKey ? error : "";

  useEffect(() => {
    const keyChanged = activeRequestKeyRef.current !== requestKey;
    activeRequestKeyRef.current = requestKey;
    if (keyChanged) {
      setData(null);
      errorKeyRef.current = "";
      setError("");
      staleOpenProbeCountRef.current = 0;
      load(false);
    } else {
      load(true, true);
    }
    return () => controllerRef.current?.abort();
  }, [load, refreshToken, requestKey]);

  useEffect(() => {
    const previousMarketOpen = previousMarketOpenRef.current;
    previousMarketOpenRef.current = marketOpen;
    if (previousMarketOpen !== marketOpen) {
      staleOpenProbeCountRef.current = 0;
      load(true, true);
    }
  }, [load, marketOpen]);

  useEffect(() => {
    if (!instrumentId) {
      staleOpenProbeCountRef.current = 0;
      return;
    }

    const providerOpen = currentData?.marketState === "OPEN";
    const providerPolling =
      providerOpen || currentData?.marketState === "DELAYED";
    const scheduledOpen = marketOpen || isScheduledMarketOpen(market);
    const staleProbeDelays = [
      5_000,
      5_000,
      5_000,
      5_000,
      10_000,
      20_000,
      40_000,
      60_000,
    ];
    const intervalMs = providerPolling
      ? currentData.refreshAfterMs ?? 5_000
      : scheduledOpen
        ? staleProbeDelays[
            Math.min(staleOpenProbeCountRef.current, staleProbeDelays.length - 1)
          ]
        : 5_000;
    if (providerPolling || !scheduledOpen) staleOpenProbeCountRef.current = 0;

    const timer = window.setInterval(() => {
      if (
        !document.hidden &&
        (providerPolling || isScheduledMarketOpen(market))
      ) {
        if (!providerPolling) {
          staleOpenProbeCountRef.current = Math.min(
            staleOpenProbeCountRef.current + 1,
            staleProbeDelays.length - 1
          );
        }
        load(true);
      }
    }, intervalMs);
    const handleVisibility = () => {
      if (
        !document.hidden &&
        (providerPolling || isScheduledMarketOpen(market))
      ) {
        load(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [
    currentData?.generatedAt,
    currentData?.marketState,
    currentData?.refreshAfterMs,
    instrumentId,
    load,
    market,
    marketOpen,
  ]);

  const refresh = useCallback(() => load(false), [load]);

  return {
    data: currentData,
    loading: loading || (!currentData && !currentError),
    refreshing,
    error: currentError,
    refresh,
  };
}
