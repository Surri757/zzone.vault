"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PieChart } from "lucide-react";
import type { StockMarket } from "@/lib/stock-catalog";
import { marketColorPalette } from "@/lib/market-colors";
import { AsyncPanel, asyncErrorMessage } from "@/components/shared/AsyncPanel";

interface SectorData {
  sector: string;
  stockCount: number;
  avgChangePct: number;
  advancing: number;
  declining: number;
}

interface SectorHeatmapData {
  generatedAt: string;
  dataAsOf?: string;
  sourceLabel?: string;
  catalogTotal?: number;
  coverageRatio?: number;
  stale?: boolean;
  sectors: SectorData[];
}

export function SectorHeatmap({ market }: { market: StockMarket }) {
  const [data, setData] = useState<SectorHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchSectors = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/live/movers?market=${market}&type=sectors`,
        { cache: "no-store", signal: controller.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as SectorHeatmapData;
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
    void fetchSectors();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchSectors();
    }, 60_000);

    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [fetchSectors]);

  const maxAbs = Math.max(...(data?.sectors ?? []).map((s) => Math.abs(s.avgChangePct)), 0.01);
  const palette = marketColorPalette(market);

  return (
    <AsyncPanel
      header={
        <div className="flex items-center gap-2 text-sm text-white/52">
          <PieChart className="h-4 w-4 text-cyanline" />
          SECTOR HEATMAP — {market}
        </div>
      }
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      sourceLabel={data?.sourceLabel}
      hasData={Boolean(data)}
      onRetry={() => void fetchSectors()}
      loadingLabel="正在同步板块数据..."
      minBodyClassName="min-h-[28rem]"
    >
      {data && <>
      <div className="grid gap-1.5">
        {data.sectors.slice(0, 15).map((sector) => {
          const intensity = Math.abs(sector.avgChangePct) / maxAbs;
          const positive = sector.avgChangePct >= 0;
          const barWidth = Math.max(2, intensity * 100);

          return (
            <div
              key={sector.sector}
              className="group flex items-center gap-2 rounded-[4px] px-2 py-1.5 transition hover:bg-white/[0.04]"
            >
              <span className="w-24 shrink-0 truncate font-mono text-[10px] text-white/58">
                {sector.sector}
              </span>
              <div className="flex-1 h-3 bg-white/[0.06] rounded-[3px] overflow-hidden">
                <div
                  className={`h-full rounded-[3px] transition-all duration-700 ${
                    positive ? palette.riseBackground : palette.fallBackground
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span
                className={`w-16 text-right font-mono text-[10px] shrink-0 ${
                  positive ? palette.riseText : palette.fallText
                }`}
              >
                {positive ? "+" : ""}
                {sector.avgChangePct.toFixed(2)}%
              </span>
              <span className="w-8 text-right font-mono text-[10px] text-white/28 shrink-0">
                {sector.stockCount}
              </span>
            </div>
          );
        })}
      </div>

      {data.sectors.length > 15 && (
        <p className="mt-3 text-center font-mono text-[10px] text-white/28">
          +{data.sectors.length - 15} more sectors
        </p>
      )}
      </>}
    </AsyncPanel>
  );
}
