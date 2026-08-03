"use client";

import {
  AlertTriangle,
  CandlestickChart as CandlestickIcon,
  Clock3,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";
import { FinancialChart } from "@/components/charts/FinancialChart";
import { className } from "@/components/shared/util";
import { useStockBars } from "@/hooks/useStockBars";
import type { StockInstrument } from "@/lib/stock-catalog";
import { stockChartPeriods, type StockChartPeriod } from "@/lib/stock-bars";

type StockChartPanelProps = {
  instrument: StockInstrument;
  marketOpen: boolean;
  refreshToken: number;
  period: StockChartPeriod;
  onPeriodChange: (period: StockChartPeriod) => void;
};

function formatDataTime(
  timestamp: string,
  timeZone: string,
  period: StockChartPeriod
) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(period === "intraday" || period === "five-day"
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).format(new Date(timestamp));
}

export function StockChartPanel({
  instrument,
  marketOpen,
  refreshToken,
  period,
  onPeriodChange,
}: StockChartPanelProps) {
  const chartTabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { data, loading, refreshing, error, refresh } = useStockBars({
    instrumentId: instrument.id,
    period,
    market: instrument.market,
    marketOpen,
    refreshToken,
  });
  const selectedPeriod = stockChartPeriods.find((item) => item.id === period)!;
  const live = data?.marketState === "OPEN";
  const sessionLabel = !data
    ? "同步交易状态"
    : live
      ? "盘中 · 形成中 · 5秒刷新"
      : data.marketState === "DELAYED"
        ? "行情延迟 · 5秒重试"
      : data.marketState === "BREAK"
        ? "午间休市 · 静态"
        : "已收盘 · 静态";
  const tabPanelId = `${chartTabsId}-panel`;

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % stockChartPeriods.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + stockChartPeriods.length) % stockChartPeriods.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = stockChartPeriods.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    onPeriodChange(stockChartPeriods[nextIndex].id);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  return (
    <section className="mt-3 border-y border-white/10 py-4 sm:mt-5" aria-labelledby="stock-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] text-acid">
            <CandlestickIcon className="h-4 w-4" aria-hidden="true" />
            REAL OHLCV / 真实行情
          </p>
          <h4 id="stock-chart-title" className="mt-2 font-serif text-xl font-semibold text-white">
            {selectedPeriod.detail}
          </h4>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 font-mono text-[11px]">
          {data ? (
            <span className="border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-white/64">
              <span className="sm:hidden">{data.source.toUpperCase()}</span>
              <span className="hidden sm:inline">{data.sourceLabel}</span>
            </span>
          ) : null}
          <span
            className={className(
              "inline-flex items-center gap-1.5 whitespace-nowrap border px-2.5 py-1.5",
              live
                ? "border-acid/35 bg-acid/10 text-acid"
                : "border-white/10 bg-white/[0.035] text-white/48"
            )}
          >
            {live ? (
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {sessionLabel}
          </span>
          <button
            type="button"
            title="刷新当前 K 线"
            aria-label="刷新当前 K 线"
            onClick={refresh}
            disabled={loading || refreshing}
            className="grid h-10 w-10 place-items-center rounded-[6px] border border-white/10 text-white/64 transition hover:border-acid/45 hover:text-acid disabled:cursor-wait disabled:opacity-45"
          >
            <RefreshCw
              className={className("h-3.5 w-3.5", (loading || refreshing) && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-4 border border-white/10 bg-black/20 p-1"
        role="tablist"
        aria-label="K 线周期"
        aria-orientation="horizontal"
      >
        {stockChartPeriods.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`${chartTabsId}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={period === item.id}
            aria-controls={tabPanelId}
            tabIndex={period === item.id ? 0 : -1}
            onClick={() => onPeriodChange(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            className={className(
              "h-10 border-r border-white/[0.07] px-2 font-mono text-xs transition last:border-r-0",
              period === item.id
                ? "bg-paper text-carbon-deep shadow-[inset_0_-2px_0_rgba(188,152,88,0.55)]"
                : "text-white/52 hover:bg-white/[0.045] hover:text-white"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`${chartTabsId}-tab-${period}`}
        className="relative mt-3 min-h-[430px] sm:min-h-[510px]"
        aria-busy={loading || refreshing}
      >
        {loading && !data ? (
          <div className="grid h-[430px] place-items-center border border-dashed border-white/10 bg-black/15 sm:h-[500px]">
            <div className="text-center">
              <RefreshCw className="mx-auto h-5 w-5 animate-spin text-acid" aria-hidden="true" />
              <p className="mt-3 font-mono text-xs text-white/46">正在同步真实 OHLCV 行情</p>
            </div>
          </div>
        ) : null}

        {error && !data ? (
          <div className="grid h-[430px] place-items-center border border-dangerline/25 bg-dangerline/[0.045] px-6 text-center sm:h-[500px]">
            <div>
              <AlertTriangle className="mx-auto h-5 w-5 text-dangerline" aria-hidden="true" />
              <p className="mt-3 text-sm text-white/72">真实行情源暂时不可用</p>
              <p className="mt-2 break-words font-mono text-[11px] leading-5 text-white/52">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-4 inline-flex items-center gap-2 rounded-[6px] border border-white/15 px-3 py-2 font-mono text-xs text-white/64 transition hover:border-acid/45 hover:text-acid"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                重试
              </button>
            </div>
          </div>
        ) : null}

        {data ? (
          <FinancialChart
            instrumentId={instrument.id}
            name={instrument.name}
            symbol={instrument.symbol}
            currency={instrument.currency}
            market={instrument.market}
            period={period}
            timeZone={data.timeZone}
            bars={data.bars}
          />
        ) : null}
      </div>

      {data ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/10 pt-3 font-mono text-[11px] text-white/64"
          aria-live="polite"
        >
          <span>
            行情时间 {formatDataTime(data.dataAsOf, data.timeZone, period)} · {data.bars.length} 根
          </span>
          <span>
            {data.adjustment === "qfq" ? "前复权" : "原始价格"} · 成交量 / 股
            {data.latestBarPartial ? " · 最新 K 线未完结" : ""} · PUBLIC FEED
          </span>
        </div>
      ) : null}

      {error && data ? (
        <p className="mt-2 flex items-center gap-2 font-mono text-[11px] text-dangerline" role="status">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          自动刷新失败，当前保留上一份真实行情：{error}
        </p>
      ) : null}
    </section>
  );
}
