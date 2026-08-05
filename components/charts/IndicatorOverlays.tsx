"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  bollingerBands,
  crossover,
  macd,
  rsi,
  sma,
  type BollingerResult,
  type MACDResult,
} from "@/lib/indicators";

// ---------------------------------------------------------------------------
// MA Overlay — moving average lines on a price chart
// ---------------------------------------------------------------------------

export function MAOverlay({
  prices,
  periods = [5, 10, 20, 60],
  width = 260,
  height = 118,
  priceMin: priceMinProp,
  priceMax: priceMaxProp,
}: {
  prices: number[];
  periods?: number[];
  width?: number;
  height?: number;
  priceMin?: number;
  priceMax?: number;
}) {
  const mas = useMemo(() => {
    return periods.map((period) => ({
      period,
      values: sma(prices, period),
    }));
  }, [prices, periods]);

  const priceMin =
    priceMinProp ?? Math.min(...prices.filter((p) => Number.isFinite(p)));
  const priceMax =
    priceMaxProp ?? Math.max(...prices.filter((p) => Number.isFinite(p)));
  const range = priceMax - priceMin || 1;

  const toY = (price: number) => height - ((price - priceMin) / range) * height;
  const toX = (i: number) => (i / Math.max(1, prices.length - 1)) * width;

  const colors = ["#df6b55", "#bc9858", "#d8d0bd", "#7fb7a3"];

  return (
    <svg
      className="w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="均线叠加"
    >
      {mas.map((ma, mi) => {
        const validPoints = ma.values
          .map((v, i) => ({ v, i }))
          .filter((p) => Number.isFinite(p.v));
        if (validPoints.length < 2) return null;

        const path = validPoints
          .map((p, idx) => {
            const x = toX(p.i);
            const y = toY(p.v);
            return `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(" ");

        return (
          <g key={ma.period}>
            <path
              d={path}
              fill="none"
              stroke={colors[mi % colors.length]}
              strokeWidth="1.5"
              strokeOpacity="0.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Label at the end */}
            {validPoints.length > 0 && (
              <text
                x={toX(validPoints[validPoints.length - 1].i) + 3}
                y={toY(validPoints[validPoints.length - 1].v) + 4}
                fill={colors[mi % colors.length]}
                fontSize="8"
                fontFamily="monospace"
                opacity="0.8"
              >
                MA{ma.period}
              </text>
            )}
          </g>
        );
      })}

      {/* Golden/dead cross markers */}
      {mas.length >= 2 &&
        (() => {
          const fast = mas[0]!.values; // shortest period (MA5)
          const slow = mas[2]?.values ?? mas[1]!.values; // MA20 or MA10
          const crosses = crossover(fast, slow);

          return crosses.map((cross) => {
            const x = toX(cross.index);
            const y = toY(fast[cross.index]);
            const color = cross.type === "golden" ? "#7fb7a3" : "#df6b55";
            const CrossIcon = cross.type === "golden" ? ArrowUp : ArrowDown;

            return (
              <g key={cross.index}>
                <circle cx={x} cy={y} r="4" fill={color} opacity="0.8" />
                <CrossIcon
                  x={x - 6}
                  y={y - 20}
                  width={12}
                  height={12}
                  color={color}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </g>
            );
          });
        })()}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MACD Subchart
// ---------------------------------------------------------------------------

export function MACDSubchart({
  prices,
  width = 260,
  height = 80,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
}: {
  prices: number[];
  width?: number;
  height?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}) {
  const result = useMemo(
    () => macd(prices, fastPeriod, slowPeriod, signalPeriod),
    [prices, fastPeriod, slowPeriod, signalPeriod]
  );

  const allValues = [
    ...result.macd.filter((v) => Number.isFinite(v)),
    ...result.signal.filter((v) => Number.isFinite(v)),
    ...result.histogram.filter((v) => Number.isFinite(v)),
  ];
  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 0);
  const range = max - min || 1;

  const toY = (v: number) => height - ((v - min) / range) * height;
  const toX = (i: number) =>
    (i / Math.max(1, result.macd.length - 1)) * width;
  const zeroY = toY(0);

  // Build paths for MACD and signal lines
  const macdPath = result.macd
    .map((v, i) => {
      if (!Number.isFinite(v)) return "";
      const x = toX(i);
      const y = toY(v);
      return `${i === 0 || !Number.isFinite(result.macd[i - 1]) ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");

  const signalPath = result.signal
    .map((v, i) => {
      if (!Number.isFinite(v)) return "";
      const x = toX(i);
      const y = toY(v);
      return `${i === 0 || !Number.isFinite(result.signal[i - 1]) ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className="w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="MACD"
    >
      {/* Zero line */}
      <line
        x1={0}
        y1={zeroY}
        x2={width}
        y2={zeroY}
        stroke="rgba(216,208,189,0.2)"
        strokeWidth="0.5"
        strokeDasharray="3 3"
      />

      {/* Histogram bars */}
      {result.histogram.map((v, i) => {
        if (!Number.isFinite(v)) return null;
        const x = toX(i);
        const barW = Math.max(1, width / result.histogram.length * 0.6);
        const y = toY(v);
        const barH = Math.abs(y - zeroY);
        const fill = v >= 0 ? "rgba(127,183,163,0.5)" : "rgba(223,107,85,0.5)";

        return (
          <rect
            key={i}
            x={x - barW / 2}
            y={Math.min(y, zeroY)}
            width={barW}
            height={Math.max(0.5, barH)}
            fill={fill}
          />
        );
      })}

      {/* MACD line */}
      {macdPath && (
        <path
          d={macdPath}
          fill="none"
          stroke="#d8d0bd"
          strokeWidth="1.2"
          strokeOpacity="0.8"
        />
      )}

      {/* Signal line */}
      {signalPath && (
        <path
          d={signalPath}
          fill="none"
          stroke="#bc9858"
          strokeWidth="1"
          strokeOpacity="0.6"
          strokeDasharray="4 2"
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// RSI Subchart
// ---------------------------------------------------------------------------

export function RSISubchart({
  prices,
  period = 14,
  width = 260,
  height = 80,
}: {
  prices: number[];
  period?: number;
  width?: number;
  height?: number;
}) {
  const values = useMemo(() => rsi(prices, period), [prices, period]);

  const overboughtY = height * 0.2; // RSI 70
  const oversoldY = height * 0.7; // RSI 30

  const toY = (v: number) =>
    Number.isFinite(v) ? height - (v / 100) * height : height / 2;
  const toX = (i: number) => (i / Math.max(1, values.length - 1)) * width;

  const path = values
    .map((v, i) => {
      if (!Number.isFinite(v)) return "";
      const x = toX(i);
      const y = toY(v);
      return `${i === 0 || !Number.isFinite(values[i - 1]) ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className="w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="RSI"
    >
      {/* Overbought / Oversold zones */}
      <rect
        x={0}
        y={0}
        width={width}
        height={overboughtY}
        fill="rgba(223,107,85,0.06)"
      />
      <rect
        x={0}
        y={oversoldY}
        width={width}
        height={height - oversoldY}
        fill="rgba(127,183,163,0.06)"
      />

      {/* Threshold lines */}
      <line
        x1={0} y1={overboughtY} x2={width} y2={overboughtY}
        stroke="rgba(223,107,85,0.3)" strokeWidth="0.5" strokeDasharray="4 2"
      />
      <line
        x1={0} y1={oversoldY} x2={width} y2={oversoldY}
        stroke="rgba(127,183,163,0.3)" strokeWidth="0.5" strokeDasharray="4 2"
      />
      <line
        x1={0} y1={height / 2} x2={width} y2={height / 2}
        stroke="rgba(216,208,189,0.15)" strokeWidth="0.5"
      />

      {/* RSI line */}
      {path && (
        <path
          d={path}
          fill="none"
          stroke="#bc9858"
          strokeWidth="1.5"
          strokeOpacity="0.8"
        />
      )}

      {/* Labels */}
      <text x={2} y={10} fill="rgba(223,107,85,0.5)" fontSize="8" fontFamily="monospace">70</text>
      <text x={2} y={height - 2} fill="rgba(127,183,163,0.5)" fontSize="8" fontFamily="monospace">30</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Combined indicator panel (MA + MACD + RSI)
// ---------------------------------------------------------------------------

export function IndicatorPanel({
  prices,
  showMA = true,
  showMACD = true,
  showRSI = true,
}: {
  prices: number[];
  showMA?: boolean;
  showMACD?: boolean;
  showRSI?: boolean;
}) {
  if (prices.length < 5) {
    return (
      <div className="grid h-32 place-items-center text-sm text-white/38">
        需要至少 5 个数据点才能计算指标
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {showMA && (
        <div className="rounded-[8px] border border-white/10 bg-black/6 p-3">
          <p className="mb-2 font-mono text-[10px] text-white/36">MOVING AVERAGES</p>
          <MAOverlay prices={prices} />
        </div>
      )}
      {showMACD && (
        <div className="rounded-[8px] border border-white/10 bg-black/6 p-3">
          <p className="mb-2 font-mono text-[10px] text-white/36">MACD (12, 26, 9)</p>
          <MACDSubchart prices={prices} />
        </div>
      )}
      {showRSI && (
        <div className="rounded-[8px] border border-white/10 bg-black/6 p-3">
          <p className="mb-2 font-mono text-[10px] text-white/36">RSI (14)</p>
          <RSISubchart prices={prices} />
        </div>
      )}
    </div>
  );
}
