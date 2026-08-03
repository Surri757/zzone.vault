"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart
} from "lucide-react";
import type { Asset } from "@/lib/types";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import { className } from "@/components/shared/util";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0
});

export function MarketCard({ asset, index }: { asset: Asset; index: number }) {
  const positive = asset.change24h >= 0;
  const tone = positive ? "acid" : "red";

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: index * 0.04, duration: 0.45 }}
      className="ink-panel group relative overflow-hidden rounded-[8px] p-4"
    >
      <div className="absolute left-0 top-0 h-full w-1 bg-voltage opacity-70" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CandlestickChart className="h-4 w-4 text-voltage" aria-hidden="true" />
            <h3 className="font-mono text-lg text-ink">{asset.symbol}</h3>
          </div>
          <p className="mt-1 text-xs text-white/48">{asset.name}</p>
        </div>
        <span
          className={className(
            "flex items-center gap-1 font-mono text-sm",
            positive ? "text-acid" : "text-dangerline"
          )}
        >
          {positive ? (
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
          )}
          {asset.change24h.toFixed(2)}%
        </span>
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-white/42">MARK</p>
          <p className="font-mono text-2xl text-white">
            {asset.price > 1000 ? currency.format(asset.price) : preciseCurrency.format(asset.price)}
          </p>
        </div>
        <div className="w-32">
          <MiniSparkline values={asset.trend} tone={tone} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          ["VOL", asset.volatility],
          ["LIQ", asset.liquidity],
          ["HEAT", asset.heat]
        ].map(([label, value]) => (
          <div key={label} className="border-t border-white/10 pt-2">
            <p className="text-[10px] text-white/36">{label}</p>
            <p className="font-mono text-sm text-white/82">{percent.format(value as number)}</p>
          </div>
        ))}
      </div>
    </motion.article>
  );
}

export function MarketCanvas({
  markets,
  streamTick
}: {
  markets: Asset[];
  streamTick: number;
}) {
  return (
    <section id="markets" className="ink-section relative z-10 px-4 py-12 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ink-kicker flex items-center gap-2 text-sm text-voltage">
              <CandlestickChart className="h-4 w-4" aria-hidden="true" />
              MARKET CANVAS
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-white sm:text-5xl">
              多资产光场
            </h2>
          </div>
          <div className="grid grid-cols-12 items-end gap-1">
            {markets.flatMap((asset) => asset.trend.slice(-2)).map((value, index) => (
              <span
                key={`${value}-${index}`}
                className="block w-2 bg-acid/70 animate-pulsebar"
                style={{
                  height: `${18 + value * 0.34}px`,
                  animationDelay: `${index * 0.08}s`
                }}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {markets.map((asset, index) => (
            <MarketCard key={asset.id} asset={asset} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
