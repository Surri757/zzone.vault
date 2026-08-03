"use client";

import { useMemo } from "react";
import type { LiveQuote } from "@/lib/live-instruments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockData {
  id: string;
  symbol: string;
  name: string;
  series: number[];
}

export interface CorrelationHeatmapProps {
  stocks: StockData[];
  maxDisplay?: number;
}

// ---------------------------------------------------------------------------
// Pearson correlation
// ---------------------------------------------------------------------------

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] ** 2;
    sumB2 += b[i] ** 2;
  }

  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA ** 2) * (n * sumB2 - sumB ** 2));
  return den === 0 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// Color scale
// ---------------------------------------------------------------------------

function correlationColor(r: number): string {
  const abs = Math.abs(r);
  if (r > 0) {
    // Positive: acid green
    return `rgba(127,183,163,${0.15 + abs * 0.7})`;
  } else if (r < 0) {
    // Negative: danger red
    return `rgba(223,107,85,${0.15 + abs * 0.7})`;
  }
  // Neutral
  return "rgba(216,208,189,0.12)";
}

function correlationTextColor(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.3) return "rgba(255,255,255,0.4)";
  if (r > 0) return "#7fb7a3";
  return "#df6b55";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CorrelationHeatmap({
  stocks,
  maxDisplay = 20,
}: CorrelationHeatmapProps) {
  const { matrix, displayStocks } = useMemo(() => {
    const display = stocks.slice(0, maxDisplay);
    const n = display.length;

    // Compute correlation matrix
    const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          m[i][j] = 1;
        } else if (j < i) {
          m[i][j] = m[j][i]; // Mirror
        } else {
          m[i][j] = pearsonCorrelation(display[i].series, display[j].series);
        }
      }
    }

    return { matrix: m, displayStocks: display };
  }, [stocks, maxDisplay]);

  // Find strongest pairs (excluding self-correlations)
  const strongestPairs = useMemo(() => {
    const pairs: Array<{ a: string; b: string; r: number }> = [];
    for (let i = 0; i < displayStocks.length; i++) {
      for (let j = i + 1; j < displayStocks.length; j++) {
        pairs.push({
          a: displayStocks[i].symbol,
          b: displayStocks[j].symbol,
          r: matrix[i][j],
        });
      }
    }
    return pairs
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .slice(0, 8);
  }, [displayStocks, matrix]);

  if (stocks.length < 2) {
    return (
      <div className="grid h-48 place-items-center rounded-[8px] border border-dashed border-white/10 text-sm text-white/38">
        需要至少 2 只股票才能计算相关性
      </div>
    );
  }

  const cellSize = Math.max(16, Math.min(32, 300 / displayStocks.length));

  return (
    <div className="overflow-hidden rounded-[8px] border border-white/10 bg-black/24 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-sm text-white">CORRELATION MATRIX</span>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto thin-scrollbar">
        <div className="inline-flex flex-col gap-px">
          {/* Column labels */}
          <div className="flex gap-px" style={{ paddingLeft: 52 }}>
            {displayStocks.map((s) => (
              <div
                key={s.symbol}
                className="flex items-end justify-center"
                style={{ width: cellSize }}
              >
                <span
                  className="block origin-bottom-left -rotate-45 whitespace-nowrap font-mono text-[10px] text-white/42"
                  style={{ transform: "rotate(-60deg)", height: cellSize * 1.2 }}
                >
                  {s.symbol}
                </span>
              </div>
            ))}
          </div>

          {/* Rows */}
          {displayStocks.map((stock, i) => (
            <div key={stock.symbol} className="flex items-center gap-px">
              <span className="w-12 shrink-0 truncate text-right font-mono text-[10px] text-white/42 pr-2">
                {stock.symbol}
              </span>
              {displayStocks.map((_, j) => (
                <div
                  key={j}
                  className="grid place-items-center rounded-[2px] transition hover:scale-110 hover:z-10"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: correlationColor(matrix[i][j]),
                  }}
                  title={`${displayStocks[i].symbol} × ${displayStocks[j].symbol}: ${(matrix[i][j] * 100).toFixed(1)}%`}
                >
                  <span
                    className="font-mono text-[9px]"
                    style={{ color: correlationTextColor(matrix[i][j]) }}
                  >
                    {i === j ? "·" : (matrix[i][j] * 100).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Strongest pairs summary */}
      <div className="mt-4 border-t border-white/10 pt-3">
        <p className="mb-2 font-mono text-[10px] text-white/36">
          最强相关对 (TOP {strongestPairs.length})
        </p>
        <div className="grid gap-1.5 md:grid-cols-2">
          {strongestPairs.map((pair) => (
            <div
              key={`${pair.a}-${pair.b}`}
              className="flex items-center justify-between rounded-[4px] border border-white/[0.06] bg-white/[0.02] px-2 py-1"
            >
              <span className="font-mono text-[10px] text-white/58">
                {pair.a} ↔ {pair.b}
              </span>
              <span
                className="font-mono text-[10px]"
                style={{ color: correlationTextColor(pair.r) }}
              >
                {pair.r > 0 ? "+" : ""}
                {(pair.r * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-[9px] text-white/28">-100%</span>
        <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-dangerline via-cyanline/30 to-acid" />
        <span className="font-mono text-[9px] text-white/28">+100%</span>
      </div>
    </div>
  );
}

/** Helper to extract stock data from LiveQuote array */
export function stocksToCorrelationData(
  quotes: LiveQuote[]
): StockData[] {
  return quotes
    .filter((q) => q.series.length >= 3)
    .map((q) => ({
      id: q.instrument.id,
      symbol: q.instrument.symbol,
      name: q.instrument.name,
      series: q.series,
    }));
}
