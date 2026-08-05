"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  BriefcaseBusiness,
  CandlestickChart,
  FlaskConical,
  GitCompareArrows,
  LayoutGrid,
  Menu,
  Radar,
  ScanLine,
  Send,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { DashboardHero } from "@/components/DashboardHero";
import { TopMovers } from "@/components/charts/TopMovers";
import { MarketPulse } from "@/components/charts/MarketPulse";
import { SectorHeatmap } from "@/components/charts/SectorHeatmap";
import { MarketBreadth } from "@/components/charts/MarketBreadth";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { WatchlistEntry } from "@/hooks/useWatchlist";
import { useQuoteStream } from "@/hooks/useQuoteStream";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { GlobalDataHub } from "@/components/GlobalDataHub";
import { SectorWorkspace } from "@/components/SectorWorkspace";
import { PeerComparisonWorkspace } from "@/components/PeerComparisonWorkspace";
import { PortfolioCore } from "@/components/PortfolioCore";
import { StrategyLab } from "@/components/StrategyLab";
import { CommandLayer } from "@/components/CommandLayer";
import { RecentOrders } from "@/components/RecentOrders";
import { assets, portfolio, strategies } from "@/lib/mock-data";
import type { Asset, AssetClass, SimulatedOrder } from "@/lib/types";
import type { StockMarket } from "@/lib/stock-catalog";
import {
  readWorkspaceUrl,
  subscribeWorkspaceUrl,
  updateWorkspaceUrl
} from "@/lib/workspace-url";

const LightfieldCanvas = dynamic(
  () => import("@/components/LightfieldCanvas").then((module) => module.LightfieldCanvas),
  { ssr: false }
);

type WorkspaceView =
  | "overview"
  | "stocks"
  | "sectors"
  | "peers"
  | "portfolio"
  | "strategies"
  | "trade";

interface WorkspaceNavigationItem {
  id: WorkspaceView;
  label: string;
  detail: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  mode: "LIVE" | "SIM";
}

const workspaceNavigation: WorkspaceNavigationItem[] = [
  { id: "overview", label: "观势", detail: "OVERVIEW", icon: BarChart3, mode: "LIVE" },
  { id: "stocks", label: "个股", detail: "OHLCV", icon: CandlestickChart, mode: "LIVE" },
  { id: "sectors", label: "板块", detail: "STRENGTH", icon: LayoutGrid, mode: "LIVE" },
  { id: "peers", label: "对标", detail: "PEERS", icon: GitCompareArrows, mode: "LIVE" },
  { id: "portfolio", label: "持仓", detail: "PORTFOLIO", icon: BriefcaseBusiness, mode: "SIM" },
  { id: "strategies", label: "策略", detail: "RESEARCH", icon: FlaskConical, mode: "SIM" },
  { id: "trade", label: "指令", detail: "SANDBOX", icon: Send, mode: "SIM" }
];

const featuredInstruments: Array<{
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
}> = [
  { id: "CN:XSHG:600519", symbol: "600519", name: "贵州茅台", assetClass: "equity" },
  { id: "CN:XSHE:300750", symbol: "300750", name: "宁德时代", assetClass: "equity" },
  { id: "CN:XSHE:000001", symbol: "000001", name: "平安银行", assetClass: "equity" },
  { id: "US:XNAS:NVDA", symbol: "NVDA", name: "NVIDIA", assetClass: "equity" },
  { id: "US:XNAS:AAPL", symbol: "AAPL", name: "Apple", assetClass: "equity" },
  { id: "US:XNAS:MSFT", symbol: "MSFT", name: "Microsoft", assetClass: "equity" }
];

const featuredInstrumentIds = featuredInstruments.map((instrument) => instrument.id);

function normalizedTrend(values: number[]) {
  const finite = values.filter(Number.isFinite).slice(-32);
  if (finite.length < 2) return [50, 50];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;
  return finite.map((value) => ((value - min) / range) * 74 + 13);
}

function marketTimeLabel(isoTime: string | null) {
  if (!isoTime) return "等待首笔行情";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(isoTime));
}

export function PrivateTradeConsole() {
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [focusAssetId, setFocusAssetId] = useState(featuredInstruments[0]?.id ?? "");
  const [orders, setOrders] = useState<SimulatedOrder[]>([]);
  const [activeMarket, setActiveMarket] = useState<StockMarket>("CN");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const reduceMotion = Boolean(useReducedMotion());
  const watchlist = useWatchlist();

  const requestedQuoteIds = useMemo(
    () => Array.from(new Set([...featuredInstrumentIds, ...watchlist.watchlistIds])),
    [watchlist.watchlistIds]
  );
  const quoteStream = useQuoteStream({
    ids: requestedQuoteIds,
    market: activeMarket,
    enabled: true
  });

  useEffect(() => {
    function syncFromUrl() {
      const parameters = readWorkspaceUrl();
      const requestedView = parameters.get("view");
      const nextView = workspaceNavigation.some((item) => item.id === requestedView)
        ? (requestedView as WorkspaceView)
        : "overview";
      const nextMarket = parameters.get("market")?.toUpperCase() === "US" ? "US" : "CN";

      setActiveView(nextView);
      setActiveMarket(nextMarket);
      setMobileMenuOpen(false);
    }

    syncFromUrl();
    return subscribeWorkspaceUrl(syncFromUrl);
  }, []);

  const marketAssets = useMemo<Asset[]>(
    () =>
      featuredInstruments.map((instrument) => {
        const quote = quoteStream.quotes.get(instrument.id);
        const price = quote?.price ?? 0;
        const dayRange =
          price > 0 && quote && quote.high !== null && quote.low !== null
            ? Math.abs((quote.high - quote.low) / price)
            : 0;
        const rawChange = quote?.changePct;
        const change =
          typeof rawChange === "number" && Number.isFinite(rawChange) ? rawChange : 0;

        return {
          id: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          assetClass: instrument.assetClass,
          price,
          change24h: change,
          volatility: Math.min(1, Math.max(0.12, dayRange * 18)),
          liquidity: quote?.volume ? 0.86 : 0.42,
          heat: Math.min(1, Math.max(0.28, Math.abs(change) / 5)),
          trend: normalizedTrend(quote?.series ?? [])
        };
      }),
    [quoteStream.quotes]
  );

  useEffect(() => {
    if (!mobileMenuOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileMenuOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView]);

  function selectView(view: WorkspaceView) {
    setActiveView(view);
    setMobileMenuOpen(false);
    updateWorkspaceUrl({ view: view === "overview" ? null : view });
  }

  function changeOverviewMarket(market: StockMarket) {
    setActiveMarket(market);
    updateWorkspaceUrl({ market });
  }

  function openWatchlistEntry(entry: WatchlistEntry) {
    const [rawMarket, rawExchange] = entry.id.split(":");
    const nextMarket: StockMarket = rawMarket === "US" ? "US" : "CN";

    setActiveView("stocks");
    setActiveMarket(nextMarket);
    updateWorkspaceUrl({
      view: "stocks",
      market: nextMarket,
      exchange: rawExchange || null,
      q: entry.symbol,
      page: null,
      stock: entry.id,
      panel: "chart"
    });
  }

  const activeNavigation =
    workspaceNavigation.find((item) => item.id === activeView) ?? workspaceNavigation[0];
  const simulationAsset = assets[0];
  const rootFeedActive = activeView === "overview";
  const rootFeedError = rootFeedActive ? quoteStream.error : null;
  const rootFeedLabel = !rootFeedActive
    ? activeNavigation.mode === "LIVE"
      ? "按需行情"
      : "本地模拟"
    : quoteStream.loading
      ? "行情同步"
      : rootFeedError
        ? "行情异常"
        : quoteStream.connected
          ? "公开行情"
          : "等待行情";

  return (
    <MotionConfig reducedMotion="user">
      <main className="ink-interface noise-field scanline relative min-h-screen overflow-hidden bg-carbon text-ink">
      <LightfieldCanvas
        assets={marketAssets}
        interactive={activeView === "overview"}
        onAssetSelect={setFocusAssetId}
        highlightedIds={[focusAssetId]}
        liveQuotes={quoteStream.quotes}
      />

      <div className="relative z-10 min-h-screen">
        <header className="vault-header fixed inset-x-0 top-0 z-50 border-b border-white/10 px-4 sm:px-6 lg:px-8">
          <nav
            className="relative mx-auto flex h-[4.25rem] max-w-[1600px] items-center justify-between gap-4"
            aria-label="主导航"
          >
            <button
              type="button"
              onClick={() => selectView("overview")}
              className="group flex min-w-0 items-center gap-3 text-left"
              aria-label="打开 Zz.one Vault 市场总览"
            >
              <span className="ink-brand-mark grid h-9 w-9 shrink-0 place-items-center text-carbon transition-transform duration-300 group-hover:rotate-3">
                <Radar className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="ink-display block truncate text-base leading-none text-ink">
                  Zz.one Vault
                </span>
                <span className="mt-1 block font-mono text-[10px] leading-tight text-white/52">
                  夜宣量化仓
                </span>
              </span>
            </button>

            <div className="hidden h-full items-stretch lg:flex" role="list">
              {workspaceNavigation.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex min-w-[5.25rem] items-center justify-center gap-2 px-3 transition-colors ${
                      active ? "text-ink" : "text-white/54 hover:text-ink"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${active ? "text-cinnabar" : "text-white/38 group-hover:text-jade"}`}
                      aria-hidden={true}
                    />
                    <span>
                      <span className="block text-[13px] leading-none">{item.label}</span>
                      <span className="mt-1.5 block font-mono text-[9px] leading-none text-white/36">
                        {item.detail}
                      </span>
                    </span>
                    <span
                      className={`absolute inset-x-3 bottom-0 h-px bg-cinnabar transition-transform duration-300 ${
                        active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="hidden items-center gap-3 xl:flex">
              <div className="border-l border-white/12 pl-3 text-right">
                <div
                  className={`flex items-center justify-end gap-2 font-mono text-[10px] ${
                    rootFeedError
                      ? "text-dangerline"
                      : rootFeedActive && quoteStream.connected
                        ? "text-jade"
                        : "text-white/52"
                  }`}
                  role="status"
                  aria-live="polite"
                  title={rootFeedError ?? undefined}
                >
                  {rootFeedActive && quoteStream.connected && !rootFeedError ? (
                    <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {rootFeedLabel}
                </div>
                <div className="mt-1 font-mono text-[9px] text-white/38">
                  {rootFeedActive
                    ? `AS OF ${marketTimeLabel(quoteStream.lastUpdated)}`
                    : activeNavigation.mode === "LIVE"
                      ? "ON-DEMAND WORKSPACE"
                      : "LOCAL SIMULATION"}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] border border-white/14 text-white/76 transition-colors hover:border-jade/60 hover:text-jade lg:hidden"
              aria-label={mobileMenuOpen ? "关闭导航" : "打开导航"}
              aria-controls="vault-mobile-navigation"
              aria-expanded={mobileMenuOpen}
              title={mobileMenuOpen ? "关闭导航" : "打开导航"}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>

            <AnimatePresence>
              {mobileMenuOpen ? (
                <motion.div
                  id="vault-mobile-navigation"
                  initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="ink-mobile-menu absolute inset-x-[-1rem] top-full px-4 pb-5 pt-3 sm:inset-x-[-1.5rem] sm:px-6 lg:hidden"
                >
                  <div className="grid divide-y divide-white/10">
                    {workspaceNavigation.map((item, index) => {
                      const Icon = item.icon;
                      const active = activeView === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectView(item.id)}
                          aria-current={active ? "page" : undefined}
                          className="flex min-h-14 items-center justify-between py-3 text-left text-ink transition-colors hover:text-jade"
                        >
                          <span className="flex items-center gap-3">
                            <span className="font-mono text-[10px] text-cinnabar">0{index + 1}</span>
                            <Icon className="h-4 w-4 text-jade" aria-hidden={true} />
                            <span className="ink-display text-xl">{item.label}</span>
                          </span>
                          <span className="font-mono text-[10px] text-white/42">{item.detail}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 font-mono text-[10px] text-white/48">
                    <span>{activeNavigation.mode === "LIVE" ? "PUBLIC DATA" : "LOCAL ONLY"}</span>
                    <span
                      className={
                        rootFeedError
                          ? "text-dangerline"
                          : rootFeedActive && quoteStream.connected
                            ? "text-jade"
                            : "text-white/48"
                      }
                    >
                      {!rootFeedActive
                        ? activeNavigation.mode === "LIVE"
                          ? "ON DEMAND"
                          : "LOCAL ONLY"
                        : rootFeedError
                          ? "FEED ERROR"
                          : quoteStream.connected
                            ? "FEED READY"
                            : "FEED CHECK"}
                    </span>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </nav>
        </header>

        {rootFeedError ? (
          <div
            className="fixed inset-x-0 top-[4.25rem] z-40 border-b border-dangerline/30 bg-carbon/95 px-4 py-2 text-dangerline backdrop-blur-md sm:px-6 lg:px-8"
            role="status"
            aria-live="polite"
          >
            <div className="mx-auto flex max-w-[1600px] items-center gap-2 font-mono text-[11px]">
              <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="shrink-0">公开行情连接异常</span>
              <span className="min-w-0 truncate text-white/58" title={rootFeedError}>
                {rootFeedError}
              </span>
            </div>
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {activeView === "overview" ? (
              <>
                <ErrorBoundary section="市场总览">
                  <DashboardHero
                    markets={marketAssets}
                    focusAssetId={focusAssetId}
                    onFocusAsset={setFocusAssetId}
                    quotes={quoteStream.quotes}
                    connected={quoteStream.connected}
                    loading={quoteStream.loading}
                    lastUpdated={quoteStream.lastUpdated}
                    onOpenStocks={() => selectView("stocks")}
                  />
                </ErrorBoundary>

                <section
                  id="markets"
                  className="ink-section relative z-10 px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
                >
                  <div className="mx-auto max-w-[1600px]">
                    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="ink-kicker flex items-center gap-2 text-xs text-mist">
                          <ScanLine className="h-4 w-4" aria-hidden="true" />
                          PANORAMIC TAPE / 全域切片
                        </p>
                        <h2 className="ink-display mt-2 text-3xl text-ink sm:text-5xl">
                          市场<span className="ink-outline ml-2">全景</span>
                        </h2>
                      </div>
                      <div
                        className="ink-status-rail grid w-full grid-cols-2 border border-white/12 p-1 sm:w-auto"
                        role="group"
                        aria-label="选择市场范围"
                      >
                        {(["CN", "US"] as const).map((market) => (
                          <button
                            key={market}
                            type="button"
                            onClick={() => changeOverviewMarket(market)}
                            aria-pressed={activeMarket === market}
                            className={`min-h-11 rounded-[2px] px-5 font-mono text-[11px] transition-colors ${
                              activeMarket === market
                                ? "bg-jade text-carbon-deep"
                                : "text-white/58 hover:bg-white/[0.04] hover:text-ink"
                            }`}
                          >
                            {market === "CN" ? "中国 A 股" : "US 美股"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.28fr)_minmax(20rem,0.72fr)]">
                      <TopMovers market={activeMarket} />
                      <div className="grid content-start gap-4">
                        <MarketPulse market={activeMarket} />
                        <SectorHeatmap market={activeMarket} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <MarketBreadth market={activeMarket} />
                    </div>
                    <div className="mt-4">
                      <WatchlistPanel
                        entries={watchlist.entries}
                        onRemove={watchlist.remove}
                        onSelect={openWatchlistEntry}
                        alerts={watchlist.alerts}
                        onClearAlert={watchlist.clearTriggered}
                        quotes={quoteStream.quotes}
                        onOpenCatalog={() => selectView("stocks")}
                      />
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeView === "stocks" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="个股行情工作区">
                  <GlobalDataHub
                    workspace
                    watchlistIds={watchlist.watchlistIds}
                    onWatchlistAdd={watchlist.add}
                    onWatchlistRemove={watchlist.remove}
                  />
                </ErrorBoundary>
              </div>
            ) : null}

            {activeView === "sectors" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="板块强弱工作区">
                  <SectorWorkspace />
                </ErrorBoundary>
              </div>
            ) : null}

            {activeView === "peers" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="跨市场对标工作区">
                  <PeerComparisonWorkspace />
                </ErrorBoundary>
              </div>
            ) : null}

            {activeView === "portfolio" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="组合核心">
                  <PortfolioCore snapshot={portfolio} />
                </ErrorBoundary>
              </div>
            ) : null}

            {activeView === "strategies" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="策略实验室">
                  <StrategyLab signals={strategies} selectedAsset={simulationAsset} />
                </ErrorBoundary>
              </div>
            ) : null}

            {activeView === "trade" ? (
              <div className="workspace-view pt-[4.25rem]">
                <ErrorBoundary section="指令层">
                  <CommandLayer
                    markets={assets}
                    onOrderCreated={(order) =>
                      setOrders((current) => [order, ...current].slice(0, 8))
                    }
                  />
                </ErrorBoundary>
                <ErrorBoundary section="订单历史">
                  <RecentOrders orders={orders} />
                </ErrorBoundary>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
      </main>
    </MotionConfig>
  );
}
