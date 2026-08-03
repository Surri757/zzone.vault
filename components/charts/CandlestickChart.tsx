"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { OHLCBar } from "@/lib/stock-bars";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandlestickChartProps {
  bars: OHLCBar[];
  width?: number;
  height?: number;
  /** Show volume sub-pane below the price chart */
  showVolume?: boolean;
  /** Color for bullish (close > open) candles */
  bullishColor?: string;
  /** Color for bearish (close <= open) candles */
  bearishColor?: string;
}

interface Crosshair {
  x: number;
  y: number;
  index: number;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 640;
const PRICE_HEIGHT_RATIO = 0.68;
const VOLUME_HEIGHT_RATIO = 0.20;
const PADDING = { top: 20, right: 16, bottom: 20, left: 12 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CandlestickChart({
  bars,
  width = DEFAULT_WIDTH,
  height,
  showVolume = true,
  bullishColor = "#7fb7a3",
  bearishColor = "#df6b55",
}: CandlestickChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [crosshair, setCrosshair] = useState<Crosshair>({
    x: 0,
    y: 0,
    index: -1,
    visible: false,
  });

  const totalHeight = height ?? Math.round(width * 0.55);
  const priceHeight = Math.round(
    totalHeight * (showVolume ? PRICE_HEIGHT_RATIO : 1.0)
  );
  const volumeHeight = showVolume
    ? Math.round(totalHeight * VOLUME_HEIGHT_RATIO)
    : 0;
  const gap = showVolume ? Math.round(totalHeight * 0.02) : 0;

  const chartWidth = width - PADDING.left - PADDING.right;
  const priceChartBottom = PADDING.top + priceHeight;
  const volumeChartTop = priceChartBottom + gap + PADDING.top;

  // Compute scales
  const { candleBodyWidth, barSpacing } = useMemo(() => {
    if (bars.length <= 1) return { candleBodyWidth: 6, barSpacing: chartWidth / 2 };
    const spacing = chartWidth / bars.length;
    const bodyW = Math.max(2, Math.min(spacing * 0.7, 14));
    return { candleBodyWidth: bodyW, barSpacing: spacing };
  }, [bars.length, chartWidth]);

  const { priceMin, priceMax, priceRange } = useMemo(() => {
    const allPrices = bars.flatMap((b) => [b.h, b.l]);
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const range = max - min || 1;
    const padding = range * 0.05;
    return {
      priceMin: min - padding,
      priceMax: max + padding,
      priceRange: range + padding * 2,
    };
  }, [bars]);

  const { volumeMax } = useMemo(() => {
    const max = Math.max(...bars.map((b) => b.v), 1);
    return { volumeMax: max };
  }, [bars]);

  const priceY = useCallback(
    (price: number) =>
      priceChartBottom - ((price - priceMin) / priceRange) * priceHeight,
    [priceChartBottom, priceMin, priceRange, priceHeight]
  );

  const volumeY = useCallback(
    (vol: number) => (vol / volumeMax) * volumeHeight,
    [volumeMax, volumeHeight]
  );

  // Grid lines
  const gridLines = useMemo(() => {
    const count = 5;
    return Array.from({ length: count + 1 }, (_, i) => {
      const price = priceMin + (priceRange * i) / count;
      return { y: priceY(price), price };
    });
  }, [priceMin, priceRange, priceY]);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - PADDING.left;
      const my = e.clientY - rect.top;

      const idx = Math.round(mx / barSpacing);
      const clampedIdx = Math.max(0, Math.min(bars.length - 1, idx));

      if (mx >= 0 && mx <= chartWidth && my <= priceChartBottom) {
        setCrosshair({
          x: mx + PADDING.left,
          y: my,
          index: clampedIdx,
          visible: true,
        });
      } else {
        setCrosshair({ x: 0, y: 0, index: -1, visible: false });
      }
    },
    [bars.length, barSpacing, chartWidth, priceChartBottom]
  );

  const handleMouseLeave = useCallback(() => {
    setCrosshair({ x: 0, y: 0, index: -1, visible: false });
  }, []);

  // Format helpers
  const fmt = useCallback(
    (n: number, d = 2) =>
      new Intl.NumberFormat("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(n),
    []
  );

  const hoveredBar =
    crosshair.visible && crosshair.index >= 0 ? bars[crosshair.index] : null;

  // Chart width including labels
  const svgWidth = width;
  const svgHeight =
    PADDING.top + priceHeight + gap + volumeHeight + PADDING.bottom;

  if (bars.length === 0) {
    return (
      <div className="grid h-64 place-items-center rounded-[8px] border border-dashed border-white/10 text-sm text-white/38">
        暂无 K 线数据 — 请先加载历史行情
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[8px] border border-white/10 bg-black/24">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        role="img"
        aria-label="K 线图"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Price grid lines */}
        {gridLines.map((gl) => (
          <g key={gl.y}>
            <line
              x1={PADDING.left}
              y1={gl.y}
              x2={width - PADDING.right}
              y2={gl.y}
              stroke="rgba(216,208,189,0.08)"
              strokeWidth="0.5"
            />
            <text
              x={width - PADDING.right + 2}
              y={gl.y + 4}
              className="fill-white/28 font-mono"
              fontSize="9"
              textAnchor="start"
            >
              {fmt(gl.price, gl.price > 1000 ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* Candles */}
        {bars.map((bar, i) => {
          const x = i * barSpacing + PADDING.left + barSpacing / 2;
          const bullish = bar.c >= bar.o;
          const color = bullish ? bullishColor : bearishColor;
          const bodyTop = priceY(Math.max(bar.o, bar.c));
          const bodyH = Math.max(1, Math.abs(priceY(bar.o) - priceY(bar.c)));
          const wickTop = priceY(bar.h);
          const wickBottom = priceY(bar.l);

          return (
            <g key={bar.t}>
              {/* Wick */}
              <line
                x1={x}
                y1={wickTop}
                x2={x}
                y2={wickBottom}
                stroke={color}
                strokeWidth="1"
                opacity="0.8"
              />
              {/* Body */}
              <rect
                x={x - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={bodyH}
                fill={bullish ? color : color}
                opacity={bullish ? 0.85 : 0.75}
              />
            </g>
          );
        })}

        {/* Volume bars */}
        {showVolume &&
          bars.map((bar, i) => {
            const x = i * barSpacing + PADDING.left + barSpacing / 2;
            const vH = volumeY(bar.v);
            const bullish = bar.c >= bar.o;
            const color = bullish ? `${bullishColor}55` : `${bearishColor}55`;

            return (
              <rect
                key={`v-${bar.t}`}
                x={x - candleBodyWidth / 2}
                y={volumeChartTop + volumeHeight - vH}
                width={candleBodyWidth}
                height={Math.max(0.5, vH)}
                fill={color}
                opacity="0.6"
              />
            );
          })}

        {/* Crosshair */}
        {crosshair.visible && (
          <g>
            <line
              x1={PADDING.left}
              y1={crosshair.y}
              x2={width - PADDING.right}
              y2={crosshair.y}
              stroke="rgba(216,208,189,0.3)"
              strokeWidth="0.5"
              strokeDasharray="4 4"
            />
            <line
              x1={crosshair.x}
              y1={PADDING.top}
              x2={crosshair.x}
              y2={
                showVolume
                  ? volumeChartTop + volumeHeight
                  : priceChartBottom
              }
              stroke="rgba(216,208,189,0.3)"
              strokeWidth="0.5"
              strokeDasharray="4 4"
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoveredBar && (
        <div className="absolute left-2 top-2 rounded-[6px] border border-acid/40 bg-[#070807]/95 px-3 py-2 font-mono text-xs shadow-panel-edge backdrop-blur-md">
          <p className="text-white/52">{new Date(hoveredBar.t).toLocaleString("zh-CN")}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-white/36">O</span>
            <span className="text-white">{fmt(hoveredBar.o, 4)}</span>
            <span className="text-white/36">H</span>
            <span className="text-acid">{fmt(hoveredBar.h, 4)}</span>
            <span className="text-white/36">L</span>
            <span className="text-dangerline">{fmt(hoveredBar.l, 4)}</span>
            <span className="text-white/36">C</span>
            <span
              className={
                hoveredBar.c >= hoveredBar.o ? "text-acid" : "text-dangerline"
              }
            >
              {fmt(hoveredBar.c, 4)}
            </span>
            <span className="text-white/36">V</span>
            <span className="text-white/72">
              {new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(hoveredBar.v)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
