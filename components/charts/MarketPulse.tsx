"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Minus,
} from "lucide-react";
import type { StockMarket } from "@/lib/stock-catalog";
import { marketColorPalette, marketChangeText } from "@/lib/market-colors";
import { AsyncPanel, asyncErrorMessage } from "@/components/shared/AsyncPanel";

interface MarketPulseData {
  generatedAt: string;
  dataAsOf?: string;
  sourceLabel?: string;
  catalogTotal?: number;
  coverageRatio?: number;
  stale?: boolean;
  advancing: number;
  declining: number;
  unchanged: number;
  avgChangePct: number;
  totalWithQuotes: number;
}

export function MarketPulse({ market }: { market: StockMarket }) {
  const [data, setData] = useState<MarketPulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchPulse = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/live/movers?market=${market}&limit=5`,
        { cache: "no-store", signal: controller.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as MarketPulseData;
      setData({
        ...payload,
        advancing: payload.advancing ?? 0,
        declining: payload.declining ?? 0,
        unchanged: payload.unchanged ?? 0,
        avgChangePct: payload.avgChangePct ?? 0,
        totalWithQuotes: payload.totalWithQuotes ?? 0,
      });
      setUpdatedAt(payload.dataAsOf ?? payload.generatedAt ?? new Date().toISOString());
      setError(payload.stale ? "数据源返回陈旧快照" : null);
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setError(asyncErrorMessage(fetchError));
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    setData(null);
    setError(null);
    setUpdatedAt(null);
    void fetchPulse();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchPulse();
    }, 10_000);

    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [fetchPulse]);

  const total = data ? data.advancing + data.declining + data.unchanged || 1 : 1;
  const advPct = data ? (data.advancing / total) * 100 : 0;
  const decPct = data ? (data.declining / total) * 100 : 0;
  const flatPct = data ? (data.unchanged / total) * 100 : 0;
  const positive = (data?.avgChangePct ?? 0) >= 0;
  const palette = marketColorPalette(market);

  return (
    <AsyncPanel
      header={
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/52">
            <Activity className="h-4 w-4 text-acid" />
            <span>MARKET PULSE — {market}</span>
          </div>
          {data && (
            <span
              className={`font-mono text-sm ${marketChangeText(market, data.avgChangePct)}`}
            >
              {positive ? "+" : ""}
              {data.avgChangePct.toFixed(3)}% avg
            </span>
          )}
        </div>
      }
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      sourceLabel={data?.sourceLabel}
      hasData={Boolean(data)}
      onRetry={() => void fetchPulse()}
      loadingLabel="正在同步市场脉冲..."
      minBodyClassName="min-h-20"
    >
      {data && <>
      <div className="flex h-8 overflow-hidden rounded-[6px]">
        {advPct > 0 && (
          <div
            className={`flex items-center justify-center transition-all duration-700 ${palette.riseBackground}`}
            style={{ width: `${advPct}%` }}
          >
            {advPct > 12 && (
              <span className="font-mono text-[10px] text-black">
                <ArrowUp className="inline h-3 w-3" />
                {advPct.toFixed(0)}%
              </span>
            )}
          </div>
        )}
        {flatPct > 0 && (
          <div
            className="flex items-center justify-center bg-white/10 transition-all duration-700"
            style={{ width: `${flatPct}%` }}
          >
            {flatPct > 12 && (
              <span className="font-mono text-[10px] text-white/48">
                <Minus className="inline h-3 w-3" />
                {flatPct.toFixed(0)}%
              </span>
            )}
          </div>
        )}
        {decPct > 0 && (
          <div
            className={`flex items-center justify-center transition-all duration-700 ${palette.fallBackground}`}
            style={{ width: `${decPct}%` }}
          >
            {decPct > 12 && (
              <span className="font-mono text-[10px] text-black">
                <ArrowDown className="inline h-3 w-3" />
                {decPct.toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-white/36">
        <span className={palette.riseText}>{data.advancing} advancing</span>
        <span>{data.unchanged} flat</span>
        <span className={palette.fallText}>{data.declining} declining</span>
      </div>
      </>}
    </AsyncPanel>
  );
}
