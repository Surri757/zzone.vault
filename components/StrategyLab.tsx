"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  FlaskConical,
  Route,
  Target
} from "lucide-react";
import type { Asset, StrategyDirection, StrategySignal } from "@/lib/types";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import { className } from "@/components/shared/util";

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0
});

const directionMeta: Record<
  StrategyDirection,
  { label: string; tone: string }
> = {
  long: { label: "做多 / LONG", tone: "border-acid/30 bg-acid/10 text-acid" },
  short: {
    label: "做空 / SHORT",
    tone: "border-dangerline/30 bg-dangerline/10 text-dangerline"
  },
  neutral: {
    label: "中性 / NEUTRAL",
    tone: "border-amberline/30 bg-amberline/10 text-amberline"
  }
};

const statusLabel: Record<StrategySignal["status"], string> = {
  watching: "观察中 / WATCHING",
  armed: "已触发 / ARMED",
  cooldown: "冷却中 / COOLDOWN"
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function DirectionIcon({ direction }: { direction: StrategyDirection }) {
  if (direction === "long") {
    return <ArrowUpRight className="h-4 w-4 text-acid" aria-hidden="true" />;
  }

  if (direction === "short") {
    return <ArrowDownRight className="h-4 w-4 text-dangerline" aria-hidden="true" />;
  }

  return <Route className="h-4 w-4 text-amberline" aria-hidden="true" />;
}

export { DirectionIcon };

export function StrategyLab({
  signals,
  selectedAsset
}: {
  signals: StrategySignal[];
  selectedAsset: Asset;
}) {
  return (
    <section id="strategies" className="ink-section relative z-10 px-4 py-12 sm:px-6 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4 lg:block">
            <div>
              <p className="ink-kicker flex items-center gap-2 text-sm text-voltage">
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                STRATEGY LAB
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold text-white sm:text-5xl">
                信号实验室
              </h2>
            </div>
            <span className="border border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-white/58 lg:mt-4 lg:inline-flex">
              LOCAL SIMULATION / RESEARCH
            </span>
          </div>
          <div className="ink-panel mt-6 rounded-[8px] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-white/44">FOCUS</p>
                <p className="mt-1 font-mono text-3xl text-white">{selectedAsset.symbol}</p>
              </div>
              <Target className="h-10 w-10 text-acid" aria-hidden="true" />
            </div>
            <div className="mt-6">
              <MiniSparkline values={selectedAsset.trend} tone="pink" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <p className="font-mono text-[11px] text-white/48">PRICE</p>
                <p className="font-mono text-sm text-white">
                  {preciseCurrency.format(selectedAsset.price)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[11px] text-white/48">VOL</p>
                <p className="font-mono text-sm text-white">
                  {percent.format(selectedAsset.volatility)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[11px] text-white/48">HEAT</p>
                <p className="font-mono text-sm text-white">
                  {percent.format(selectedAsset.heat)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid content-start gap-3 md:grid-cols-2">
          {signals.length === 0 ? (
            <div className="ink-panel rounded-[8px] p-6 text-center text-sm text-white/48 md:col-span-2">
              暂无本地模拟策略信号
            </div>
          ) : signals.map((signal, index) => {
            const direction = directionMeta[signal.direction];
            const intensity = clampUnit(signal.intensity);
            return (
              <motion.article
                key={signal.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.05, duration: 0.42 }}
                className="ink-panel rounded-[8px] p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <DirectionIcon direction={signal.direction} />
                      <h3 className="break-words text-lg font-semibold text-white">{signal.name}</h3>
                    </div>
                    <p className="mt-1 font-mono text-xs text-white/52">
                      {signal.assetSymbol} / {statusLabel[signal.status]}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block font-mono text-[10px] text-white/48">CONFIDENCE</span>
                    <span className="mt-1 block font-mono text-sm text-acid">
                      {percent.format(signal.confidence)}
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  <span
                    className={className(
                      "inline-flex border px-2.5 py-1.5 font-mono text-xs",
                      direction.tone
                    )}
                  >
                    {direction.label}
                  </span>
                </div>

                <p className="mt-4 min-h-12 text-sm leading-6 text-white/66">
                  {signal.reason}
                </p>

                <div className="mt-5">
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                    <span className="text-white/48">信号强度 / INTENSITY</span>
                    <span className="text-white/72">{percent.format(intensity)}</span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden bg-white/10"
                    role="meter"
                    aria-label={`${signal.name} 信号强度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(intensity * 100)}
                    aria-valuetext={percent.format(intensity)}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${intensity * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-voltage"
                    />
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
