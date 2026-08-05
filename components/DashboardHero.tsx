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
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";

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

function formattedStamp(value: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function signedPercentForHero(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${formatQuoteNumber(value, 2)}%`;
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
  const rankedAssets = useMemo(
    () =>
      markets
        .map((asset) => ({ asset, quote: quotes.get(asset.id) }))
        .filter(
          (item): item is { asset: Asset; quote: LiveQuote } =>
            typeof item.quote?.changePct === "number" && Number.isFinite(item.quote.changePct)
        )
        .sort((left, right) => (right.quote.changePct ?? 0) - (left.quote.changePct ?? 0)),
    [markets, quotes]
  );
  const attentionAssets = useMemo(
    () =>
      [...rankedAssets]
        .sort(
          (left, right) =>
            Math.abs(right.quote.changePct ?? 0) - Math.abs(left.quote.changePct ?? 0)
        )
        .slice(0, 3),
    [rankedAssets]
  );
  const strongest = rankedAssets[0];
  const weakest = rankedAssets.at(-1);
  const activeSignalCount = rankedAssets.filter(
    (item) => Math.abs(item.quote.changePct ?? 0) >= 2
  ).length;

  if (!focusAsset) return null;

  return (
    <section
      id="top"
      className="relative z-10 min-h-[calc(100svh-4.25rem)] overflow-hidden px-4 pb-6 pt-[5.75rem] sm:px-6 sm:pt-[6.25rem] lg:min-h-0 lg:px-8"
    >
      <div className="mx-auto grid max-w-[1600px] grid-cols-12 content-start gap-x-4 gap-y-4 sm:gap-x-6 lg:gap-x-8">
        <motion.div
          initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0, filter: "blur(10px)" }}
          animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.92, ease: [0.16, 1, 0.3, 1] }}
          className="col-span-12 self-start lg:col-span-7"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-sm">
            <span className={className("flex items-center gap-2", connected ? "text-jade" : "text-cinnabar")}>
              {connected ? (
                <Wifi className="h-4 w-4" aria-hidden="true" />
              ) : (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? "行情同步中" : connected ? "行情连接正常" : "行情待检查"}
            </span>
            <span className="flex items-center gap-2 text-white/58">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              公开行情 / 本地模拟隔离
            </span>
          </div>

          <p className="ink-kicker mt-5 flex items-center gap-2 font-mono text-sm text-gold">
            <Activity className="h-4 w-4" aria-hidden="true" />
            MARKET NOW / 即时决策台
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="ink-display text-4xl font-semibold text-ink sm:text-5xl">此刻市场</h1>
              <p className="mt-2 max-w-2xl text-base leading-7 text-white/62 sm:text-lg">
                先看方向与异常，再进入个股、板块或跨市场对标验证。
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenStocks}
              className="group inline-flex min-h-12 items-center gap-3 rounded-[3px] border border-cinnabar/70 bg-cinnabar px-4 font-mono text-sm font-semibold text-white transition-colors hover:border-ink hover:bg-ink hover:text-carbon-deep"
            >
              <CandlestickChart className="h-5 w-5" aria-hidden="true" />
              个股终端
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 border-y border-white/14 sm:grid-cols-4">
            {[
              ["行情时间", formattedStamp(lastUpdated), "text-white"],
              ["重点领涨", strongest ? strongest.asset.symbol : "--", "text-cinnabar"],
              ["重点领跌", weakest ? weakest.asset.symbol : "--", "text-jade"],
              ["显著异动", `${activeSignalCount} 项`, activeSignalCount > 0 ? "text-gold" : "text-white/58"]
            ].map(([label, value, tone]) => (
              <div key={label} className="min-w-0 border-b border-r border-white/[0.08] px-3 py-3 last:border-r-0 sm:border-b-0">
                <p className="font-mono text-xs text-white/42">{label}</p>
                <p className={className("mt-1 truncate font-mono text-lg font-semibold", tone)} title={value}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 border border-white/12 bg-black/24">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <p className="font-mono text-xs text-acid">NEEDS ATTENTION</p>
                <h2 className="mt-0.5 text-base font-semibold text-white">重点异动</h2>
              </div>
              <span className="font-mono text-xs text-white/38">按绝对涨跌排序</span>
            </div>
            <div className="grid sm:grid-cols-3">
              {attentionAssets.map(({ asset, quote }) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onFocusAsset(asset.id)}
                  className="flex min-h-16 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3 text-left transition hover:bg-white/[0.04] sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white/76">{asset.name}</span>
                    <span className="mt-1 block font-mono text-base text-white">{asset.symbol}</span>
                  </span>
                  <span className={className("shrink-0 font-mono text-lg font-semibold", quoteTone(asset.id, quote.changePct ?? 0))}>
                    {signedPercentForHero(quote.changePct)}
                  </span>
                </button>
              ))}
              {attentionAssets.length === 0 ? (
                <p className="px-4 py-5 text-sm text-white/42">等待重点资产行情</p>
              ) : null}
            </div>
          </div>
        </motion.div>

        <motion.article
          initial={{ opacity: 0, x: reduceMotion ? 0 : 26, scale: reduceMotion ? 1 : 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.18, duration: reduceMotion ? 0 : 0.72, ease: [0.16, 1, 0.3, 1] }}
          className="asset-lens ink-panel col-span-12 self-start p-4 sm:p-5 lg:col-span-5"
          aria-label={`当前实时资产 ${focusAsset.symbol}`}
          aria-busy={loading && !focusQuote}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/16 pb-5">
            <div className="min-w-0">
              <p className="ink-kicker flex items-center gap-2 font-mono text-[10px] text-mist">
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                PRIMARY MARKET / 主行情
              </p>
              <h2 className="ink-display mt-2 truncate text-4xl text-ink sm:text-5xl">
                {focusAsset.symbol}
              </h2>
              <p className="mt-1 truncate text-sm text-white/58">{focusAsset.name}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={className("font-mono text-3xl font-semibold tabular-nums", quoteTone(focusAsset.id, change))}>
                {focusQuote ? (
                  <AnimatedNumber value={change} digits={2} signed suffix="%" />
                ) : (
                  "--"
                )}
              </p>
              <p className="mt-1 font-mono text-xl tabular-nums text-white/82">
                {focusQuote ? (
                  <>
                    <AnimatedNumber value={price} digits={price && price < 100 ? 4 : 2} /> {currency}
                  </>
                ) : (
                  "--"
                )}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] text-white/42">
                <Radio className="h-3 w-3" aria-hidden="true" />
                {feedLabel(focusQuote, loading)}
              </p>
            </div>
          </div>

          <div className="relative mt-5 hidden min-h-[6.25rem] border-b border-white/16 pb-5 sm:block">
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
            MARKET FIELD / DATA AS OF {formattedStamp(lastUpdated)}
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
