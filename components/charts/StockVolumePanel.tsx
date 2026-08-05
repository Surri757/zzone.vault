"use client";

import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useMemo } from "react";
import {
  StockAnalysisPeriodTabs,
  formatAnalysisDataTime,
} from "@/components/charts/StockTechnicalPanel";
import { className, formatCompact } from "@/components/shared/util";
import { useStockBars } from "@/hooks/useStockBars";
import { sma } from "@/lib/indicators";
import type { StockInstrument } from "@/lib/stock-catalog";
import { marketColorPalette } from "@/lib/market-colors";
import type { OHLCBar, StockChartPeriod } from "@/lib/stock-bars";

type StockVolumePanelProps = {
  instrument: StockInstrument;
  marketOpen: boolean;
  refreshToken: number;
  period: StockChartPeriod;
  onPeriodChange: (period: StockChartPeriod) => void;
};

const CHART_WIDTH = 960;

function latestFinite(values: number[]) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return null;
}

function onBalanceVolume(bars: OHLCBar[]) {
  if (bars.length === 0) return [];
  const values = [0];
  for (let index = 1; index < bars.length; index += 1) {
    const direction =
      bars[index].c > bars[index - 1].c
        ? 1
        : bars[index].c < bars[index - 1].c
          ? -1
          : 0;
    values.push(values[index - 1] + direction * bars[index].v);
  }
  return values;
}

function chaikinMoneyFlow(bars: OHLCBar[], period = 20) {
  const values = new Array<number>(bars.length).fill(NaN);
  let flowSum = 0;
  let volumeSum = 0;
  const flows = bars.map((bar) => {
    const range = bar.h - bar.l;
    const multiplier = range === 0 ? 0 : ((bar.c - bar.l) - (bar.h - bar.c)) / range;
    return multiplier * bar.v;
  });

  for (let index = 0; index < bars.length; index += 1) {
    flowSum += flows[index];
    volumeSum += bars[index].v;
    if (index >= period) {
      flowSum -= flows[index - period];
      volumeSum -= bars[index - period].v;
    }
    if (index >= period - 1 && volumeSum > 0) {
      values[index] = flowSum / volumeSum;
    }
  }
  return values;
}

function pointX(index: number, count: number) {
  return count <= 1 ? CHART_WIDTH / 2 : (index / (count - 1)) * CHART_WIDTH;
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
    const y = height - ((value - min) / (max - min || 1)) * height;
    path += `${drawing ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function TimeAxis({
  bars,
  timeZone,
  period,
}: {
  bars: OHLCBar[];
  timeZone: string;
  period: StockChartPeriod;
}) {
  const middle = Math.floor((bars.length - 1) / 2);
  const labels = [bars[0]?.t, bars[middle]?.t, bars.at(-1)?.t].filter(
    (value): value is string => Boolean(value)
  );
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

function VolumeChart({
  bars,
  average,
  market,
}: {
  bars: OHLCBar[];
  average: number[];
  market: StockInstrument["market"];
}) {
  const height = 230;
  const maxVolume = Math.max(...bars.map((bar) => bar.v), 1);
  const barWidth = Math.max(1, (CHART_WIDTH / bars.length) * 0.72);
  const colors = marketColorPalette(market);
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-[230px] w-full"
      role="img"
      aria-label="真实逐 K 成交量与二十周期均量"
    >
      {Array.from({ length: 5 }, (_, index) => (index / 4) * height).map((y) => (
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
      {bars.map((bar, index) => {
        const x = pointX(index, bars.length);
        const barHeight = (bar.v / maxVolume) * height;
        return (
          <rect
            key={bar.t}
            x={x - barWidth / 2}
            y={height - barHeight}
            width={barWidth}
            height={Math.max(1, barHeight)}
            fill={bar.c >= bar.o ? colors.riseHex : colors.fallHex}
            opacity="0.54"
          />
        );
      })}
      <path
        d={linePath(average, height, 0, maxVolume)}
        fill="none"
        stroke="#bc9858"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function OBVChart({ values }: { values: number[] }) {
  const height = 120;
  const finite = values.filter(Number.isFinite);
  const min = finite.length > 0 ? Math.min(...finite) : 0;
  const max = finite.length > 0 ? Math.max(...finite) : 1;
  const padding = (max - min || Math.abs(max) || 1) * 0.08;
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-[120px] w-full"
      role="img"
      aria-label="由真实收盘价和成交量计算的 OBV"
    >
      <line x1="0" y1={height / 2} x2={CHART_WIDTH} y2={height / 2} stroke="rgba(216,208,189,0.12)" vectorEffect="non-scaling-stroke" />
      <path
        d={linePath(values, height, min - padding, max + padding)}
        fill="none"
        stroke="#75a7bd"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function CMFChart({ values }: { values: number[] }) {
  const height = 120;
  const y = (value: number) => height - ((value + 1) / 2) * height;
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="h-[120px] w-full"
      role="img"
      aria-label="由真实 OHLCV 计算的 CMF 20"
    >
      <rect x="0" y={y(1)} width={CHART_WIDTH} height={y(0.2) - y(1)} fill="rgba(127,183,163,0.045)" />
      <rect x="0" y={y(-0.2)} width={CHART_WIDTH} height={y(-1) - y(-0.2)} fill="rgba(223,107,85,0.045)" />
      {[0.2, 0, -0.2].map((value) => (
        <line
          key={value}
          x1="0"
          y1={y(value)}
          x2={CHART_WIDTH}
          y2={y(value)}
          stroke="rgba(216,208,189,0.2)"
          strokeDasharray={value === 0 ? undefined : "5 4"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={linePath(values, height, -1, 1)}
        fill="none"
        stroke="#bc9858"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function formatSignedCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

export function StockVolumePanel({
  instrument,
  marketOpen,
  refreshToken,
  period,
  onPeriodChange,
}: StockVolumePanelProps) {
  const { data, loading, refreshing, error, refresh } = useStockBars({
    instrumentId: instrument.id,
    period,
    market: instrument.market,
    marketOpen,
    refreshToken,
  });

  const analysis = useMemo(() => {
    const bars = data?.bars ?? [];
    const volumes = bars.map((bar) => bar.v);
    const volumeAverage = sma(volumes, 20);
    const obv = onBalanceVolume(bars);
    const cmf = chaikinMoneyFlow(bars, 20);
    const latestVolume = bars.at(-1)?.v ?? null;
    const average20 = latestFinite(volumeAverage);
    const volumeRatio =
      latestVolume !== null && average20 !== null && average20 > 0
        ? latestVolume / average20
        : null;
    const latestReturn =
      bars.length >= 2 && bars.at(-2)!.c !== 0
        ? ((bars.at(-1)!.c - bars.at(-2)!.c) / bars.at(-2)!.c) * 100
        : null;
    return {
      bars,
      volumes,
      volumeAverage,
      obv,
      cmf,
      latestVolume,
      average20,
      volumeRatio,
      latestReturn,
    };
  }, [data]);

  const hasBars = analysis.bars.length >= 2;
  const hasFlowWindow = analysis.bars.length >= 20;
  const metrics = [
    { label: "LATEST VOLUME", value: formatCompact(analysis.latestVolume) },
    { label: "VMA20", value: formatCompact(analysis.average20) },
    {
      label: "CURRENT / VMA20",
      value: analysis.volumeRatio === null ? "--" : `${analysis.volumeRatio.toFixed(2)}x`,
    },
    { label: "OBV", value: formatSignedCompact(latestFinite(analysis.obv)) },
    {
      label: "CMF20",
      value:
        latestFinite(analysis.cmf) === null
          ? "--"
          : latestFinite(analysis.cmf)!.toFixed(3),
    },
    {
      label: "BAR RETURN",
      value:
        analysis.latestReturn === null
          ? "--"
          : `${analysis.latestReturn >= 0 ? "+" : ""}${analysis.latestReturn.toFixed(2)}%`,
    },
  ];

  return (
    <section className="mt-3 border-y border-white/10 py-4 sm:mt-5" aria-labelledby="stock-volume-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] text-acid">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            REAL VOLUME / 真实量价
          </p>
          <h4 id="stock-volume-title" className="mt-2 font-serif text-xl font-semibold text-white">
            成交量、OBV 与 CMF
          </h4>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || refreshing}
          title="刷新量价分析"
          aria-label="刷新量价分析"
          className="grid h-11 w-11 place-items-center rounded-[6px] border border-white/10 text-white/64 transition hover:border-acid/45 hover:text-acid disabled:cursor-wait disabled:opacity-45"
        >
          <RefreshCw className={className("h-4 w-4", (loading || refreshing) && "animate-spin")} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4">
        <StockAnalysisPeriodTabs
          period={period}
          onPeriodChange={onPeriodChange}
          label="量价分析周期"
        />
      </div>

      {loading && !data ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dashed border-white/10 bg-black/6">
          <div className="text-center">
            <RefreshCw className="mx-auto h-5 w-5 animate-spin text-acid" aria-hidden="true" />
            <p className="mt-3 font-mono text-xs text-white/48">正在同步真实成交量</p>
          </div>
        </div>
      ) : null}

      {error && !data ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dangerline/25 bg-dangerline/[0.045] px-6 text-center">
          <div>
            <AlertTriangle className="mx-auto h-5 w-5 text-dangerline" aria-hidden="true" />
            <p className="mt-3 text-sm text-white/72">真实 K 线暂不可用，无法计算量价指标</p>
            <p className="mt-2 break-words font-mono text-[11px] leading-5 text-white/52">{error}</p>
            <button type="button" onClick={refresh} className="mt-4 min-h-11 rounded-[6px] border border-white/15 px-4 font-mono text-xs text-white/64 transition hover:border-acid/45 hover:text-acid">
              重试
            </button>
          </div>
        </div>
      ) : null}

      {data && !hasBars ? (
        <div className="mt-3 grid h-[430px] place-items-center border border-dashed border-white/10 px-6 text-center text-sm text-white/48">
          真实行情不足 2 根，暂不能形成量价走势图
        </div>
      ) : null}

      {data && hasBars ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {metrics.map((metric) => (
              <div key={metric.label} className="border-b border-white/10 bg-white/[0.025] px-3 py-2.5">
                <p className="font-mono text-[10px] text-white/44">{metric.label}</p>
                <p className="mt-1 font-mono text-sm text-white/82">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="border border-white/10 bg-black/6 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-amberline" aria-hidden="true" />
                <span className="font-mono text-xs text-white/72">VOLUME / VMA20</span>
              </div>
              <span className="font-mono text-[10px] text-white/46">逐 K 成交量 / 股</span>
            </div>
            <VolumeChart bars={analysis.bars} average={analysis.volumeAverage} market={instrument.market} />
            <TimeAxis bars={analysis.bars} timeZone={data.timeZone} period={period} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="border border-white/10 bg-black/6 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2 font-mono text-xs">
                <span className="text-white/72">OBV</span>
                <span className="text-white/42">收盘方向累计量</span>
              </div>
              <OBVChart values={analysis.obv} />
            </div>
            <div className="border border-white/10 bg-black/6 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2 font-mono text-xs">
                <span className="text-white/72">CMF 20</span>
                <span className="text-white/42">OHLCV 派生</span>
              </div>
              {hasFlowWindow ? (
                <CMFChart values={analysis.cmf} />
              ) : (
                <div className="grid h-[120px] place-items-center border border-dashed border-white/10 text-xs text-white/46">
                  需要至少 20 根真实 K 线
                </div>
              )}
            </div>
          </div>

          <p className="border-l-2 border-amberline/50 pl-3 text-xs leading-5 text-white/52">
            OBV 与 CMF 为标准公式对真实 OHLCV 的确定性计算，不代表逐笔买卖方向或主力资金流。
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 font-mono text-[11px] text-white/58">
            <span>{data.sourceLabel} · 截止 {formatAnalysisDataTime(data.dataAsOf, data.timeZone, period)} · {data.bars.length} 根</span>
            <span>{data.adjustment === "qfq" ? "价格前复权" : "原始价格"} · 成交量 / 股{data.latestBarPartial ? " · 最新 K 线未完结" : ""}</span>
          </div>
        </div>
      ) : null}

      {error && data ? (
        <p className="mt-3 flex items-start gap-2 font-mono text-[11px] leading-5 text-dangerline" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          刷新失败，当前量价指标基于上一份真实行情：{error}
        </p>
      ) : null}
    </section>
  );
}
