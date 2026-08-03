"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  GitCompareArrows,
  Link2,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
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
import {
  PeerTrendChart,
  type PeerTrendLine,
  type PeerTrendPoint,
} from "@/components/charts/PeerTrendChart";
import { className, formatQuoteNumber } from "@/components/shared/util";
import {
  crossMarketPeerGroups,
  peerMatchMethod,
  type CrossMarketPeerGroup,
  type PeerInstrumentRef,
} from "@/lib/cross-market-peers";
import type { LiveQuote } from "@/lib/live-instruments";
import { marketChangeText } from "@/lib/market-colors";
import type { OHLCBar, StockBarsApiResponse, StockBarsResult } from "@/lib/stock-bars";
import {
  readWorkspaceUrl,
  subscribeWorkspaceUrl,
  updateWorkspaceUrl,
} from "@/lib/workspace-url";

type ComparisonRange = 20 | 60 | 120;
type MobilePanel = "groups" | "analysis";

interface QuoteApiResponse {
  generatedAt: string;
  quotes: LiveQuote[];
}

interface PairState {
  quotes: LiveQuote[];
  bars: StockBarsResult[];
  generatedAt: string | null;
}

interface BreakoutState {
  label: string;
  detail: string;
  tone: string;
  breakoutDate: string | null;
  distanceToHigh: number | null;
}

const comparisonRanges: readonly ComparisonRange[] = [20, 60, 120];
const mobilePanels: Array<{ id: MobilePanel; label: string; icon: LucideIcon }> = [
  { id: "groups", label: "对标组", icon: ListFilter },
  { id: "analysis", label: "趋势", icon: ChartNoAxesCombined },
];

function dateKey(timestamp: string) {
  return timestamp.slice(0, 10);
}

function signedPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function normalizePerformance(bars: OHLCBar[], range: ComparisonRange): PeerTrendPoint[] {
  const visible = bars.filter((bar) => Number.isFinite(bar.c) && bar.c > 0).slice(-range);
  const base = visible[0]?.c;
  if (!base) return [];
  return visible.map((bar) => ({
    date: dateKey(bar.t),
    value: ((bar.c / base) - 1) * 100,
  }));
}

function rangeReturn(bars: OHLCBar[], range: ComparisonRange) {
  const visible = bars.filter((bar) => Number.isFinite(bar.c) && bar.c > 0).slice(-range);
  const first = visible[0]?.c;
  const last = visible.at(-1)?.c;
  if (!first || !last) return null;
  return ((last / first) - 1) * 100;
}

function returnSeries(bars: OHLCBar[], range: ComparisonRange) {
  const visible = bars.filter((bar) => Number.isFinite(bar.c) && bar.c > 0).slice(-(range + 1));
  const returns = new Map<string, number>();
  for (let index = 1; index < visible.length; index += 1) {
    const previous = visible[index - 1]?.c;
    const current = visible[index]?.c;
    if (!previous || !current) continue;
    returns.set(dateKey(visible[index].t), current / previous - 1);
  }
  return returns;
}

function pearsonCorrelation(
  cnBars: OHLCBar[],
  usBars: OHLCBar[],
  range: ComparisonRange
) {
  const cnReturns = returnSeries(cnBars, range);
  const usReturns = returnSeries(usBars, range);
  const aligned = [...cnReturns.entries()].flatMap(([date, cnReturn]) => {
    const usReturn = usReturns.get(date);
    return usReturn === undefined ? [] : [[cnReturn, usReturn] as const];
  });
  if (aligned.length < 8) return null;

  const cnMean = aligned.reduce((sum, pair) => sum + pair[0], 0) / aligned.length;
  const usMean = aligned.reduce((sum, pair) => sum + pair[1], 0) / aligned.length;
  let covariance = 0;
  let cnVariance = 0;
  let usVariance = 0;
  for (const [cnReturn, usReturn] of aligned) {
    const cnDelta = cnReturn - cnMean;
    const usDelta = usReturn - usMean;
    covariance += cnDelta * usDelta;
    cnVariance += cnDelta ** 2;
    usVariance += usDelta ** 2;
  }
  const denominator = Math.sqrt(cnVariance * usVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function breakoutState(bars: OHLCBar[]): BreakoutState {
  const visible = bars.filter((bar) => Number.isFinite(bar.c) && bar.c > 0);
  const latest = visible.at(-1);
  if (!latest || visible.length < 21) {
    return {
      label: "样本不足",
      detail: "至少需要 21 个交易日",
      tone: "text-white/52",
      breakoutDate: null,
      distanceToHigh: null,
    };
  }

  const prior = visible.slice(-21, -1);
  const priorHigh = Math.max(...prior.map((bar) => bar.h));
  const distanceToHigh = ((latest.c / priorHigh) - 1) * 100;
  let breakoutDate: string | null = null;
  for (let index = Math.max(20, visible.length - 60); index < visible.length; index += 1) {
    const lookbackHigh = Math.max(...visible.slice(index - 20, index).map((bar) => bar.h));
    if (visible[index].c > lookbackHigh) breakoutDate = dateKey(visible[index].t);
  }

  if (latest.c > priorHigh) {
    return {
      label: "向上突破",
      detail: `收盘高于此前 20 日高点 ${signedPercent(distanceToHigh)}`,
      tone: "text-acid",
      breakoutDate: dateKey(latest.t),
      distanceToHigh,
    };
  }
  if (distanceToHigh >= -3) {
    return {
      label: "临近前高",
      detail: `距 20 日高点 ${signedPercent(distanceToHigh)}`,
      tone: "text-amberline",
      breakoutDate,
      distanceToHigh,
    };
  }
  return {
    label: "尚未突破",
    detail: `距 20 日高点 ${signedPercent(distanceToHigh)}`,
    tone: "text-white/62",
    breakoutDate,
    distanceToHigh,
  };
}

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function quotePrice(quote: LiveQuote | undefined) {
  if (!quote || quote.price === null) return "--";
  return formatQuoteNumber(quote.price, quote.price < 10 ? 3 : 2);
}

function signalSummary(
  group: CrossMarketPeerGroup,
  cnBreakout: BreakoutState,
  usBreakout: BreakoutState,
  cnReturn: number | null,
  usReturn: number | null
) {
  if (cnBreakout.label === "向上突破" && usBreakout.label !== "向上突破") {
    return `${group.cn.name} 已率先突破，${group.us.name} 尚未同步确认。`;
  }
  if (usBreakout.label === "向上突破" && cnBreakout.label !== "向上突破") {
    return `${group.us.name} 已率先突破，${group.cn.name} 尚未同步确认。`;
  }
  if (cnReturn === null || usReturn === null) return "历史行情仍在同步，暂不判断领先与滞后。";
  const spread = cnReturn - usReturn;
  if (Math.abs(spread) < 1) return `近阶段走势接近，收益差仅 ${Math.abs(spread).toFixed(1)} 个百分点。`;
  const leader = spread > 0 ? group.cn.name : group.us.name;
  const lagger = spread > 0 ? group.us.name : group.cn.name;
  return `${leader} 相对领先，${lagger} 滞后 ${Math.abs(spread).toFixed(1)} 个百分点。`;
}

export function PeerComparisonWorkspace() {
  const [selectedId, setSelectedId] = useState(crossMarketPeerGroups[0]?.id ?? "");
  const [range, setRange] = useState<ComparisonRange>(60);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("groups");
  const [urlReady, setUrlReady] = useState(false);
  const [state, setState] = useState<PairState>({ quotes: [], bars: [], generatedAt: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedGroup =
    crossMarketPeerGroups.find((group) => group.id === selectedId) ?? crossMarketPeerGroups[0];

  useEffect(() => {
    function syncFromUrl() {
      const parameters = readWorkspaceUrl();
      const requested = parameters.get("peer");
      if (requested && crossMarketPeerGroups.some((group) => group.id === requested)) {
        setSelectedId(requested);
      }
      const requestedRange = Number(parameters.get("range"));
      if (comparisonRanges.includes(requestedRange as ComparisonRange)) {
        setRange(requestedRange as ComparisonRange);
      }
      setUrlReady(true);
    }

    syncFromUrl();
    return subscribeWorkspaceUrl(syncFromUrl);
  }, []);

  const load = useCallback(
    async (quotesOnly = false) => {
      if (!selectedGroup) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (quotesOnly) setRefreshing(true);
      else setLoading(true);

      const ids = `${selectedGroup.cn.id},${selectedGroup.us.id}`;
      const quoteRequest = fetch(`/api/live/quotes?ids=${encodeURIComponent(ids)}`, {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return (await response.json()) as QuoteApiResponse;
      });
      const barsRequest = quotesOnly
        ? Promise.resolve<StockBarsApiResponse | null>(null)
        : fetch(`/api/live/bars?ids=${encodeURIComponent(ids)}&period=daily`, {
            cache: "no-store",
            signal: controller.signal,
          }).then(async (response) => {
            if (!response.ok) throw new Error(await responseError(response));
            return (await response.json()) as StockBarsApiResponse;
          });

      const [quoteResult, barsResult] = await Promise.allSettled([quoteRequest, barsRequest]);
      if (controller.signal.aborted) return;

      const failures: string[] = [];
      setState((current) => {
        const next = { ...current };
        if (quoteResult.status === "fulfilled") {
          next.quotes = quoteResult.value.quotes;
          next.generatedAt = quoteResult.value.generatedAt;
        } else {
          failures.push(quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason));
        }
        if (barsResult.status === "fulfilled" && barsResult.value) {
          next.bars = barsResult.value.results;
          next.generatedAt = barsResult.value.generatedAt;
        } else if (barsResult.status === "rejected") {
          failures.push(barsResult.reason instanceof Error ? barsResult.reason.message : String(barsResult.reason));
        }
        return next;
      });
      setError(failures.join(" / "));
      setLoading(false);
      setRefreshing(false);
    },
    [selectedGroup]
  );

  useEffect(() => {
    if (!urlReady || !selectedGroup) return;
    setState({ quotes: [], bars: [], generatedAt: null });
    setError("");
    void load(false);

    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 15_000);
    const handleVisibility = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      controllerRef.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [load, selectedGroup, urlReady]);

  const quoteById = useMemo(
    () => new Map(state.quotes.map((quote) => [quote.instrument.id, quote])),
    [state.quotes]
  );
  const barsById = useMemo(
    () => new Map(state.bars.map((result) => [result.instrument.id, result])),
    [state.bars]
  );

  if (!selectedGroup) return null;

  const cnQuote = quoteById.get(selectedGroup.cn.id);
  const usQuote = quoteById.get(selectedGroup.us.id);
  const cnBarsResult = barsById.get(selectedGroup.cn.id);
  const usBarsResult = barsById.get(selectedGroup.us.id);
  const cnBars = cnBarsResult?.bars ?? [];
  const usBars = usBarsResult?.bars ?? [];
  const cnReturn = rangeReturn(cnBars, range);
  const usReturn = rangeReturn(usBars, range);
  const spread = cnReturn !== null && usReturn !== null ? cnReturn - usReturn : null;
  const correlation = pearsonCorrelation(cnBars, usBars, range);
  const cnBreakout = breakoutState(cnBars);
  const usBreakout = breakoutState(usBars);
  const leader =
    spread === null || Math.abs(spread) < 1
      ? "走势接近"
      : spread > 0
        ? `${selectedGroup.cn.name} 领先`
        : `${selectedGroup.us.name} 领先`;
  const lines: readonly PeerTrendLine[] = [
    {
      id: "CN",
      label: `${selectedGroup.cn.name} ${selectedGroup.cn.symbol}`,
      color: "#df6b55",
      points: normalizePerformance(cnBars, range),
    },
    {
      id: "US",
      label: `${selectedGroup.us.name} ${selectedGroup.us.symbol}`,
      color: "#7fb7a3",
      points: normalizePerformance(usBars, range),
    },
  ];
  const headline = signalSummary(
    selectedGroup,
    cnBreakout,
    usBreakout,
    cnReturn,
    usReturn
  );

  function selectGroup(group: CrossMarketPeerGroup) {
    setSelectedId(group.id);
    setMobilePanel("analysis");
    updateWorkspaceUrl({ peer: group.id }, "replace");
  }

  function changeRange(nextRange: ComparisonRange) {
    setRange(nextRange);
    updateWorkspaceUrl({ range: nextRange }, "replace");
  }

  function openStock(instrument: PeerInstrumentRef) {
    const [, exchange] = instrument.id.split(":");
    updateWorkspaceUrl({
      view: "stocks",
      market: instrument.market,
      exchange,
      q: instrument.symbol,
      page: null,
      stock: instrument.id,
      panel: "chart",
      peer: null,
      range: null,
    });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + mobilePanels.length) % mobilePanels.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % mobilePanels.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = mobilePanels.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setMobilePanel(mobilePanels[nextIndex].id);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  }

  const metrics = [
    {
      label: `${range}D 收益相关`,
      value: correlation === null ? "--" : correlation.toFixed(2),
      tone: correlation !== null && correlation >= 0.5 ? "text-acid" : "text-white/74",
    },
    {
      label: "相对收益差",
      value: signedPercent(spread),
      tone: spread === null ? "text-white/52" : spread >= 0 ? "text-dangerline" : "text-acid",
    },
    { label: "当前领先", value: leader, tone: "text-white" },
    { label: "业务匹配", value: "3 / 3", tone: "text-gold" },
  ];

  return (
    <section id="cross-market-peers" className="ink-section relative z-10 px-3 py-5 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1800px]">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="ink-kicker flex items-center gap-2 text-sm text-acid">
              <GitCompareArrows className="h-5 w-5" aria-hidden="true" />
              CROSS-MARKET PRODUCT PEERS
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-white sm:text-4xl">跨市场对标</h2>
            <p className="mt-2 text-base leading-7 text-white/58 sm:text-lg">
              以共同产品和产业链位置为先，比较 A 股与美股同类公司的趋势、相对强弱与突破先后。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-3 border border-white/10 bg-black/20 p-1" role="group" aria-label="选择比较窗口">
              {comparisonRanges.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeRange(option)}
                  aria-pressed={range === option}
                  className={className(
                    "min-h-11 min-w-16 px-3 font-mono text-sm transition-colors",
                    range === option
                      ? "bg-paper text-carbon-deep"
                      : "text-white/58 hover:bg-white/[0.05] hover:text-white"
                  )}
                >
                  {option}D
                </button>
              ))}
            </div>
            <div className="inline-flex min-h-12 min-w-0 items-center gap-2 border border-white/10 bg-white/[0.035] px-3 font-mono text-sm text-white/58" role="status">
              {loading || refreshing ? (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-amberline" aria-hidden="true" />
              ) : error ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-dangerline" aria-hidden="true" />
              ) : (
                <Clock3 className="h-4 w-4 shrink-0 text-acid" aria-hidden="true" />
              )}
              <span className="truncate">数据截至 {formatDateTime(state.generatedAt)}</span>
            </div>
            <button
              type="button"
              onClick={() => void load(false)}
              disabled={loading || refreshing}
              className="grid h-12 w-12 place-items-center rounded-[6px] border border-white/10 bg-white/[0.035] text-white/68 transition hover:border-acid/50 hover:text-acid disabled:cursor-wait disabled:opacity-50"
              aria-label="刷新跨市场对标行情"
              title="刷新跨市场对标行情"
            >
              <RefreshCw className={className("h-5 w-5", (loading || refreshing) && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 border-b border-white/10 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 border-r border-white/[0.07] px-3 py-3 last:border-r-0 sm:px-4">
              <p className="font-mono text-sm text-white/44">{metric.label}</p>
              <p className={className("mt-1.5 truncate font-mono text-xl font-semibold sm:text-2xl", metric.tone)} title={metric.value}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 border border-amberline/35 bg-amberline/[0.08] px-3 py-2.5 text-sm text-amberline" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>部分行情暂不可用，继续展示已取得的数据 / {error}</span>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 border border-white/10 bg-black/20 p-1 lg:hidden" role="tablist" aria-label="跨市场对标视图">
          {mobilePanels.map((panel, index) => {
            const Icon = panel.icon;
            const selected = mobilePanel === panel.id;
            return (
              <button
                key={panel.id}
                ref={(node) => { tabRefs.current[index] = node; }}
                id={`${tabsId}-${panel.id}-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tabsId}-${panel.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setMobilePanel(panel.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={className(
                  "inline-flex h-11 items-center justify-center gap-2 px-3 text-sm transition",
                  selected ? "bg-paper text-carbon-deep" : "text-white/58 hover:bg-white/[0.05] hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {panel.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(22rem,0.68fr)_minmax(0,1.32fr)]">
          <section
            id={`${tabsId}-groups-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-groups-tab`}
            tabIndex={0}
            className={className(
              "ink-panel min-w-0 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
              mobilePanel === "groups" ? "block" : "hidden lg:block"
            )}
          >
            <div className="border-b border-white/10 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">严选对标组</h3>
                  <p className="mt-1 text-sm text-white/46">{crossMarketPeerGroups.length} 组 · {peerMatchMethod.title}</p>
                </div>
                <ShieldCheck className="h-5 w-5 text-gold" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm leading-6 text-white/52">{peerMatchMethod.summary}</p>
            </div>

            <div className="max-h-[calc(100svh-18rem)] min-h-[34rem] overflow-y-auto thin-scrollbar">
              {crossMarketPeerGroups.map((group, index) => {
                const selected = selectedGroup.id === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => selectGroup(group)}
                    aria-pressed={selected}
                    className={className(
                      "w-full border-b border-white/[0.07] px-4 py-4 text-left transition last:border-b-0",
                      selected
                        ? "bg-white/[0.075] shadow-[inset_3px_0_0_#7fb7a3]"
                        : "hover:bg-white/[0.035]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-white/36">{String(index + 1).padStart(2, "0")}</span>
                      <span className="border border-gold/30 bg-gold/[0.08] px-2 py-1 text-xs text-gold">3/3 MATCH</span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-acid">{group.category}</p>
                    <h4 className="mt-1 text-lg font-semibold text-white">{group.theme}</h4>
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-white/82">{group.cn.name}</span>
                        <span className="mt-0.5 block font-mono text-dangerline">{group.cn.symbol}</span>
                      </span>
                      <GitCompareArrows className="h-4 w-4 text-white/28" aria-hidden="true" />
                      <span className="min-w-0 text-right">
                        <span className="block truncate text-white/82">{group.us.name}</span>
                        <span className="mt-0.5 block font-mono text-acid">{group.us.symbol}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            id={`${tabsId}-analysis-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-analysis-tab`}
            tabIndex={0}
            className={className(
              "ink-panel min-w-0 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
              mobilePanel === "analysis" ? "block" : "hidden lg:block"
            )}
          >
            <div className="border-b border-white/10 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-gold">{selectedGroup.category} / HIGH-CONVICTION PEER</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{selectedGroup.theme}</h3>
                  <p className="mt-2 text-base text-white/54">{selectedGroup.focus}</p>
                </div>
                <div className="shrink-0 border border-gold/30 bg-gold/[0.07] px-3 py-2 text-sm text-gold">
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    核心匹配 3 / 3
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {selectedGroup.matchAxes.map((axis) => (
                  <div key={axis} className="flex min-h-11 items-center gap-2 border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/66">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-acid" aria-hidden="true" />
                    <span>{axis}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid border-b border-white/10 md:grid-cols-2">
              {([selectedGroup.cn, selectedGroup.us] as const).map((instrument) => {
                const quote = quoteById.get(instrument.id);
                const result = barsById.get(instrument.id);
                const change = quote?.changePct;
                const tone =
                  typeof change === "number"
                    ? marketChangeText(instrument.market, change)
                    : "text-white/42";
                return (
                  <button
                    key={instrument.id}
                    type="button"
                    onClick={() => openStock(instrument)}
                    className="group min-w-0 border-b border-white/[0.08] px-4 py-5 text-left transition hover:bg-white/[0.03] md:border-b-0 md:border-r md:last:border-r-0 sm:px-5"
                    aria-label={`打开 ${instrument.name} ${instrument.symbol} 个股行情`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-white/42">{instrument.market === "CN" ? "A 股" : "US 美股"} / {instrument.symbol}</p>
                        <h4 className="mt-1 truncate text-xl font-semibold text-white sm:text-2xl">{instrument.name}</h4>
                        <p className="mt-1 truncate text-sm text-white/46">{instrument.role}</p>
                      </div>
                      <ArrowUpRight className="h-5 w-5 shrink-0 text-white/28 transition group-hover:text-acid" aria-hidden="true" />
                    </div>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <p className="font-mono text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                          {quotePrice(quote)}
                        </p>
                        <p className="mt-1 font-mono text-sm text-white/36">{quote?.instrument.currency ?? result?.instrument.currency ?? "--"}</p>
                      </div>
                      <p className={className("font-mono text-2xl font-semibold tabular-nums", tone)}>
                        {signedPercent(change)}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 font-mono text-sm text-white/42">
                      <span>{quote?.feedStatus?.replaceAll("_", " ") ?? result?.sourceLabel ?? "WAITING"}</span>
                      <span>{formatDateTime(quote?.timestamp ?? result?.dataAsOf)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-b border-white/10 px-4 py-5 sm:px-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-sm text-acid">NORMALIZED PERFORMANCE / 起点 0%</p>
                  <h4 className="mt-1 text-xl font-semibold text-white">{range} 个交易日相对走势</h4>
                </div>
                <p className="text-sm text-white/46">按各自交易日收盘比较，不受币种绝对价格影响</p>
              </div>
              {loading && lines.every((line) => line.points.length === 0) ? (
                <div className="grid h-[22rem] place-items-center border border-white/10 bg-black/20">
                  <div className="text-center">
                    <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-acid" aria-hidden="true" />
                    <p className="mt-3 text-base text-white/52">正在同步两地历史行情</p>
                  </div>
                </div>
              ) : (
                <PeerTrendChart lines={lines} />
              )}
            </div>

            <div className="border-b border-white/10 px-4 py-5 sm:px-5">
              <div className="flex items-start gap-3 border border-acid/25 bg-acid/[0.06] px-4 py-3">
                <Activity className="mt-0.5 h-5 w-5 shrink-0 text-acid" aria-hidden="true" />
                <div>
                  <p className="font-mono text-sm text-acid">LEAD / LAG SIGNAL</p>
                  <p className="mt-1 text-lg font-medium leading-7 text-white">{headline}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  [selectedGroup.cn, cnBreakout, cnReturn],
                  [selectedGroup.us, usBreakout, usReturn],
                ].map(([instrument, breakout, performance]) => {
                  const typedInstrument = instrument as PeerInstrumentRef;
                  const typedBreakout = breakout as BreakoutState;
                  const typedPerformance = performance as number | null;
                  return (
                    <div key={typedInstrument.id} className="border border-white/[0.09] bg-white/[0.025] px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-medium text-white">{typedInstrument.name}</p>
                          <p className="mt-0.5 font-mono text-sm text-white/42">{typedInstrument.symbol}</p>
                        </div>
                        <TrendingUp className={className("h-5 w-5", typedBreakout.tone)} aria-hidden="true" />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-3">
                        <div>
                          <p className="text-sm text-white/42">{range}D 收益</p>
                          <p className="mt-1 font-mono text-xl text-white">{signedPercent(typedPerformance)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-white/42">突破状态</p>
                          <p className={className("mt-1 text-base font-medium", typedBreakout.tone)}>{typedBreakout.label}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/52">{typedBreakout.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 px-4 py-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] sm:px-5">
              <div>
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-gold" aria-hidden="true" />
                  <h4 className="text-lg font-semibold text-white">为什么放在一起比较</h4>
                </div>
                <p className="mt-3 text-base leading-7 text-white/64">{selectedGroup.sharedDemand}</p>
                <div className="mt-4 border-l-2 border-amberline/45 pl-3">
                  <p className="text-sm font-medium text-amberline">不可忽略的差异</p>
                  <p className="mt-1 text-sm leading-6 text-white/52">{selectedGroup.difference}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Gauge className="h-5 w-5 text-acid" aria-hidden="true" />
                  <h4 className="text-lg font-semibold text-white">核验依据</h4>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedGroup.evidence.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex min-h-12 items-center justify-between gap-3 border border-white/[0.09] px-3 py-2 text-sm text-white/62 transition hover:border-acid/40 hover:text-white"
                    >
                      <span>{source.label}</span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-white/28 transition group-hover:text-acid" aria-hidden="true" />
                    </a>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-white/38">
                  业务匹配来自公司公开资料；价格相关性与领先关系会随窗口变化，不构成因果或交易建议。
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
