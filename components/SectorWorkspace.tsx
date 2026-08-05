"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  Clock3,
  DatabaseZap,
  Gauge,
  LayoutGrid,
  LoaderCircle,
  RefreshCw,
  Scale,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { SkeletonPanel } from "@/components/shared/Skeleton";
import { asyncErrorMessage } from "@/components/shared/AsyncPanel";
import { className, formatCompact, formatQuoteNumber } from "@/components/shared/util";
import { marketColorPalette } from "@/lib/market-colors";
import type { StockMarket } from "@/lib/stock-catalog";
import {
  readWorkspaceUrl,
  subscribeWorkspaceUrl,
  updateWorkspaceUrl,
} from "@/lib/workspace-url";

type FeedStatus =
  | "LIVE_PUBLIC"
  | "DELAYED_PUBLIC"
  | "MARKET_CLOSED_LAST_TICK";

interface SectorStrengthComponent {
  rawValue: number;
  percentileScore: number;
  coefficient: number;
}

interface SectorStrengthConstituent {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  price: number | null;
  changePct: number;
  weight: number;
  contribution: number;
  marketCap: number | null;
  turnover: number | null;
}

interface SectorStrengthAggregate {
  sector: string;
  rank: number;
  score: number;
  stockCount: number;
  advancing: number;
  declining: number;
  unchanged: number;
  totalMarketCap: number;
  totalTurnover: number;
  marketCapCoverage: number;
  turnoverCoverage: number;
  weightedChangePct: number;
  breadthRatio: number;
  turnoverWeightedDirection: number;
  components: {
    priceMomentum: SectorStrengthComponent;
    breadth: SectorStrengthComponent;
    turnoverDirection: SectorStrengthComponent;
  };
  topConstituents: SectorStrengthConstituent[];
}

interface SectorStrengthResponse {
  market: StockMarket;
  generatedAt: string;
  dataAsOf: string;
  sourceLabel: string;
  feedStatus: FeedStatus;
  providerMessage: string;
  catalogTotal: number;
  providerTotal: number;
  totalWithQuotes: number;
  coverageRatio: number;
  coverageLevel: "FULL" | "PARTIAL";
  stale: boolean;
  rankedSectorCount: number;
  unclassifiedStockCount: number;
  sectors: SectorStrengthAggregate[];
}

type MobilePanel = "ranking" | "details";

const mobilePanels: Array<{
  id: MobilePanel;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "ranking", label: "排行", icon: BarChart3 },
  { id: "details", label: "详情", icon: Gauge },
];

const feedStatusLabels: Record<FeedStatus, string> = {
  LIVE_PUBLIC: "PUBLIC LIVE",
  DELAYED_PUBLIC: "PUBLIC DELAYED",
  MARKET_CLOSED_LAST_TICK: "LAST TICK",
};

const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function signedPercent(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function ratioPercent(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function marketValue(value: number | null | undefined, market: StockMarket) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${market === "CN" ? "¥" : "$"}${compactNumber.format(value)}`;
}

function marketPrice(value: number | null | undefined, market: StockMarket) {
  const formatted = formatQuoteNumber(value, 2);
  return formatted === "--" ? formatted : `${market === "CN" ? "¥" : "$"}${formatted}`;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "--:--:--";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "--:--:--";
  return timestamp.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function scoreLabel(score: number) {
  if (score >= 60) return "强势";
  if (score >= 20) return "偏强";
  if (score > -20) return "中性";
  if (score > -60) return "偏弱";
  return "弱势";
}

function isSectorStrengthResponse(value: unknown): value is SectorStrengthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { sectors?: unknown }).sectors)
  );
}

function StrengthBar({
  value,
  market,
  label,
}: {
  value: number;
  market: StockMarket;
  label: string;
}) {
  const score = clamp(value, -100, 100);
  const width = Math.abs(score) / 2;
  const palette = marketColorPalette(market);

  return (
    <div
      className="relative h-1.5 overflow-hidden bg-white/[0.07]"
      role="meter"
      aria-label={label}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(score)}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-white/22" aria-hidden="true" />
      <span
        className={className(
          "absolute inset-y-0",
          score >= 0 ? palette.riseBackground : palette.fallBackground
        )}
        style={
          score >= 0
            ? { left: "50%", width: `${width}%` }
            : { right: "50%", width: `${width}%` }
        }
        aria-hidden="true"
      />
    </div>
  );
}

function FactorRow({
  component,
  label,
  rawValue,
  market,
}: {
  component: SectorStrengthComponent;
  label: string;
  rawValue: string;
  market: StockMarket;
}) {
  const palette = marketColorPalette(market);
  const score = clamp(component.percentileScore, -100, 100);

  return (
    <div className="border-b border-white/[0.07] py-3 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem] items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-white/72">{label}</p>
          <p className="mt-0.5 font-mono text-[10px] text-white/38">
            WEIGHT {(component.coefficient * 100).toFixed(0)}%
          </p>
        </div>
        <span className="text-right font-mono text-xs text-white/58">{rawValue}</span>
        <span
          className={className(
            "text-right font-mono text-sm",
            score === 0 ? "text-white/68" : score > 0 ? palette.riseText : palette.fallText
          )}
        >
          {score > 0 ? "+" : ""}
          {score.toFixed(0)}
        </span>
      </div>
      <div className="mt-2">
        <StrengthBar value={score} market={market} label={`${label}百分位得分`} />
      </div>
    </div>
  );
}

export function SectorWorkspace() {
  const [market, setMarket] = useState<StockMarket>("CN");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [data, setData] = useState<SectorStrengthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectorName, setSelectedSectorName] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("ranking");
  const controllerRef = useRef<AbortController | null>(null);
  const mobileTabsId = useId();
  const mobileTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function syncFromUrl() {
      const parameters = readWorkspaceUrl();
      setMarket(parameters.get("market")?.toUpperCase() === "US" ? "US" : "CN");
      setSelectedSectorName(parameters.get("sector"));
      setUrlStateReady(true);
    }

    syncFromUrl();
    return subscribeWorkspaceUrl(syncFromUrl);
  }, []);

  const fetchSectors = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/live/sectors?market=${market}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const responseMessage =
          typeof payload === "object" &&
          payload !== null &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `HTTP ${response.status}`;
        throw new Error(responseMessage);
      }

      if (!isSectorStrengthResponse(payload)) {
        throw new Error("板块数据格式异常");
      }

      setData(payload);
      setSelectedSectorName((current) =>
        current && payload.sectors.some((sector) => sector.sector === current)
          ? current
          : (payload.sectors[0]?.sector ?? null)
      );
    } catch (fetchError) {
      if (controller.signal.aborted) return;
      setError(asyncErrorMessage(fetchError));
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    if (!urlStateReady) return;

    setData(null);
    setError(null);
    setMobilePanel("ranking");
    void fetchSectors();

    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchSectors();
    }, 60_000);

    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [fetchSectors, urlStateReady]);

  const sectors = data?.sectors ?? [];
  const selectedSector = useMemo(
    () =>
      sectors.find((sector) => sector.sector === selectedSectorName) ?? sectors[0] ?? null,
    [sectors, selectedSectorName]
  );
  const palette = marketColorPalette(market);
  const leadingSector = sectors[0] ?? null;
  const trailingSector = sectors[sectors.length - 1] ?? null;
  const breadthTotals = useMemo(
    () =>
      sectors.reduce(
        (totals, sector) => ({
          advancing: totals.advancing + sector.advancing,
          declining: totals.declining + sector.declining,
          unchanged: totals.unchanged + sector.unchanged,
        }),
        { advancing: 0, declining: 0, unchanged: 0 }
      ),
    [sectors]
  );
  const breadthStockTotal =
    breadthTotals.advancing + breadthTotals.declining + breadthTotals.unchanged;
  const overallBreadth =
    breadthStockTotal > 0
      ? (breadthTotals.advancing - breadthTotals.declining) / breadthStockTotal
      : 0;
  const initialLoading = !urlStateReady || (loading && !data);
  const statusText = loading
    ? "SYNCING"
    : error
      ? data
        ? "STALE SNAPSHOT"
        : "FEED ERROR"
      : data
        ? feedStatusLabels[data.feedStatus]
        : "WAITING";
  const metrics: Array<{
    label: string;
    value: string;
    tone: string;
    icon: LucideIcon;
  }> = [
    {
      label: "RANKED SECTORS",
      value: data ? data.rankedSectorCount.toLocaleString() : "--",
      tone: "text-cyanline",
      icon: LayoutGrid,
    },
    {
      label: "QUOTE COVERAGE",
      value: data ? ratioPercent(clamp(data.coverageRatio, 0, 1), 1) : "--",
      tone: data?.coverageLevel === "FULL" ? "text-acid" : "text-amberline",
      icon: DatabaseZap,
    },
    {
      label: "LEADING SECTOR",
      value: leadingSector
        ? `${leadingSector.sector} ${leadingSector.score > 0 ? "+" : ""}${leadingSector.score.toFixed(0)}`
        : "--",
      tone: palette.riseText,
      icon: Activity,
    },
    {
      label: "MARKET BREADTH",
      value: data ? ratioPercent(overallBreadth, 1) : "--",
      tone:
        overallBreadth === 0
          ? "text-white/68"
          : overallBreadth > 0
            ? palette.riseText
            : palette.fallText,
      icon: UsersRound,
    },
  ];

  function changeMarket(nextMarket: StockMarket) {
    if (nextMarket === market) return;
    setMarket(nextMarket);
    setSelectedSectorName(null);
    updateWorkspaceUrl({ market: nextMarket, sector: null });
  }

  function selectSector(sector: SectorStrengthAggregate) {
    setSelectedSectorName(sector.sector);
    setMobilePanel("details");
    updateWorkspaceUrl({ sector: sector.sector }, "replace");
  }

  function openConstituent(constituent: SectorStrengthConstituent) {
    updateWorkspaceUrl({
      view: "stocks",
      market,
      exchange: constituent.exchange,
      q: constituent.symbol,
      page: null,
      stock: constituent.id,
      panel: "chart",
      sector: null,
    });
  }

  function handleMobileTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + mobilePanels.length) % mobilePanels.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % mobilePanels.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = mobilePanels.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    setMobilePanel(mobilePanels[nextIndex].id);
    window.requestAnimationFrame(() => mobileTabRefs.current[nextIndex]?.focus());
  }

  return (
    <section id="sector-strength" className="ink-section relative z-10 px-3 py-4 sm:px-4 lg:px-5">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ink-kicker flex items-center gap-2 text-xs text-acid">
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              SECTOR FIELD / STRENGTH
            </p>
            <h2 className="mt-2 font-serif text-xl font-semibold text-white sm:text-2xl">
              板块强弱工作区
            </h2>
          </div>

          <div className="grid w-full grid-cols-[minmax(10rem,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <div
              className="grid min-w-0 grid-cols-2 border border-white/10 bg-black/6 p-1"
              role="group"
              aria-label="选择板块市场"
            >
              {(["CN", "US"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeMarket(option)}
                  aria-pressed={market === option}
                  className={className(
                    "min-h-9 min-w-0 px-2 font-mono text-[11px] transition-colors sm:min-w-20 sm:px-3",
                    market === option
                      ? "bg-paper text-carbon-deep"
                      : "text-white/52 hover:bg-white/[0.045] hover:text-white"
                  )}
                >
                  {option === "CN" ? "中国 A 股" : "US 美股"}
                </button>
              ))}
            </div>

            <div
              className="inline-flex min-h-11 min-w-0 items-center gap-2 border border-white/10 bg-white/[0.035] px-2 font-mono text-[10px] text-white/52 sm:max-w-56 sm:px-3"
              role="status"
              aria-live="polite"
              title={data?.sourceLabel}
            >
              {loading ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-amberline" aria-hidden="true" />
              ) : error ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-dangerline" aria-hidden="true" />
              ) : (
                <Clock3 className="h-3.5 w-3.5 shrink-0 text-acid" aria-hidden="true" />
              )}
              <span className="truncate">
                {statusText} / {timeLabel(data?.dataAsOf)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void fetchSectors()}
              disabled={loading || !urlStateReady}
              className="grid h-11 w-11 place-items-center rounded-[6px] border border-white/10 bg-white/[0.035] text-white/62 transition hover:border-acid/50 hover:text-acid disabled:cursor-wait disabled:opacity-50"
              aria-label="刷新板块强弱数据"
              title="刷新板块强弱数据"
            >
              <RefreshCw className={className("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 border-y border-white/10 sm:grid-cols-4">
          {metrics.map(({ icon: Icon, label, value, tone }, index) => (
            <div
              key={label}
              className={className(
                "min-w-0 border-b border-r border-white/[0.07] px-3 py-2 sm:border-b-0",
                index % 2 === 1 && "border-r-0 sm:border-r",
                index === metrics.length - 1 && "sm:border-r-0"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-white/46">{label}</span>
                <Icon className={className("h-3.5 w-3.5 shrink-0", tone)} aria-hidden="true" />
              </div>
              <p className={className("mt-1 truncate font-mono text-sm", tone)} title={value}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {data?.stale ? (
          <div className="mt-3 flex items-start gap-2 border border-amberline/35 bg-amberline/[0.08] px-3 py-2 text-xs text-amberline" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{data.providerMessage || "当前展示最近一次可用的板块快照"}</span>
          </div>
        ) : null}

        {error && data ? (
          <div className="mt-3 flex items-center justify-between gap-3 border border-dangerline/35 bg-dangerline/[0.08] px-3 py-2 text-xs text-dangerline" role="status">
            <span className="min-w-0 truncate">更新失败，继续显示上次快照 / {error}</span>
            <button
              type="button"
              onClick={() => void fetchSectors()}
              disabled={loading}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-dangerline/35 transition hover:bg-dangerline/10 disabled:opacity-50"
              aria-label="重试板块数据"
              title="重试板块数据"
            >
              <RefreshCw className={className("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div
          className="mt-3 grid grid-cols-2 border border-white/10 bg-black/6 p-1 lg:hidden"
          role="tablist"
          aria-label="板块工作区视图"
        >
          {mobilePanels.map((panel, index) => {
            const Icon = panel.icon;
            const selected = mobilePanel === panel.id;
            return (
              <button
                key={panel.id}
                ref={(node) => {
                  mobileTabRefs.current[index] = node;
                }}
                id={`${mobileTabsId}-${panel.id}-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${mobileTabsId}-${panel.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setMobilePanel(panel.id)}
                onKeyDown={(event) => handleMobileTabKeyDown(event, index)}
                className={className(
                  "inline-flex h-10 items-center justify-center gap-2 border-r border-white/[0.07] px-2 font-mono text-xs transition last:border-r-0",
                  selected
                    ? "bg-paper text-carbon-deep"
                    : "text-white/52 hover:bg-white/[0.045] hover:text-white"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {panel.label}
              </button>
            );
          })}
        </div>

        {initialLoading ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        ) : error && !data ? (
          <div className="ink-panel mt-3 grid min-h-[28rem] place-items-center rounded-[8px] p-6 text-center">
            <div className="max-w-md">
              <AlertTriangle className="mx-auto h-6 w-6 text-dangerline" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold text-white">板块行情暂不可用</h3>
              <p className="mt-2 break-words text-sm leading-6 text-white/52">{error}</p>
              <button
                type="button"
                onClick={() => void fetchSectors()}
                disabled={loading}
                className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-[6px] border border-dangerline/45 bg-dangerline/[0.08] px-4 font-mono text-xs text-dangerline transition hover:bg-dangerline/[0.14] disabled:opacity-50"
              >
                <RefreshCw className={className("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
                重试
              </button>
            </div>
          </div>
        ) : data && sectors.length === 0 ? (
          <div className="ink-panel mt-3 grid min-h-[28rem] place-items-center rounded-[8px] p-6 text-center">
            <div>
              <LayoutGrid className="mx-auto h-6 w-6 text-white/42" aria-hidden="true" />
              <p className="mt-3 text-sm text-white/52">当前市场暂无可排名板块</p>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
            <section
              id={`${mobileTabsId}-ranking-panel`}
              role="tabpanel"
              aria-labelledby={`${mobileTabsId}-ranking-tab`}
              tabIndex={0}
              className={className(
                "ink-panel min-w-0 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
                mobilePanel === "ranking" ? "block" : "hidden lg:block"
              )}
            >
              <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <BarChart3 className="h-4 w-4 shrink-0 text-acid" aria-hidden="true" />
                  <h3 className="truncate text-sm font-medium text-white/78">综合强弱排行</h3>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-white/38">
                  {data?.rankedSectorCount ?? 0} SECTORS
                </span>
              </header>

              <div className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] gap-2 border-b border-white/[0.07] px-3 py-2 font-mono text-[10px] text-white/38 sm:grid-cols-[2.25rem_minmax(0,1fr)_5rem_4.5rem]">
                <span>#</span>
                <span>板块</span>
                <span className="hidden text-right sm:block">加权涨跌</span>
                <span className="text-right">综合分</span>
              </div>

              <div className="max-h-[calc(100svh-20rem)] min-h-[26rem] overflow-y-auto thin-scrollbar">
                {sectors.map((sector) => {
                  const selected = selectedSector?.sector === sector.sector;
                  const changeTone =
                    sector.weightedChangePct === 0
                      ? "text-white/58"
                      : sector.weightedChangePct > 0
                        ? palette.riseText
                        : palette.fallText;
                  const scoreTone =
                    sector.score === 0
                      ? "text-white/68"
                      : sector.score > 0
                        ? palette.riseText
                        : palette.fallText;

                  return (
                    <button
                      key={sector.sector}
                      type="button"
                      onClick={() => selectSector(sector)}
                      aria-pressed={selected}
                      className={className(
                        "grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-2 border-b border-white/[0.065] px-3 py-2 text-left transition last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_5rem_4.5rem]",
                        selected
                          ? "bg-white/[0.075] shadow-[inset_2px_0_0_#7fb7a3]"
                          : "hover:bg-white/[0.035]"
                      )}
                    >
                      <span className="font-mono text-xs text-white/38">
                        {String(sector.rank).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-white/82" title={sector.sector}>
                          {sector.sector}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-white/38">
                          {sector.advancing}↑ {sector.declining}↓ / {sector.stockCount} 只
                        </span>
                        <span className="mt-1.5 block">
                          <StrengthBar
                            value={sector.score}
                            market={market}
                            label={`${sector.sector}综合强弱分`}
                          />
                        </span>
                      </span>
                      <span className={className("hidden text-right font-mono text-xs sm:block", changeTone)}>
                        {signedPercent(sector.weightedChangePct)}
                      </span>
                      <span className={className("text-right font-mono text-sm", scoreTone)}>
                        {sector.score > 0 ? "+" : ""}
                        {sector.score.toFixed(0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              id={`${mobileTabsId}-details-panel`}
              role="tabpanel"
              aria-labelledby={`${mobileTabsId}-details-tab`}
              tabIndex={0}
              className={className(
                "ink-panel min-w-0 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
                mobilePanel === "details" ? "block" : "hidden lg:block"
              )}
            >
              {selectedSector ? (
                <>
                  <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-cyanline" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-white" title={selectedSector.sector}>
                          {selectedSector.sector}
                        </h3>
                        <p className="mt-0.5 font-mono text-[10px] text-white/38">
                          RANK {selectedSector.rank} / {scoreLabel(selectedSector.score)}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-white/38">
                      {data?.sourceLabel ?? "PUBLIC FEED"}
                    </span>
                  </header>

                  <div className="grid grid-cols-3 border-b border-white/[0.08]">
                    {[
                      ["综合分", `${selectedSector.score > 0 ? "+" : ""}${selectedSector.score.toFixed(1)}`],
                      ["加权涨跌", signedPercent(selectedSector.weightedChangePct)],
                      ["覆盖股票", `${selectedSector.stockCount} 只`],
                    ].map(([label, value], index) => (
                      <div key={label} className="min-w-0 border-r border-white/[0.07] px-3 py-3 last:border-r-0">
                        <p className="truncate font-mono text-[10px] text-white/38">{label}</p>
                        <p
                          className={className(
                            "mt-1 truncate font-mono text-base",
                            index === 0
                              ? selectedSector.score >= 0
                                ? palette.riseText
                                : palette.fallText
                              : index === 1
                                ? selectedSector.weightedChangePct >= 0
                                  ? palette.riseText
                                  : palette.fallText
                                : "text-white/78"
                          )}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-0 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                    <div className="border-b border-white/[0.08] p-4 xl:border-b-0 xl:border-r">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Scale className="h-4 w-4 text-amberline" aria-hidden="true" />
                          <h4 className="text-sm text-white/72">评分构成</h4>
                        </div>
                        <span className="font-mono text-[10px] text-white/38">PERCENTILE / -100—100</span>
                      </div>
                      <div className="mt-2">
                        <FactorRow
                          label="价格动量"
                          component={selectedSector.components.priceMomentum}
                          rawValue={signedPercent(selectedSector.components.priceMomentum.rawValue)}
                          market={market}
                        />
                        <FactorRow
                          label="涨跌广度"
                          component={selectedSector.components.breadth}
                          rawValue={ratioPercent(selectedSector.components.breadth.rawValue, 1)}
                          market={market}
                        />
                        <FactorRow
                          label="成交额方向"
                          component={selectedSector.components.turnoverDirection}
                          rawValue={ratioPercent(selectedSector.components.turnoverDirection.rawValue, 1)}
                          market={market}
                        />
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-2">
                        <UsersRound className="h-4 w-4 text-acid" aria-hidden="true" />
                        <h4 className="text-sm text-white/72">内部广度与规模</h4>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 border-y border-white/[0.08]">
                        {[
                          ["上涨", selectedSector.advancing.toLocaleString(), palette.riseText],
                          ["下跌", selectedSector.declining.toLocaleString(), palette.fallText],
                          ["平盘", selectedSector.unchanged.toLocaleString(), "text-white/62"],
                        ].map(([label, value, tone]) => (
                          <div key={label} className="border-r border-white/[0.07] px-2 py-3 text-center last:border-r-0">
                            <dt className="font-mono text-[10px] text-white/38">{label}</dt>
                            <dd className={className("mt-1 font-mono text-base", tone)}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                        {[
                          ["总市值", marketValue(selectedSector.totalMarketCap, market)],
                          ["总成交额", marketValue(selectedSector.totalTurnover, market)],
                          ["市值覆盖", ratioPercent(selectedSector.marketCapCoverage, 0)],
                          ["成交额覆盖", ratioPercent(selectedSector.turnoverCoverage, 0)],
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0 border-b border-white/[0.07] pb-2">
                            <dt className="font-mono text-[10px] text-white/38">{label}</dt>
                            <dd className="mt-1 truncate font-mono text-sm text-white/72" title={value}>
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>

                  <div className="border-t border-white/[0.08]">
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-cinnabar" aria-hidden="true" />
                        <h4 className="text-sm text-white/72">主要成分股</h4>
                      </div>
                      <span className="font-mono text-[10px] text-white/38">
                        TOP {selectedSector.topConstituents.length}
                      </span>
                    </div>

                    {selectedSector.topConstituents.length === 0 ? (
                      <p className="border-t border-white/[0.07] px-4 py-8 text-center text-sm text-white/42">
                        暂无成分股明细
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4rem_2rem] gap-2 border-y border-white/[0.07] px-4 py-2 font-mono text-[10px] text-white/38 sm:grid-cols-[minmax(0,1fr)_5rem_4.5rem_4.5rem_2rem]">
                          <span>股票</span>
                          <span className="hidden text-right sm:block">价格</span>
                          <span className="text-right">涨跌</span>
                          <span className="text-right">权重</span>
                          <span aria-hidden="true" />
                        </div>
                        <div>
                          {selectedSector.topConstituents.map((constituent) => {
                            const changeTone =
                              constituent.changePct === 0
                                ? "text-white/58"
                                : constituent.changePct > 0
                                  ? palette.riseText
                                  : palette.fallText;
                            return (
                              <button
                                key={constituent.id}
                                type="button"
                                onClick={() => openConstituent(constituent)}
                                className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_4.5rem_4rem_2rem] items-center gap-2 border-b border-white/[0.065] px-4 py-2 text-left transition last:border-b-0 hover:bg-white/[0.035] sm:grid-cols-[minmax(0,1fr)_5rem_4.5rem_4.5rem_2rem]"
                                aria-label={`打开 ${constituent.name} ${constituent.symbol} 个股行情`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-mono text-sm text-white/82">
                                    {constituent.symbol}
                                  </span>
                                  <span className="mt-0.5 block truncate text-xs text-white/42" title={constituent.name}>
                                    {constituent.name}
                                  </span>
                                </span>
                                <span className="hidden text-right font-mono text-xs text-white/62 sm:block">
                                  {marketPrice(constituent.price, market)}
                                </span>
                                <span className={className("text-right font-mono text-xs", changeTone)}>
                                  {signedPercent(constituent.changePct)}
                                </span>
                                <span className="text-right font-mono text-xs text-white/58">
                                  {ratioPercent(constituent.weight, 1)}
                                </span>
                                <ArrowUpRight className="h-3.5 w-3.5 justify-self-end text-white/30" aria-hidden="true" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 font-mono text-[10px] text-white/36">
                    <span>
                      MARKET CAP {ratioPercent(selectedSector.marketCapCoverage, 0)} / TURNOVER {ratioPercent(selectedSector.turnoverCoverage, 0)}
                    </span>
                    <span>
                      {data?.unclassifiedStockCount ? `${data.unclassifiedStockCount} UNCLASSIFIED / ` : ""}
                      {formatCompact(data?.totalWithQuotes)} QUOTES
                    </span>
                  </footer>
                </>
              ) : (
                <div className="grid min-h-[32rem] place-items-center p-6 text-center text-sm text-white/42">
                  请选择一个板块
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
