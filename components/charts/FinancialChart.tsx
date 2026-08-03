"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  TickMarkType as TickMarkTypeValue,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { StockMarket } from "@/lib/stock-catalog";
import { marketColorPalette } from "@/lib/market-colors";
import type { OHLCBar, StockChartPeriod } from "@/lib/stock-bars";

type FinancialChartProps = {
  instrumentId: string;
  name: string;
  symbol: string;
  currency: string;
  market: StockMarket;
  period: StockChartPeriod;
  timeZone: string;
  bars: OHLCBar[];
};

function timestampValue(timestamp: string) {
  return Math.floor(Date.parse(timestamp) / 1000) as UTCTimestamp;
}

function formatVolume(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function priceFormatter(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value);
}

function sameBar(left: OHLCBar, right: OHLCBar) {
  return (
    left.t === right.t &&
    left.o === right.o &&
    left.h === right.h &&
    left.l === right.l &&
    left.c === right.c &&
    left.v === right.v
  );
}

function barTimeLabel(bar: OHLCBar, timeZone: string, period: StockChartPeriod) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(period === "intraday" || period === "five-day"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).format(new Date(bar.t));
}

export function FinancialChart({
  instrumentId,
  name,
  symbol,
  currency,
  market,
  period,
  timeZone,
  bars,
}: FinancialChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const barsRef = useRef(bars);
  const renderedBarsRef = useRef<OHLCBar[]>([]);
  const frameRef = useRef<number | null>(null);
  const crosshairActiveRef = useRef(false);
  const inspectedTimeRef = useRef<string | null>(bars.at(-1)?.t ?? null);
  const [inspectedBar, setInspectedBar] = useState<OHLCBar | null>(bars.at(-1) ?? null);
  const [keyboardIndex, setKeyboardIndex] = useState(Math.max(0, bars.length - 1));
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");

  const fiveDaySessions = useMemo(() => {
    if (period !== "five-day") return [];

    const sessionKeyFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const sessionLabelFormatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
    });
    const sessions = new Map<string, string>();

    for (const bar of bars) {
      const date = new Date(bar.t);
      const key = sessionKeyFormatter.format(date);
      if (!sessions.has(key)) sessions.set(key, sessionLabelFormatter.format(date));
    }

    return [...sessions.entries()].slice(-5).map(([key, label]) => ({ key, label }));
  }, [bars, period, timeZone]);

  barsRef.current = bars;

  const colors = useMemo(() => {
    const palette = marketColorPalette(market);
    return { up: palette.riseHex, down: palette.fallHex };
  }, [market]);

  const setSeriesData = useCallback(
    (
      priceSeries: ISeriesApi<"Candlestick">,
      volumeSeries: ISeriesApi<"Histogram">,
      nextBars: OHLCBar[]
    ) => {
      const candles: CandlestickData<UTCTimestamp>[] = nextBars.map((bar) => ({
        time: timestampValue(bar.t),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      }));
      const volume: HistogramData<UTCTimestamp>[] = nextBars.map((bar) => ({
        time: timestampValue(bar.t),
        value: bar.v,
        color: `${bar.c >= bar.o ? colors.up : colors.down}66`,
      }));
      priceSeries.setData(candles);
      volumeSeries.setData(volume);
    },
    [colors.down, colors.up]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    async function mountChart() {
      const {
        CandlestickSeries,
        ColorType,
        CrosshairMode,
        HistogramSeries,
        TickMarkType,
        createChart,
      } = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const intraday = period === "intraday" || period === "five-day";
      const chart = createChart(containerRef.current, {
        autoSize: true,
        height: 430,
        layout: {
          background: { type: ColorType.Solid, color: "rgba(7, 9, 6, 0.16)" },
          textColor: "rgba(216, 208, 189, 0.58)",
          attributionLogo: false,
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(216, 208, 189, 0.055)" },
          horzLines: { color: "rgba(216, 208, 189, 0.075)" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: "rgba(216, 208, 189, 0.34)",
            labelBackgroundColor: "#263b33",
          },
          horzLine: {
            color: "rgba(216, 208, 189, 0.34)",
            labelBackgroundColor: "#263b33",
          },
        },
        rightPriceScale: {
          borderColor: "rgba(216, 208, 189, 0.12)",
          minimumWidth: 66,
        },
        timeScale: {
          borderColor: "rgba(216, 208, 189, 0.12)",
          timeVisible: intraday,
          secondsVisible: false,
          rightOffset: 3,
          barSpacing: period === "intraday" ? 5.5 : period === "five-day" ? 3.2 : 6,
          minBarSpacing: 1.2,
          tickMarkFormatter: (time: Time, tickMarkType: TickMarkTypeValue) => {
            const milliseconds = Number(time) * 1000;

            if (period === "five-day" && tickMarkType <= TickMarkType.DayOfMonth) {
              return new Intl.DateTimeFormat("zh-CN", {
                timeZone,
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(milliseconds));
            }

            return new Intl.DateTimeFormat("zh-CN", {
              timeZone,
              ...(intraday
                ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
                : { year: "2-digit", month: "2-digit", day: "2-digit" }),
            }).format(new Date(milliseconds));
          },
        },
        localization: {
          locale: "zh-CN",
          priceFormatter,
          timeFormatter: (time: Time) => {
            const milliseconds = Number(time) * 1000;
            return new Intl.DateTimeFormat("zh-CN", {
              timeZone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              ...(intraday
                ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
                : {}),
            }).format(new Date(milliseconds));
          },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
        kineticScroll: { mouse: true, touch: true },
      });

      const priceSeries = chart.addSeries(CandlestickSeries, {
        upColor: colors.up,
        downColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
        borderVisible: false,
        priceLineColor: "rgba(216, 208, 189, 0.45)",
        priceLineWidth: 1,
        lastValueVisible: true,
      });
      priceSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.3 },
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });

      const handleCrosshair = (param: MouseEventParams<Time>) => {
        if (!param.time) {
          crosshairActiveRef.current = false;
          if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
          frameRef.current = window.requestAnimationFrame(() => {
            const latestBar = barsRef.current.at(-1) ?? null;
            inspectedTimeRef.current = latestBar?.t ?? null;
            setInspectedBar(latestBar);
            frameRef.current = null;
          });
          return;
        }

        const timestamp = Number(param.time);
        const nextBar = barsRef.current.find(
          (bar) => timestampValue(bar.t) === timestamp
        );
        if (!nextBar) return;
        crosshairActiveRef.current = true;
        inspectedTimeRef.current = nextBar.t;
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
          setInspectedBar(nextBar);
          frameRef.current = null;
        });
      };

      chart.subscribeCrosshairMove(handleCrosshair);
      unsubscribe = () => chart.unsubscribeCrosshairMove(handleCrosshair);
      chartRef.current = chart;
      priceSeriesRef.current = priceSeries;
      volumeSeriesRef.current = volumeSeries;
      setSeriesData(priceSeries, volumeSeries, barsRef.current);
      renderedBarsRef.current = barsRef.current;
      chart.timeScale().fitContent();
    }

    mountChart();
    return () => {
      disposed = true;
      unsubscribe?.();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      renderedBarsRef.current = [];
    };
  }, [colors.down, colors.up, instrumentId, period, setSeriesData, timeZone]);

  useEffect(() => {
    const priceSeries = priceSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!priceSeries || !volumeSeries) return;

    const previousBars = renderedBarsRef.current;
    const existingLastBarChanged =
      bars.length === previousBars.length &&
      previousBars.length > 0 &&
      previousBars.at(-1)?.t === bars.at(-1)?.t &&
      previousBars
        .slice(0, -1)
        .every((bar, index) => sameBar(bar, bars[index]));
    const oneBarAppended =
      bars.length === previousBars.length + 1 &&
      previousBars.length > 0 &&
      previousBars.every((bar, index) => sameBar(bar, bars[index]));
    const latestBar = bars.at(-1);

    if ((existingLastBarChanged || oneBarAppended) && latestBar) {
      priceSeries.update({
        time: timestampValue(latestBar.t),
        open: latestBar.o,
        high: latestBar.h,
        low: latestBar.l,
        close: latestBar.c,
      });
      volumeSeries.update({
        time: timestampValue(latestBar.t),
        value: latestBar.v,
        color: `${latestBar.c >= latestBar.o ? colors.up : colors.down}66`,
      });
    } else {
      setSeriesData(priceSeries, volumeSeries, bars);
    }
    renderedBarsRef.current = bars;
    const latest = bars.at(-1) ?? null;
    if (crosshairActiveRef.current && inspectedTimeRef.current) {
      const nextInspectedIndex = bars.findIndex(
        (bar) => bar.t === inspectedTimeRef.current
      );
      if (nextInspectedIndex >= 0) {
        setInspectedBar(bars[nextInspectedIndex]);
        setKeyboardIndex(nextInspectedIndex);
      } else {
        crosshairActiveRef.current = false;
        inspectedTimeRef.current = latest?.t ?? null;
        chartRef.current?.clearCrosshairPosition();
        setInspectedBar(latest);
        setKeyboardIndex(Math.max(0, bars.length - 1));
      }
    } else {
      inspectedTimeRef.current = latest?.t ?? null;
      setInspectedBar(latest);
      setKeyboardIndex(Math.max(0, bars.length - 1));
    }
  }, [bars, colors.down, colors.up, instrumentId, period, setSeriesData]);

  const handleKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? bars.length - 1
          : Math.max(
              0,
              Math.min(
                bars.length - 1,
                keyboardIndex + (event.key === "ArrowLeft" ? -1 : 1)
              )
            );
    const nextBar = bars[nextIndex];
    if (!nextBar) return;

    crosshairActiveRef.current = true;
    inspectedTimeRef.current = nextBar.t;
    setKeyboardIndex(nextIndex);
    setInspectedBar(nextBar);
    const announcement = `${barTimeLabel(nextBar, timeZone, period)}，开 ${priceFormatter(
      nextBar.o
    )}，高 ${priceFormatter(nextBar.h)}，低 ${priceFormatter(nextBar.l)}，收 ${priceFormatter(
      nextBar.c
    )}，成交量 ${formatVolume(nextBar.v)}`;
    setKeyboardAnnouncement(announcement);
    if (chartRef.current && priceSeriesRef.current) {
      chartRef.current.setCrosshairPosition(
        nextBar.c,
        timestampValue(nextBar.t),
        priceSeriesRef.current
      );
    }
  };

  const latest = bars.at(-1) ?? null;
  const currentInspectedBar = inspectedBar
    ? bars.find((bar) => bar.t === inspectedBar.t) ?? null
    : null;
  const displayBar = currentInspectedBar ?? latest;

  return (
    <figure
      className="relative outline-none focus-visible:ring-2 focus-visible:ring-acid/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      tabIndex={0}
      aria-label={`${name} ${symbol} 真实 OHLCV K 线图`}
      aria-describedby="stock-chart-summary"
      onKeyDown={handleKeyboard}
      onBlur={() => {
        crosshairActiveRef.current = false;
        inspectedTimeRef.current = latest?.t ?? null;
        chartRef.current?.clearCrosshairPosition();
        setInspectedBar(latest);
      }}
    >
      <figcaption className="mb-3 grid min-h-[48px] grid-cols-2 gap-2 border-y border-white/10 py-2 sm:grid-cols-[minmax(112px,1.8fr)_repeat(5,minmax(52px,1fr))]">
        {[
          ["TIME", displayBar ? barTimeLabel(displayBar, timeZone, period) : "--"],
          ["OPEN", displayBar ? priceFormatter(displayBar.o) : "--"],
          ["HIGH", displayBar ? priceFormatter(displayBar.h) : "--"],
          ["LOW", displayBar ? priceFormatter(displayBar.l) : "--"],
          ["CLOSE", displayBar ? priceFormatter(displayBar.c) : "--"],
          ["VOLUME", displayBar ? formatVolume(displayBar.v) : "--"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 px-1">
            <p className="font-mono text-[10px] text-white/60">{label}</p>
            <p className="mt-1 truncate font-mono text-xs text-white/82" title={value}>
              {value}
            </p>
          </div>
        ))}
      </figcaption>

      {fiveDaySessions.length > 0 ? (
        <ol
          className="mb-2 grid list-none border-y border-white/10 bg-white/[0.02] sm:hidden"
          style={{
            gridTemplateColumns: `repeat(${fiveDaySessions.length}, minmax(0, 1fr))`,
          }}
          aria-label="五日交易日范围"
        >
          {fiveDaySessions.map((session) => (
            <li
              key={session.key}
              className="border-r border-white/10 px-1 py-1.5 text-center font-mono text-[10px] text-white/64 last:border-r-0"
            >
              {session.label}
            </li>
          ))}
        </ol>
      ) : null}

      <div
        ref={containerRef}
        className="h-[350px] w-full sm:h-[430px]"
        aria-hidden="true"
      />

      <div className="mt-2 flex flex-col items-start gap-1.5 font-mono text-[11px] text-white/58 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span>
          {market === "CN" ? "红涨 / 绿跌" : "绿涨 / 红跌"} · {currency}
        </span>
        <a
          href="https://www.tradingview.com/lightweight-charts/"
          target="_blank"
          rel="noreferrer"
          className="transition hover:text-white/72 focus-visible:text-white/80"
        >
          Charts by TradingView Lightweight Charts
        </a>
      </div>

      <p id="stock-chart-summary" className="sr-only">
        {latest
          ? `${name} ${symbol} 最新一根 K 线：${barTimeLabel(
              latest,
              timeZone,
              period
            )}，开盘 ${latest.o}，最高 ${latest.h}，最低 ${latest.l}，收盘 ${
              latest.c
            }，成交量 ${latest.v}。`
          : `${name} ${symbol} 暂无 K 线数据。`}
      </p>
      <p className="sr-only" aria-live="polite">
        {keyboardAnnouncement}
      </p>
    </figure>
  );
}
