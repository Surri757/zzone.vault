"use client";

import { useMemo } from "react";
import type { LiveQuote } from "@/lib/live-instruments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DepthLevel {
  price: number;
  size: number;
}

export interface DepthChartProps {
  depth: LiveQuote["depth"];
  currentPrice?: number | null;
  maxLevels?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DepthChart({
  depth,
  currentPrice,
  maxLevels = 10,
}: DepthChartProps) {
  const { bidCurve, askCurve, maxCumulative, priceMin, priceMax } =
    useMemo(() => {
      const bids = depth.bids.slice(0, maxLevels);
      const asks = depth.asks.slice(0, maxLevels);

      // Build cumulative volume curves
      const bidCurve: Array<{ price: number; cumulativeSize: number }> = [];
      const askCurve: Array<{ price: number; cumulativeSize: number }> = [];

      let bidCum = 0;
      for (const bid of bids) {
        if (bid.price <= 0 || bid.size <= 0) continue;
        bidCum += bid.size;
        bidCurve.push({ price: bid.price, cumulativeSize: bidCum });
      }

      let askCum = 0;
      for (const ask of asks) {
        if (ask.price <= 0 || ask.size <= 0) continue;
        askCum += ask.size;
        askCurve.push({ price: ask.price, cumulativeSize: askCum });
      }

      const maxCumulative = Math.max(
        bidCurve.length > 0 ? bidCurve[bidCurve.length - 1].cumulativeSize : 0,
        askCurve.length > 0 ? askCurve[askCurve.length - 1].cumulativeSize : 0,
        1
      );

      const allPrices = [
        ...bidCurve.map((b) => b.price),
        ...askCurve.map((a) => a.price),
        currentPrice ?? 0,
      ].filter((p) => p > 0);

      const priceMin = allPrices.length > 0 ? Math.min(...allPrices) * 0.98 : 0;
      const priceMax = allPrices.length > 0 ? Math.max(...allPrices) * 1.02 : 100;

      return { bidCurve, askCurve, maxCumulative, priceMin, priceMax };
    }, [depth, currentPrice, maxLevels]);

  const width = 320;
  const height = 180;
  const pad = { left: 8, right: 8, top: 12, bottom: 24 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const midX = pad.left + chartW / 2;

  const priceToY = (price: number) => {
    const range = priceMax - priceMin || 1;
    return pad.top + ((priceMax - price) / range) * chartH;
  };

  const sizeToX = (size: number, side: "bid" | "ask") => {
    const ratio = size / maxCumulative;
    return side === "bid"
      ? midX - ratio * (chartW / 2)
      : midX + ratio * (chartW / 2);
  };

  // Build SVG paths
  const bidPath = useMemo(() => {
    if (bidCurve.length === 0) return "";
    let d = "";
    for (let i = 0; i < bidCurve.length; i++) {
      const x = sizeToX(bidCurve[i].cumulativeSize, "bid");
      const y = priceToY(bidCurve[i].price);
      d += i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }
    // Close to baseline
    if (bidCurve.length > 0) {
      d += ` L ${midX} ${priceToY(bidCurve[bidCurve.length - 1].price)}`;
      d += ` L ${midX} ${priceToY(bidCurve[0].price)} Z`;
    }
    return d;
  }, [bidCurve, midX, priceToY, sizeToX]);

  const askPath = useMemo(() => {
    if (askCurve.length === 0) return "";
    let d = "";
    for (let i = 0; i < askCurve.length; i++) {
      const x = sizeToX(askCurve[i].cumulativeSize, "ask");
      const y = priceToY(askCurve[i].price);
      d += i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }
    if (askCurve.length > 0) {
      d += ` L ${midX} ${priceToY(askCurve[askCurve.length - 1].price)}`;
      d += ` L ${midX} ${priceToY(askCurve[0].price)} Z`;
    }
    return d;
  }, [askCurve, midX, priceToY, sizeToX]);

  const priceY = currentPrice ? priceToY(currentPrice) : null;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: n > 100 ? 1 : 4,
    }).format(n);

  const compactFmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);

  if (bidCurve.length === 0 && askCurve.length === 0) {
    return (
      <div className="grid h-48 place-items-center rounded-[8px] border border-dashed border-white/10 text-sm text-white/38">
        当前无盘口数据
      </div>
    );
  }

  const spread =
    depth.asks.length > 0 && depth.bids.length > 0
      ? depth.asks[0].price - depth.bids[0].price
      : null;
  const spreadPct =
    spread !== null && depth.bids[0]?.price > 0
      ? (spread / depth.bids[0].price) * 100
      : null;

  return (
    <div className="overflow-hidden rounded-[8px] border border-white/10 bg-black/6 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-white">ORDER BOOK DEPTH</span>
        {spread !== null && (
          <span className="font-mono text-xs text-white/48">
            Spread: {fmt(spread)} ({spreadPct?.toFixed(3)}%)
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="盘口深度图"
      >
        {/* Bid area */}
        {bidPath && (
          <path
            d={bidPath}
            fill="rgba(127,183,163,0.15)"
            stroke="#7fb7a3"
            strokeWidth="1.2"
            strokeOpacity="0.7"
          />
        )}

        {/* Ask area */}
        {askPath && (
          <path
            d={askPath}
            fill="rgba(223,107,85,0.15)"
            stroke="#df6b55"
            strokeWidth="1.2"
            strokeOpacity="0.7"
          />
        )}

        {/* Mid-price line */}
        {priceY !== null && (
          <line
            x1={pad.left}
            y1={priceY}
            x2={width - pad.right}
            y2={priceY}
            stroke="rgba(216,208,189,0.4)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}

        {/* Center divider */}
        <line
          x1={midX}
          y1={pad.top}
          x2={midX}
          y2={height - pad.bottom}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.5"
        />

        {/* Labels */}
        <text
          x={pad.left}
          y={pad.top - 2}
          fill="rgba(127,183,163,0.6)"
          fontSize="9"
          fontFamily="monospace"
        >
          BIDS
        </text>
        <text
          x={width - pad.right}
          y={pad.top - 2}
          fill="rgba(223,107,85,0.6)"
          fontSize="9"
          fontFamily="monospace"
          textAnchor="end"
        >
          ASKS
        </text>

        {/* Price annotations */}
        {currentPrice && priceY !== null && (
          <text
            x={width - pad.right}
            y={priceY - 4}
            fill="rgba(216,208,189,0.6)"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="end"
          >
            {fmt(currentPrice)}
          </text>
        )}

        {/* Volume labels */}
        {bidCurve.length > 0 && (
          <text
            x={pad.left}
            y={height - 4}
            fill="rgba(127,183,163,0.5)"
            fontSize="8"
            fontFamily="monospace"
          >
            {compactFmt(bidCurve[bidCurve.length - 1].cumulativeSize)}
          </text>
        )}
        {askCurve.length > 0 && (
          <text
            x={width - pad.right}
            y={height - 4}
            fill="rgba(223,107,85,0.5)"
            fontSize="8"
            fontFamily="monospace"
            textAnchor="end"
          >
            {compactFmt(askCurve[askCurve.length - 1].cumulativeSize)}
          </text>
        )}
      </svg>
    </div>
  );
}
