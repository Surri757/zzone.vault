"use client";

import {
  BarChart3,
  CandlestickChart,
  ChartArea,
  ChartColumnBig,
  ChartNetwork,
  ChartSpline,
  Cuboid,
  LineChart
} from "lucide-react";
import { normalized } from "@/components/shared/util";
import type { VisualizationMode, MarketPoint } from "@/lib/market-data-hub";
import type { LiveQuote } from "@/lib/live-instruments";

function lensIcon(mode: VisualizationMode) {
  if (mode === "line") return LineChart;
  if (mode === "area") return ChartArea;
  if (mode === "bars") return ChartColumnBig;
  if (mode === "heatmap") return BarChart3;
  if (mode === "surface") return Cuboid;
  if (mode === "candlestick") return CandlestickChart;
  return ChartNetwork;
}

export type { VisualizationMode, MarketPoint };

export function quoteToMarketPoints(quote: LiveQuote): MarketPoint[] {
  const source =
    quote.series.length >= 2
      ? quote.series
      : [quote.previousClose, quote.open, quote.low, quote.price, quote.high].filter(
          (value): value is number => typeof value === "number"
        );
  const values =
    source.length >= 2
      ? source
      : Array.from({ length: 8 }, (_, index) => (quote.price ?? 0) + index * 0.001);
  const absoluteChange = Math.abs(quote.changePct ?? 0);

  return values.map((value, index) => ({
    t: `${index + 1}`,
    value,
    volume: Number(((quote.volume ?? 0) / Math.max(values.length, 1) / 10000 + index * 3).toFixed(2)),
    volatility: Number(Math.min(1, 0.18 + absoluteChange / 8 + index / values.length / 5).toFixed(2)),
    depth: Number(
      Math.min(
        1,
        0.24 +
          ((quote.depth.bids[0]?.size ?? 0) + (quote.depth.asks[0]?.size ?? 0)) /
            1000000
      ).toFixed(2)
    ),
    sentiment: Number(Math.max(0.1, Math.min(0.9, 0.5 + (quote.changePct ?? 0) / 18)).toFixed(2))
  }));
}

export function MultiLensGraphic({
  points,
  mode
}: {
  points: MarketPoint[];
  mode: VisualizationMode;
}) {
  const width = 260;
  const height = 118;
  const safePoints =
    points.length >= 2
      ? points
      : Array.from({ length: 8 }, (_, index) => ({
          t: `${index + 1}`,
          value: 1 + index * 0.01,
          volume: 12 + index,
          volatility: 0.2,
          depth: 0.35,
          sentiment: 0.5
        }));
  const values = safePoints.map((point) => point.value);
  const scale = normalized(values);
  const volumeScale = normalized(safePoints.map((point) => point.volume));
  const path = scale
    .map((value, index) => {
      const x = (index / (scale.length - 1)) * width;
      const y = height - value * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  if (mode === "bars") {
    return (
      <div className="flex h-32 items-end gap-1 overflow-hidden">
        {safePoints.map((point, index) => (
          <span
            key={`${point.t}-${index}`}
            className="block flex-1 rounded-t-[3px] bg-acid/75"
            style={{
              height: `${18 + volumeScale[index] * 96}px`,
              opacity: 0.42 + point.depth * 0.48
            }}
          />
        ))}
      </div>
    );
  }

  if (mode === "heatmap") {
    return (
      <div className="grid h-32 grid-cols-6 gap-1">
        {safePoints.map((point, index) => (
          <span
            key={`${point.t}-${index}`}
            className="rounded-[4px] border border-white/[0.06]"
            style={{
              background: `rgba(${Math.round(73 + volumeScale[index] * 80)}, ${Math.round(145 + point.depth * 90)}, ${Math.round(110 + point.volatility * 80)}, ${0.22 + point.volatility * 0.52})`
            }}
          />
        ))}
      </div>
    );
  }

  if (mode === "surface") {
    return (
      <div className="flex h-32 items-end justify-between gap-1 [perspective:620px]">
        {safePoints.map((point, index) => (
          <span
            key={`${point.t}-${index}`}
            className="block w-full origin-bottom border border-acid/20 bg-gradient-to-t from-acid/15 via-cyanline/20 to-amberline/50"
            style={{
              height: `${24 + scale[index] * 84}px`,
              transform: `rotateX(58deg) translateZ(${point.depth * 16}px)`,
              opacity: 0.42 + point.sentiment
            }}
          />
        ))}
      </div>
    );
  }

  if (mode === "network") {
    const nodes = safePoints.slice(0, 10).map((point, index) => {
      const x = 20 + (index / 9) * (width - 40);
      const y = 20 + (1 - point.depth) * (height - 40);
      return { x, y, point };
    });

    return (
      <svg className="h-32 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {nodes.slice(1).map((node, index) => (
          <line
            key={`${node.point.t}-line`}
            x1={nodes[index].x}
            y1={nodes[index].y}
            x2={node.x}
            y2={node.y}
            stroke="#d8d0bd"
            strokeOpacity="0.28"
            strokeWidth="1.5"
          />
        ))}
        {nodes.map((node) => (
          <circle
            key={node.point.t}
            cx={node.x}
            cy={node.y}
            r={3 + node.point.volatility * 6}
            fill={node.point.sentiment > 0.48 ? "#7fb7a3" : "#bc9858"}
            opacity="0.8"
          />
        ))}
      </svg>
    );
  }

  return (
    <svg className="h-32 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
      {mode === "area" ? (
        <path
          d={`${path} L ${width} ${height} L 0 ${height} Z`}
          fill="#7fb7a3"
          opacity="0.18"
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke={mode === "area" ? "#7fb7a3" : "#d8d0bd"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LensIcon({ mode }: { mode: VisualizationMode }) {
  const Icon = lensIcon(mode);
  return <Icon className="h-4 w-4 text-acid" />;
}

export { lensIcon };
