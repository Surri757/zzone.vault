"use client";

import {
  AlertTriangle,
  ChartSpline,
  RefreshCw,
  Sigma,
} from "lucide-react";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { className } from "@/components/shared/util";
import { useStockBars } from "@/hooks/useStockBars";
import { atr, bollingerBands, macd, rsi, sma } from "@/lib/indicators";
import type { StockInstrument } from "@/lib/stock-catalog";
import {
  stockChartPeriods,
  type StockChartPeriod,
} from "@/lib/stock-bars";

type StockAnalysisPanelProps = {
  instrument: StockInstrument;
  marketOpen: boolean;
  refreshToken: number;
  period: StockChartPeriod;
  onPeriodChange: (period: StockChartPeriod) => void;
};

const CHART_WIDTH = 960;

function finiteExtent(series: number[][], includeZero = false) {
  const values = series.flat().filter(Number.isFinite);
  if (includeZero) values.push(0);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || Math.abs(max) || 1) * 0.08;
  return { min: min - padding, max: max + padding };
}

function pointX(index: number, count: number) {
  return count <= 1 ? CHART_WIDTH / 2 : (index / (count - 1)) * CHART_WIDTH;
}

function pointY(value: number, height: number, min: number, max: number) {
  return height - ((value - min) / (max - min || 1)) * height;
}

function linePath(values: number[], height: number, min: number, max: number) {
  let path = "";
  let drawing = false;

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = pointX(index, values.length);
    const y = pointY(value, height, min, max);
    path += `${drawing ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  });

  return path.trim();
}

function bandPaths(
  upper: number[],
  lower: number[],
  height: number,
  min: number,
  max: number
) {
  const segments: number[][] = [];
  let current: number[] = [];

  for (let index = 0; index < upper.length; index += 1) {
    if (Number.isFinite(upper[index]) && Number.isFinite(lower[index])) {
      current.push(index);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  return segments
    .filter((segment) => segment.length >= 2)
    .map((segment) => {
      const upperPoints = segment.map((index) =>
        `${pointX(index, upper.length).toFixed(2)} ${pointY(
          upper[index],
          height,
          min,
          max
        ).toFixed(2)}`
      );
      const lowerPoints = [...segment].reverse().map((index) =>
        `${pointX(index, lower.length).toFixed(2)} ${pointY(
          lower[index],
          height,
          min,
          max
        ).toFixed(2)}`
      );
      return `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z`;
    });
}

function latestFinite(values: number[]) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return null;
}

function formatValue(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatAnalysisDataTime(
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
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).format(new Date(timestamp));
}

export function StockAnalysisPeriodTabs({
  period,
  onPeriodChange,
  label,
}: {
  period: StockChartPeriod;
  onPeriodChange: (period: StockChartPeriod) => void;
  label: string;
}) {
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
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
  }

  return (
    <div className="overflow-x-auto pb-1 thin-scrollbar">
      <div
        className="grid min-w-[360px] grid-cols-4 border border-white/10 bg-black/20 p-1"
        role="tablist"
        aria-label={label}
      >
        {stockChartPeriods.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`${tabsId}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={period === item.id}
            tabIndex={period === item.id ? 0 : -1}
            onClick={() => onPeriodChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={className(
              "min-h-11 border-r border-white/[0.07] px-3 font-mono text-xs transition last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
              period === item.id
                ? "bg-paper text-carbon-deep"
                : "text-white/58 hover:bg-white/[0.045] hover:text-white"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeAxis({
  timestamps,
  timeZone,
  period,
}: {
  timestamps: string[];
  timeZone: string;
  period: StockChartPeriod;
}) {
  if (timestamps.length === 0) return null;
  const middle = Math.floor((timestamps.length - 1) / 2);
  const labels = [timestamps[0], timestamps[middle], timestamps.at(-1)!];
  return (
    <div className="mt-2 grid grid-cols-3 font-mono text-[10px] text-white/42">
      {labels.map((timestamp, index) => (
        <span
          key={`${timestamp}-${index}`}
          className={index === 1 ? "text-center" : index === 2 ? "text-right" : ""}
        >
          {formatAnalysisDataTime(timestamp, timeZone, period)}
        </span>
      ))}
    </div>
  );
}

function TrendChart({
  closes,
  ma5,
  bands,
}: {
  closes: number[];
  ma5: number[];
  bands: ReturnType<typeof bollingerBands>;
}) {
  const height = 220;
  const extent = finiteExtent([closes, ma5, bands.upper, bands.lower]);
  const grids = Array.from({ length: 5 }, (_, index) => (index / 4) * height);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-[220px] w-full"
      role="img"
      aria-label="真实收盘价、五周期均线与布林带走势"
    >
      {grids.map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2={CHART_WIDTH}
          y2={y}
          stroke="rgba(216,208,189,0.09)"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {bandPaths(bands.upper, bands.lower, height, extent.min, extent.max).map(
        (path) => <path key={path} d={path} fill="rgba(127,183,163,0.08)" />
      )}
      {[bands.upper, bands.lower].map((values, index) => (
        <path
          key={index}
          d={linePath(values, height, extent.min, extent.max)}
          fill="none"
          stroke="#7fb7a3"
          strokeOpacity="0.48"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={linePath(bands.middle, height, extent.min, extent.max)}
        fill="none"
        stroke="#75a7bd"
        strokeWidth="1.3"
        strokeOpacity="0.82"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={linePath(ma5, height, extent.min, extent.max)}
        fill="none"
        stroke="#bc9858"
        strokeWidth="1.3"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={linePath(closes, height, extent.min, extent.max)}
        fill="none"
        stroke="#d8d0bd"
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function MACDChart({ values }: { values: ReturnType<typeof macd> }) {
  const height = 112;
  const extent = finiteExtent(
    [values.macd, values.signal, values.histogram],
    true
  );
  const zeroY = pointY(0, height, extent.min, extent.max);
  const barWidth = Math.max(1, (CHART_WIDTH / values.histogram.length) * 0.7);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-28 w-full"
      role="img"
      aria-label="MACD 12 26 9"
    >
      <line
        x1="0"
        y1={zeroY}
        x2={CHART_WIDTH}
        y2={zeroY}
        stroke="rgba(216,208,189,0.22)"
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      {values.histogram.map((value, index) => {
        if (!Number.isFinite(value)) return null;
        const x = pointX(index, values.histogram.length);
        const y = pointY(value, height, extent.min, extent.max);
        return (
          <rect
            key={index}
            x={x - barWidth / 2}
            y={Math.min(y, zeroY)}
            width={barWidth}
            height={Math.max(1, Math.abs(y - zeroY))}
            fill={value >= 0 ? "#7fb7a3" : "#df6b55"}
            opacity="0.48"
          />
        );
      })}
      <path
        d={linePath(values.macd, height, extent.min, extent.max)}
        fill="none"
        stroke="#d8d0bd"
        strokeWidth="1.35"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={linePath(values.signal, height, extent.min, extent.max)}
        fill="none"
        stroke="#bc9858"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function RSIChart({ values }: { values: number[] }) {
  const height = 112;
  const y70 = pointY(70, height, 0, 100);
  const y30 = pointY(30, height, 0, 100);
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-28 w-full"
      role="img"
      aria-label="RSI 14"
    >
      <rect x="0" y="0" width={CHART_WIDTH} height={y70} fill="rgba(223,107,85,0.06)" />
      <rect x="0" y={y30} width={CHART_WIDTH} height={height - y30} fill="rgba(127,183,163,0.06)" />
      {[y70, y30].map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2={CHART_WIDTH}
          y2={y}
          stroke="rgba(216,208,189,0.2)"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={linePath(values, height, 0, 100)}
        fill="none"
        stroke="#bc9858"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StockTechnicalPanel({
  instrument,
  marketOpen,
  refreshToken,
  period,
  onPeriodChange,
}: StockAnalysisPanelProps) {
  const { data, loading, refreshing, error, refresh } = useStockBars({
    instrumentId: instrument.id,
    period,
    market: instrument.market,
    marketOpen,
    refreshToken,
  });

  const analysis = useMemo(() => {
    const bars = data?.bars ?? [];
    const closes = bars.map((bar) => bar.c);
    const highs = bars.map((bar) => bar.h);
    const lows = bars.map((bar) => bar.l);
    const ma5 = sma(closes, 5);
    const bands = bollingerBands(closes, 20, 2);
    const macdValues = macd(closes, 12, 26, 9);
    const rsiValues = rsi(closes, 14);
    const atrValues = atr(highs, lows, closes, 14);
    const upper = latestFinite(bands.upper);
    const lower = latestFinite(bands.lower);
    const middle = latestFinite(bands.middle);
    const bandWidth =
      upper !== null && lower !== null && middle
        ? ((upper - lower) / middle) * 100
        : null;
    return {
      bars,
      closes,
      ma5,
      bands,
      macdValues,
      rsiValues,
      atrValues,
      bandWidth,
    };
  }, [data]);

  const hasBars = analysis.bars.length >= 2;
  const hasTrend = analysis.bars.length >= 20;
  const hasMACD = analysis.bars.length >= 35;
  const timestamps = analysis.bars.map((bar) => bar.t);

  return (
    <section className="mt-3 border-y border-white/10 py-4 sm:mt-5" aria-labelledby="stock-technical-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] text-acid">
            <ChartSpline className="h-4 w-4" aria-hidden="true" />
            DERIVED FROM REAL OHLCV / 技术结构
          </p>
          <h4 id="stock-technical-title" className="mt-2 font-serif text-xl font-semibold text-white">
            趋势、动量与波动
          </h4>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || refreshing}
          title="刷新技术分析"
          aria-label="刷新技术分析"
          className="grid h-11 w-11 place-items-center rounded-[6px] border border-white/10 text-white/64 transition hover:border-acid/45 hover:text-acid disabled:cursor-wait disabled:opacity-45"
        >
          <RefreshCw className={className("h-4 w-4", (loading || refreshing) && "animate-spin")} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4">
        <StockAnalysisPeriodTabs
          period={period}
          onPeriodChange={onPeriodChange}
          label="技术分析周期"
        />
      </div>

      {loading && !data ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dashed border-white/10 bg-black/15">
          <div className="text-center">
            <RefreshCw className="mx-auto h-5 w-5 animate-spin text-acid" aria-hidden="true" />
            <p className="mt-3 font-mono text-xs text-white/48">正在同步真实 OHLCV 并计算指标</p>
          </div>
        </div>
      ) : null}

      {error && !data ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dangerline/25 bg-dangerline/[0.045] px-6 text-center">
          <div>
            <AlertTriangle className="mx-auto h-5 w-5 text-dangerline" aria-hidden="true" />
            <p className="mt-3 text-sm text-white/72">真实 K 线暂不可用，无法计算技术指标</p>
            <p className="mt-2 break-words font-mono text-[11px] leading-5 text-white/52">{error}</p>
            <button type="button" onClick={refresh} className="mt-4 min-h-11 rounded-[6px] border border-white/15 px-4 font-mono text-xs text-white/64 transition hover:border-acid/45 hover:text-acid">
              重试
            </button>
          </div>
        </div>
      ) : null}

      {data && !hasBars ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dashed border-white/10 px-6 text-center text-sm text-white/48">
          真实行情不足 2 根，暂不能形成技术走势图
        </div>
      ) : null}

      {data && hasBars ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["MA5", latestFinite(analysis.ma5), ""],
              ["MA20", latestFinite(analysis.bands.middle), ""],
              ["BOLL WIDTH", analysis.bandWidth, "%"],
              ["MACD", latestFinite(analysis.macdValues.macd), ""],
              ["RSI14", latestFinite(analysis.rsiValues), ""],
              ["ATR14", latestFinite(analysis.atrValues), ""],
            ].map(([label, value, suffix]) => (
              <div key={label as string} className="border-b border-white/10 bg-white/[0.025] px-3 py-2.5">
                <p className="font-mono text-[10px] text-white/44">{label}</p>
                <p className="mt-1 font-mono text-sm text-white/82">
                  {formatValue(value as number | null)}{value !== null ? suffix : ""}
                </p>
              </div>
            ))}
          </div>

          <div className="border border-white/10 bg-black/20 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sigma className="h-4 w-4 text-amberline" aria-hidden="true" />
                <span className="font-mono text-xs text-white/72">PRICE / MA5 / BOLL20</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-white/48">
                <span className="text-white/76">收盘价</span>
                <span className="text-amberline">MA5</span>
                <span className="text-cyanline">BOLL 中轨</span>
              </div>
            </div>
            {hasTrend ? (
              <>
                <TrendChart closes={analysis.closes} ma5={analysis.ma5} bands={analysis.bands} />
                <TimeAxis timestamps={timestamps} timeZone={data.timeZone} period={period} />
              </>
            ) : (
              <div className="grid h-[220px] place-items-center border border-dashed border-white/10 text-sm text-white/46">
                BOLL 与 MA20 需要至少 20 根真实 K 线
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="border border-white/10 bg-black/20 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2 font-mono text-xs">
                <span className="text-white/72">MACD 12 / 26 / 9</span>
                <span className="text-white/42">动量</span>
              </div>
              {hasMACD ? (
                <MACDChart values={analysis.macdValues} />
              ) : (
                <div className="grid h-28 place-items-center border border-dashed border-white/10 text-xs text-white/46">
                  需要至少 35 根真实 K 线
                </div>
              )}
            </div>
            <div className="border border-white/10 bg-black/20 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2 font-mono text-xs">
                <span className="text-white/72">RSI 14</span>
                <span className="text-white/42">70 / 30</span>
              </div>
              {analysis.bars.length >= 15 ? (
                <RSIChart values={analysis.rsiValues} />
              ) : (
                <div className="grid h-28 place-items-center border border-dashed border-white/10 text-xs text-white/46">
                  需要至少 15 根真实 K 线
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 font-mono text-[11px] text-white/58">
            <span>{data.sourceLabel} · 截止 {formatAnalysisDataTime(data.dataAsOf, data.timeZone, period)} · {data.bars.length} 根</span>
            <span>{data.adjustment === "qfq" ? "前复权" : "原始价格"} · 指标仅由真实 OHLCV 计算{data.latestBarPartial ? " · 最新 K 线未完结" : ""}</span>
          </div>
        </div>
      ) : null}

      {error && data ? (
        <p className="mt-3 flex items-start gap-2 font-mono text-[11px] leading-5 text-dangerline" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          刷新失败，当前指标基于上一份真实行情：{error}
        </p>
      ) : null}
    </section>
  );
}
