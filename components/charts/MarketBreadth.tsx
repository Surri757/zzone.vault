"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import type { StockMarket } from "@/lib/stock-catalog";
import { marketColorPalette } from "@/lib/market-colors";
import { AsyncPanel, asyncErrorMessage } from "@/components/shared/AsyncPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadthData {
  market: StockMarket;
  generatedAt: string;
  dataAsOf?: string;
  sourceLabel?: string;
  catalogTotal?: number;
  coverageRatio?: number;
  stale?: boolean;
  advancing: number;
  declining: number;
  unchanged: number;
  upVolume: number;
  downVolume: number;
  totalVolume: number;
  newHighs: number | null;
  newLows: number | null;
  advDeclRatio: number;
  volumeRatio: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarketBreadth({ market }: { market: StockMarket }) {
  const [data, setData] = useState<BreadthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchBreadth = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/live/breadth?market=${market}`,
        { cache: "no-store", signal: controller.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as BreadthData;
      setData(payload);
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
    void fetchBreadth();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchBreadth();
    }, 30_000);

    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [fetchBreadth]);

  const totalIssues = data ? data.advancing + data.declining + data.unchanged || 1 : 1;
  const advPct = data ? (data.advancing / totalIssues) * 100 : 0;
  const decPct = data ? (data.declining / totalIssues) * 100 : 0;
  const palette = marketColorPalette(market);
  const ratioColor =
    (data?.advDeclRatio ?? 1) >= 1
      ? palette.riseText
      : (data?.advDeclRatio ?? 1) >= 0.7
        ? "text-amberline"
        : palette.fallText;
  const extremeTotal = (data?.newHighs ?? 0) + (data?.newLows ?? 0);
  const coverage = data?.coverageRatio;
  const coveragePercent =
    coverage === undefined
      ? null
      : Math.max(0, Math.min(100, coverage <= 1 ? coverage * 100 : coverage));

  return (
    <AsyncPanel
      header={
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/52">
            <BarChart3 className="h-4 w-4 text-cyanline" />
            MARKET BREADTH — {market}
          </div>
          {data && (
            <div className="shrink-0 text-right font-mono text-[10px] text-white/42">
              <span>COVERAGE {coveragePercent === null ? "--" : `${coveragePercent.toFixed(1)}%`}</span>
              {data.catalogTotal !== undefined && (
                <span className="ml-2 hidden sm:inline">CATALOG {data.catalogTotal.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      }
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      sourceLabel={data?.sourceLabel}
      hasData={Boolean(data)}
      onRetry={() => void fetchBreadth()}
      loadingLabel="正在同步涨跌统计..."
      minBodyClassName="min-h-56"
    >
      {data && <div className="grid grid-cols-2 gap-3">
        {/* A/D Ratio gauge */}
        <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
          <p className="font-mono text-[10px] text-white/36">ADVANCE / DECLINE</p>
          <p className={`mt-2 font-mono text-2xl ${ratioColor}`}>
            {data.advDeclRatio.toFixed(2)}
          </p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full">
            {advPct > 0 && (
              <div
                className={`${palette.riseBackground} transition-all duration-700`}
                style={{ width: `${advPct}%` }}
              />
            )}
            {decPct > 0 && (
              <div
                className={`${palette.fallBackground} transition-all duration-700`}
                style={{ width: `${decPct}%` }}
              />
            )}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px]">
            <span className={`flex items-center gap-0.5 ${palette.riseText}`}>
              <TrendingUp className="h-3 w-3" /> {data.advancing}
            </span>
            <span className={`flex items-center gap-0.5 ${palette.fallText}`}>
              <TrendingDown className="h-3 w-3" /> {data.declining}
            </span>
          </div>
        </div>

        {/* Volume ratio */}
        <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
          <p className="font-mono text-[10px] text-white/36">UP / DOWN VOLUME</p>
          <p
            className={`mt-2 font-mono text-2xl ${
              data.volumeRatio >= 1 ? palette.riseText : palette.fallText
            }`}
          >
            {data.volumeRatio.toFixed(2)}×
          </p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full">
            {data.totalVolume > 0 && (
              <>
                <div
                  className={`${palette.riseBackground} transition-all duration-700`}
                  style={{
                    width: `${(data.upVolume / data.totalVolume) * 100}%`,
                  }}
                />
                <div
                  className={`${palette.fallBackground} transition-all duration-700`}
                  style={{
                    width: `${(data.downVolume / data.totalVolume) * 100}%`,
                  }}
                />
              </>
            )}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px]">
            <span className={palette.riseText}>
              {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(data.upVolume)}
            </span>
            <span className={palette.fallText}>
              {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(data.downVolume)}
            </span>
          </div>
        </div>

        {/* New Highs / Lows */}
        <div className="col-span-2 rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
          <p className="font-mono text-[10px] text-white/36">52-WEEK EXTREMES</p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className={`font-mono text-lg ${palette.riseText}`}>
                  {data.newHighs ?? "--"}
                </p>
                <p className={`font-mono text-[10px] ${palette.riseText}`}>NEW HIGHS</p>
              </div>
              <span className="text-white/16 text-xl">/</span>
              <div className="text-center">
                <p className={`font-mono text-lg ${palette.fallText}`}>
                  {data.newLows ?? "--"}
                </p>
                <p className={`font-mono text-[10px] ${palette.fallText}`}>NEW LOWS</p>
              </div>
            </div>
            {data.newHighs !== null && data.newLows !== null && extremeTotal > 0 && (
              <div className="flex h-6 flex-1 max-w-32 overflow-hidden rounded-full">
                <div
                  className={palette.riseBackground}
                  style={{
                    width: `${(data.newHighs / extremeTotal) * 100}%`,
                  }}
                />
                <div
                  className={palette.fallBackground}
                  style={{
                    width: `${(data.newLows / extremeTotal) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>}
    </AsyncPanel>
  );
}
