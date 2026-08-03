"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import type { StockMarket } from "@/lib/stock-catalog";
import { marketColorPalette } from "@/lib/market-colors";
import { AsyncPanel, asyncErrorMessage } from "@/components/shared/AsyncPanel";

interface TopMover {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  changePct: number;
  price: number | null;
}

interface MoversData {
  generatedAt: string;
  dataAsOf?: string;
  sourceLabel?: string;
  catalogTotal?: number;
  coverageRatio?: number;
  stale?: boolean;
  topGainers: TopMover[];
  topLosers: TopMover[];
  advancing: number;
  declining: number;
  unchanged: number;
  totalWithQuotes: number;
  avgChangePct: number;
}

export function TopMovers({ market }: { market: StockMarket }) {
  const [data, setData] = useState<MoversData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchMovers = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/live/movers?market=${market}&limit=20`,
        { cache: "no-store", signal: controller.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as MoversData;
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
    void fetchMovers();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchMovers();
    }, 15_000);

    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [fetchMovers]);

  const palette = marketColorPalette(market);

  return (
    <AsyncPanel
      header={
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/52">
            <Trophy className="h-4 w-4 text-amberline" />
            TOP MOVERS — {market}
          </div>
          {data && (
            <div className="flex items-center gap-3 font-mono text-xs text-white/36">
              <span className={`flex items-center gap-1 ${palette.riseText}`}>
                <TrendingUp className="h-3 w-3" />
                {data.advancing}
              </span>
              <span className={`flex items-center gap-1 ${palette.fallText}`}>
                <TrendingDown className="h-3 w-3" />
                {data.declining}
              </span>
              <span>{data.unchanged} flat</span>
            </div>
          )}
        </div>
      }
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      sourceLabel={data?.sourceLabel}
      hasData={Boolean(data)}
      onRetry={() => void fetchMovers()}
      loadingLabel="正在同步排行榜..."
      minBodyClassName="min-h-[30rem] md:min-h-[18rem]"
    >
      {data && <div className="grid gap-4 md:grid-cols-2">
        {/* Gainers */}
        <div>
          <p className={`mb-2 flex items-center gap-1 font-mono text-xs ${palette.riseText}`}>
            <ArrowUpRight className="h-3 w-3" />
            GAINERS
          </p>
          <div className="grid gap-1">
            {data.topGainers.slice(0, 10).map((mover, index) => (
              <div
                key={mover.id}
                className="flex items-center justify-between rounded-[6px] border border-white/[0.06] bg-white/[0.025] px-3 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-white/28 w-5 text-right">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs text-white truncate">
                    {mover.symbol}
                  </span>
                  <span className="text-[10px] text-white/36 truncate hidden sm:inline">
                    {mover.name.slice(0, 12)}
                  </span>
                </div>
                <span className={`ml-2 shrink-0 font-mono text-xs ${palette.riseText}`}>
                  +{mover.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Losers */}
        <div>
          <p className={`mb-2 flex items-center gap-1 font-mono text-xs ${palette.fallText}`}>
            <ArrowDownRight className="h-3 w-3" />
            LOSERS
          </p>
          <div className="grid gap-1">
            {data.topLosers.slice(0, 10).map((mover, index) => (
              <div
                key={mover.id}
                className="flex items-center justify-between rounded-[6px] border border-white/[0.06] bg-white/[0.025] px-3 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-white/28 w-5 text-right">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs text-white truncate">
                    {mover.symbol}
                  </span>
                  <span className="text-[10px] text-white/36 truncate hidden sm:inline">
                    {mover.name.slice(0, 12)}
                  </span>
                </div>
                <span className={`ml-2 shrink-0 font-mono text-xs ${palette.fallText}`}>
                  {mover.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>}
    </AsyncPanel>
  );
}
