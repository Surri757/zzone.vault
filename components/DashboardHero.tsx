"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  CandlestickChart,
  Crosshair,
  Radio,
  Radar,
  ShieldCheck,
  Wifi,
  WifiOff
} from "lucide-react";
import { useMemo } from "react";
import type { Asset } from "@/lib/types";
import type { LiveQuote } from "@/lib/live-instruments";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import { className, formatQuoteNumber } from "@/components/shared/util";

function quoteTone(assetId: string, change: number) {
  const chinaMarket = assetId.startsWith("CN:");
  if (change >= 0) return chinaMarket ? "text-dangerline" : "text-acid";
  return chinaMarket ? "text-acid" : "text-dangerline";
}

function quoteToneName(assetId: string, change: number): "acid" | "red" {
  return quoteTone(assetId, change) === "text-dangerline" ? "red" : "acid";
}

function feedLabel(quote: LiveQuote | undefined, loading: boolean) {
  if (loading && !quote) return "同步中";
  if (!quote) return "等待行情";
  if (quote.feedStatus === "LICENSED_REALTIME") return "授权实时";
  if (quote.feedStatus === "LIVE_PUBLIC") return "公开实时";
  if (quote.feedStatus === "MARKET_CLOSED_LAST_TICK") return "休市末笔";
  if (quote.feedStatus === "DELAYED_PUBLIC") return "公开延时";
  return "行情异常";
}

function sessionLabel(quote: LiveQuote | undefined, loading: boolean) {
  if (loading && !quote) return "SESSION SYNC";
  if (!quote) return "SESSION UNKNOWN";
  if (
    quote.feedStatus === "LICENSED_REALTIME" ||
    quote.feedStatus === "LIVE_PUBLIC"
  ) {
    return "SESSION ACTIVE";
  }
  if (quote.feedStatus === "MARKET_CLOSED_LAST_TICK") return "SESSION CLOSED";
  if (quote.feedStatus === "DELAYED_PUBLIC") return "SESSION DELAYED";
  return "FEED ERROR";
}

function formattedTime(value: string | null) {
  if (!value) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function DashboardHero({
  markets,
  focusAssetId,
  onFocusAsset,
  quotes,
  connected,
  loading,
  lastUpdated,
  onOpenStocks
}: {
  markets: Asset[];
  focusAssetId: string;
  onFocusAsset: (id: string) => void;
  quotes: Map<string, LiveQuote>;
  connected: boolean;
  loading: boolean;
  lastUpdated: string | null;
  onOpenStocks: () => void;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const focusAsset = useMemo(
    () => markets.find((asset) => asset.id === focusAssetId) ?? markets[0],
    [focusAssetId, markets]
  );
  const focusQuote = focusAsset ? quotes.get(focusAsset.id) : undefined;
  const change = focusQuote?.changePct ?? 0;
  const price = focusQuote?.price;
  const series = focusQuote?.series?.filter(Number.isFinite) ?? [];
  const currency = focusQuote?.instrument.currency ?? "";

  if (!focusAsset) return null;

  return (
    <section
      id="top"
      className="relative z-10 min-h-[82svh] overflow-hidden px-4 pb-8 pt-[6.75rem] sm:px-6 sm:pb-10 sm:pt-[7.25rem] lg:px-8"
    >
      <div
        aria-hidden="true"
        className="ink-display pointer-events-none absolute right-1 top-24 select-none text-[7rem] leading-none text-white/[0.055] [writing-mode:vertical-rl] sm:right-8 sm:text-[10rem] lg:right-12 lg:text-[13rem]"
      >
        观势
      </div>
      <div
        aria-hidden="true"
        className="ink-seal pointer-events-none absolute right-14 top-[24rem] hidden h-12 w-12 place-items-center text-sm sm:grid lg:right-24 lg:top-[29rem]"
      >
        实盘
      </div>

      <div className="mx-auto grid min-h-[calc(82svh-8rem)] max-w-[1600px] grid-cols-12 content-center gap-x-4 gap-y-8 sm:gap-x-6 lg:gap-x-8">
        <motion.div
          initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0, filter: "blur(10px)" }}
          animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.92, ease: [0.16, 1, 0.3, 1] }}
          className="col-span-12 self-center lg:col-span-7"
        >
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
            <span className={className("flex items-center gap-2", connected ? "text-jade" : "text-cinnabar")}>
              {connected ? (
                <Wifi className="h-4 w-4" aria-hidden="true" />
              ) : (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? "PUBLIC FEED SYNC" : connected ? "PUBLIC FEED READY" : "FEED CHECK"}
            </span>
            <span className="flex items-center gap-2 text-white/58">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              SIMULATION ISOLATED
            </span>
          </div>

          <p className="ink-kicker mb-3 font-mono text-[11px] text-gold">
            OBSIDIAN MARKET OS / LIVE CANVAS
          </p>
          <h1
            aria-label="Zz.one Vault"
            className="ink-display text-[3.65rem] font-semibold leading-[0.78] text-ink sm:text-[6.75rem] lg:text-[8.25rem]"
          >
            <span className="block">Zz.one</span>
            <span className="ink-outline block">Vault</span>
          </h1>

          <div className="mt-7 grid gap-5 border-t border-white/18 pt-5 sm:grid-cols-[0.82fr_1.18fr] sm:items-start">
            <p className="ink-display text-2xl text-jade sm:text-3xl">以静观势，驭数入墨</p>
            <div>
              <p className="max-w-xl text-sm leading-7 text-white/68">
                公开行情持续同步；组合研究与模拟指令独立封存于本机。
              </p>
              <button
                type="button"
                onClick={onOpenStocks}
                className="group mt-5 inline-flex min-h-12 items-center gap-3 rounded-[3px] border border-cinnabar/70 bg-cinnabar px-4 font-mono text-xs font-semibold text-white transition-colors hover:border-ink hover:bg-ink hover:text-carbon-deep"
              >
                <CandlestickChart className="h-4 w-4" aria-hidden="true" />
                进入个股终端
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.article
          initial={{ opacity: 0, x: reduceMotion ? 0 : 26, scale: reduceMotion ? 1 : 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.18, duration: reduceMotion ? 0 : 0.72, ease: [0.16, 1, 0.3, 1] }}
          className="asset-lens ink-panel col-span-12 self-center p-4 sm:p-5 lg:col-span-5"
          aria-label={`当前实时资产 ${focusAsset.symbol}`}
          aria-busy={loading && !focusQuote}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/16 pb-5">
            <div className="min-w-0">
              <p className="ink-kicker flex items-center gap-2 font-mono text-[10px] text-mist">
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                PRIMARY MARKET / 主行情
              </p>
              <h2 className="ink-display mt-3 truncate text-5xl text-ink sm:text-6xl">
                {focusAsset.symbol}
              </h2>
              <p className="mt-1 truncate text-sm text-white/58">{focusAsset.name}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={className("font-mono text-2xl tabular-nums", quoteTone(focusAsset.id, change))}>
                {focusQuote && change >= 0 ? "+" : ""}
                {focusQuote ? `${formatQuoteNumber(change, 2)}%` : "--"}
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums text-white/72">
                {formatQuoteNumber(price, price && price < 100 ? 4 : 2)} {currency}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] text-white/42">
                <Radio className="h-3 w-3" aria-hidden="true" />
                {feedLabel(focusQuote, loading)}
              </p>
            </div>
          </div>

          <div className="relative mt-5 min-h-[6.25rem] border-b border-white/16 pb-5">
            {series.length > 1 ? (
              <MiniSparkline values={series} tone={quoteToneName(focusAsset.id, change)} />
            ) : (
              <div className="grid h-14 place-items-center border-y border-dashed border-white/10 font-mono text-[11px] text-white/42">
                正在同步真实价格序列
              </div>
            )}
            <div className="mt-4 flex items-center justify-between font-mono text-[10px] text-white/42">
              <span>{sessionLabel(focusQuote, loading)}</span>
              <span>REAL TRACE</span>
              <span>{formattedTime(focusQuote?.timestamp ?? null)}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="选择主行情">
            {markets.slice(0, 6).map((asset) => {
              const quote = quotes.get(asset.id);
              const assetChange = quote?.changePct ?? 0;
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onFocusAsset(asset.id)}
                  aria-label={`${asset.name} ${asset.symbol}，涨跌 ${quote ? `${formatQuoteNumber(assetChange, 2)}%` : "等待行情"}`}
                  aria-pressed={focusAssetId === asset.id}
                  className={className(
                    "min-h-16 rounded-[2px] border px-3 py-2.5 text-left transition-colors",
                    focusAssetId === asset.id
                      ? "border-cinnabar/75 bg-cinnabar/10 text-ink"
                      : "border-white/12 bg-white/[0.025] text-white/58 hover:border-jade/55 hover:text-ink"
                  )}
                >
                  <span className="block truncate font-mono text-xs">{asset.symbol}</span>
                  <span className={className("mt-1.5 block font-mono text-[10px] tabular-nums", quoteTone(asset.id, assetChange))}>
                    {quote && assetChange >= 0 ? "+" : ""}
                    {quote ? `${formatQuoteNumber(assetChange, 2)}%` : "SYNC"}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.article>

        <div className="col-span-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/14 pt-4 font-mono text-[10px] text-white/46">
          <span className="flex items-center gap-2">
            <Radar className="h-3.5 w-3.5 text-jade" aria-hidden="true" />
            MARKET FIELD / DATA AS OF {formattedTime(lastUpdated)}
          </span>
          <a href="#markets" className="flex items-center gap-2 transition-colors hover:text-jade">
            市场全景
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
