"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BusinessDay, IChartApi, LineData, Time } from "lightweight-charts";

export interface PeerTrendPoint {
  date: string;
  value: number;
}

export interface PeerTrendLine {
  id: "CN" | "US";
  label: string;
  color: string;
  points: PeerTrendPoint[];
}

type InspectedValues = {
  date: string;
  CN: number | null;
  US: number | null;
};

function businessDay(date: string): BusinessDay {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function timeLabel(time: Time | undefined) {
  if (!time || typeof time !== "object" || !("year" in time)) return "";
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function signedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function PeerTrendChart({ lines }: { lines: readonly PeerTrendLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const latest = useMemo<InspectedValues>(() => {
    const cn = lines.find((line) => line.id === "CN")?.points.at(-1);
    const us = lines.find((line) => line.id === "US")?.points.at(-1);
    return {
      date: [cn?.date, us?.date].filter(Boolean).sort().at(-1) ?? "",
      CN: cn?.value ?? null,
      US: us?.value ?? null,
    };
  }, [lines]);
  const [inspected, setInspected] = useState<InspectedValues>(latest);

  useEffect(() => setInspected(latest), [latest]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || lines.every((line) => line.points.length === 0)) return;

    let disposed = false;

    async function mount() {
      const { ColorType, CrosshairMode, LineSeries, createChart } = await import(
        "lightweight-charts"
      );
      if (disposed || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        autoSize: true,
        height: 350,
        layout: {
          background: { type: ColorType.Solid, color: "rgba(5, 7, 5, 0.34)" },
          textColor: "rgba(229, 221, 202, 0.7)",
          attributionLogo: false,
          fontFamily: "var(--ink-font-mono), ui-monospace, monospace",
          fontSize: 13,
        },
        grid: {
          vertLines: { color: "rgba(229, 221, 202, 0.055)" },
          horzLines: { color: "rgba(229, 221, 202, 0.08)" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: "rgba(229, 221, 202, 0.36)",
            labelBackgroundColor: "#263b33",
          },
          horzLine: {
            color: "rgba(229, 221, 202, 0.28)",
            labelBackgroundColor: "#263b33",
          },
        },
        rightPriceScale: {
          borderColor: "rgba(229, 221, 202, 0.14)",
          minimumWidth: 76,
        },
        timeScale: {
          borderColor: "rgba(229, 221, 202, 0.14)",
          rightOffset: 2,
          barSpacing: 7,
          minBarSpacing: 2.5,
        },
        localization: {
          locale: "zh-CN",
          priceFormatter: (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`,
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
      });

      const series = new Map<PeerTrendLine["id"], ReturnType<typeof chart.addSeries>>();
      for (const line of lines) {
        const lineSeries = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: 3,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 5,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        lineSeries.setData(
          line.points.map(
            (point): LineData<BusinessDay> => ({
              time: businessDay(point.date),
              value: point.value,
            })
          )
        );
        series.set(line.id, lineSeries);
      }

      chart.subscribeCrosshairMove((event) => {
        if (!event.time) {
          setInspected(latest);
          return;
        }
        const next: InspectedValues = {
          date: timeLabel(event.time),
          CN: null,
          US: null,
        };
        for (const [id, lineSeries] of series) {
          const datum = event.seriesData.get(lineSeries) as LineData<Time> | undefined;
          if (datum && "value" in datum) next[id] = datum.value;
        }
        setInspected(next);
      });

      chart.timeScale().fitContent();
      chartRef.current = chart;
    }

    void mount();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [latest, lines]);

  if (lines.every((line) => line.points.length === 0)) {
    return (
      <div className="grid h-[22rem] place-items-center border border-dashed border-white/10 bg-black/20 px-6 text-center text-base text-white/52">
        暂无可比较的历史行情
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-white/10 bg-black/20">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {lines.map((line) => (
            <span key={line.id} className="inline-flex items-center gap-2 text-sm text-white/74">
              <span className="h-0.5 w-6" style={{ backgroundColor: line.color }} aria-hidden="true" />
              {line.label}
              <strong className="font-mono text-base text-white">{signedPercent(inspected[line.id])}</strong>
            </span>
          ))}
        </div>
        <span className="font-mono text-sm text-white/46">{inspected.date || "--"}</span>
      </div>
      <div
        ref={containerRef}
        className="h-[350px] w-full"
        role="img"
        aria-label="A 股与美股对标公司归一化收益走势，起点为百分之零"
      />
    </div>
  );
}
