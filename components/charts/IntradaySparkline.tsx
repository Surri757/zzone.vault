"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// IntradaySparkline — a compact A-share-style intraday curve for the catalog
// card. The baseline is the opening price: segments above it are drawn in the
// market's "rise" color, segments below in the "fall" color, so the curve
// always reads in the same tone as the price/change numbers beside it.
// -----------------------------------------------------------------------------

export interface IntradaySparklineProps {
  values: number[];
  /** Zero axis (usually the opening price). Falls back to values[0]. */
  baseline?: number | null;
  /** Color for segments at/above the baseline (market rise color). */
  riseColor: string;
  /** Color for segments below the baseline (market fall color). */
  fallColor: string;
  width?: number;
  height?: number;
  className?: string;
  /** Session time ticks along the bottom axis. Each tick carries a horizontal
   *  position (0–100, % of width) so the A-share lunch gap is drawn correctly. */
  timeAxis?: Array<{ label: string; pos: number }>;
}

const DEFAULT_TIME_AXIS = [
  { label: "09:30", pos: 0 },
  { label: "10:30", pos: 25 },
  { label: "11:30/13:00", pos: 50 },
  { label: "14:00", pos: 75 },
  { label: "15:00", pos: 100 }
];

export function IntradaySparkline({
  values,
  baseline,
  riseColor,
  fallColor,
  width = 480,
  height = 64,
  className,
  timeAxis = DEFAULT_TIME_AXIS
}: IntradaySparklineProps) {
  if (!Array.isArray(values) || values.length < 2) return null;

  const base = typeof baseline === "number" && Number.isFinite(baseline) ? baseline : values[0];
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;

  const min = Math.min(...finite, base);
  const max = Math.max(...finite, base);
  const range = max - min || 1;
  const toX = (index: number) => (index / (values.length - 1)) * width;
  const toY = (value: number) => Math.max(0, Math.min(height, height - ((value - min) / range) * height));
  const baseY = toY(base);

  const segments: Array<{ d: string; color: string }> = [];
  for (let index = 0; index < values.length - 1; index += 1) {
    const current = values[index];
    const next = values[index + 1];
    if (!Number.isFinite(current) || !Number.isFinite(next)) continue;
    const above = next >= base;
    segments.push({
      d: `M ${toX(index).toFixed(2)} ${toY(current).toFixed(2)} L ${toX(index + 1).toFixed(2)} ${toY(next).toFixed(2)}`,
      color: above ? riseColor : fallColor
    });
  }

  const axisRef = useRef<HTMLDivElement>(null);
  const [axisWidth, setAxisWidth] = useState(0);
  useLayoutEffect(() => {
    const node = axisRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setAxisWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setAxisWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  // Measure each label's real pixel width with an offscreen canvas at the same
  // mono font CSS uses, so the collision pass never guesses.
  const measureLabel = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    return (text: string) => {
      if (!ctx) return text.length * 6;
      ctx.font = '9px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
      return ctx.measureText(text).width;
    };
  }, []);

  // Greedy collision skip: drop a tick when it would overlap the previously
  // kept one. Keeps the 15-min granularity where the card is wide enough and
  // clears the log-jam at the mid-day lunch label.
  const visibleTicks = (() => {
    if (axisWidth <= 0) return timeAxis;
    const gap = 6;
    const kept: Array<{ label: string; pos: number; _halfSpan: number }> = [];
    for (const tick of timeAxis) {
      const labelPx = measureLabel(tick.label);
      const center = (tick.pos / 100) * axisWidth;
      const isFirst = kept.length === 0;
      const isLast = tick.pos === 100;
      const start = isFirst ? 0 : center - labelPx / 2;
      const prev = kept[kept.length - 1];
      if (prev && start < ((prev.pos / 100) * axisWidth + prev._halfSpan + gap)) {
        continue;
      }
      kept.push({ ...tick, _halfSpan: labelPx / 2 });
    }
    return kept;
  })();

  return (
    <div className={className}>
      <svg
        className="h-[calc(100%-1.05rem)] w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="当日分时走势"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          x2={width}
          y1={baseY}
          y2={baseY}
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {segments.map((segment, index) => (
          <path
            key={index}
            d={segment.d}
            fill="none"
            stroke={segment.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div
          ref={axisRef}
          className="relative mt-0.5 h-3 font-mono leading-3 tracking-wide text-white/30"
          style={{ fontSize: "9px" }}
        >
        {visibleTicks.map((tick, index) => {
          const anchoredLeft = index === 0;
          const anchoredRight = tick.pos === 100;
          return (
            <span
              key={`${tick.label}-${index}`}
              className="absolute top-0 whitespace-nowrap"
              style={{
                left: `${tick.pos}%`,
                transform: anchoredLeft
                  ? "translateX(0)"
                  : anchoredRight
                  ? "translateX(-100%)"
                  : "translateX(-50%)"
              }}
            >
              {tick.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}