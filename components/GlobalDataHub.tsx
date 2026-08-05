"use client";

import {
  Activity,
  BarChart3,
  BookOpen,
  CandlestickChart,
  ChartSpline,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  Globe2,
  Layers3,
  Network,
  RefreshCw,
  ScanLine,
  Search,
  Star
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { MetricTile } from "@/components/shared/MetricTile";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { DepthChart } from "@/components/charts/DepthChart";
import { StockChartPanel } from "@/components/charts/StockChartPanel";
import { StockTechnicalPanel } from "@/components/charts/StockTechnicalPanel";
import { StockVolumePanel } from "@/components/charts/StockVolumePanel";
import { className, formatQuoteNumber, formatCompact } from "@/components/shared/util";
import { IntradaySparkline } from "@/components/charts/IntradaySparkline";
import type { LiveQuote } from "@/lib/live-instruments";
import type {
  StockCatalogResponse,
  StockInstrument,
  StockMarket
} from "@/lib/stock-catalog";
import { marketChangeText, marketColorPalette } from "@/lib/market-colors";
import { stockChartPeriods, type StockChartPeriod } from "@/lib/stock-bars";
import {
  readWorkspaceUrl,
  subscribeWorkspaceUrl,
  updateWorkspaceUrl
} from "@/lib/workspace-url";

const stockMarketOptions: Array<{ id: StockMarket; label: string; detail: string }> = [
  { id: "CN", label: "中国 A 股", detail: "沪 / 深 / 北" },
  { id: "US", label: "美国股票", detail: "NASDAQ / NYSE / AMEX" }
];

const stockExchangeOptions: Record<StockMarket, Array<{ id: string; label: string }>> = {
  CN: [
    { id: "ALL", label: "全部交易所" },
    { id: "XSHG", label: "上交所" },
    { id: "XSHE", label: "深交所" },
    { id: "XBSE", label: "北交所" }
  ],
  US: [
    { id: "ALL", label: "全部交易所" },
    { id: "XNAS", label: "NASDAQ" },
    { id: "XNYS", label: "NYSE" },
    { id: "XASE", label: "NYSE AMEX" },
    { id: "ARCX", label: "NYSE ARCA" },
    { id: "BATS", label: "CBOE" }
  ]
};

type GlobalDataHubProps = {
  streamTick?: number;
  workspace?: boolean;
  watchlistIds?: readonly string[];
  onWatchlistAdd?: (instrument: StockInstrument) => void;
  onWatchlistRemove?: (id: string) => void;
};

type WorkspacePanel = "catalog" | "chart" | "details";
type StockLens = "kline" | "volume" | "technical" | "depth";

const workspacePanels: Array<{
  id: WorkspacePanel;
  label: string;
  icon: typeof Layers3;
}> = [
  { id: "catalog", label: "目录", icon: Layers3 },
  { id: "chart", label: "图表", icon: Activity },
  { id: "details", label: "详情", icon: ScanLine }
];

const stockLenses: Array<{
  id: StockLens;
  label: string;
  detail: string;
  icon: typeof CandlestickChart;
}> = [
  { id: "kline", label: "K线", detail: "OHLCV", icon: CandlestickChart },
  { id: "volume", label: "量价", detail: "VOLUME", icon: BarChart3 },
  { id: "technical", label: "技术", detail: "SIGNALS", icon: ChartSpline },
  { id: "depth", label: "盘口", detail: "ORDER BOOK", icon: BookOpen }
];

// Decide whether a search box value is "ready to search".
//
// Chinese IME workflow: a user types pinyin letters (m-a-o) and only commits
// them to a character (茅) at the end. Mid-composition the box holds a mix of
// already-committed Chinese and raw Latin pinyin. We must NOT search then — it
// would fire on junk letters, waste requests, and return wrong matches.
//
// Rules (per the user's spec):
//   - has Chinese AND has Latin letters  → NOT searchable (pinyin still typing)
//   - has Chinese, no Latin              → searchable (pure Chinese committed)
//   - no Chinese                         → searchable (ticker / English / digits,
//                                           search on every keystroke is desired)
//   - empty / whitespace only            → searchable (clears back to full list)
const CJK_PATTERN = /[\u4e00-\u9fff]/u;
const LATIN_PATTERN = /[A-Za-z]/u;

function isSearchableQuery(value: string): boolean {
  if (value.trim().length === 0) return true;
  const hasChinese = CJK_PATTERN.test(value);
  const hasLatin = LATIN_PATTERN.test(value);
  // Mixed Chinese + Latin means pinyin composition is in progress.
  return !(hasChinese && hasLatin);
}

function isStockMarketOpen(market: StockMarket, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market === "CN" ? "Asia/Shanghai" : "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (market === "US") return minutes >= 570 && minutes < 960;
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

function quoteStatusLabel(status: LiveQuote["feedStatus"]) {
  if (status === "LICENSED_REALTIME") return "LICENSED LIVE";
  if (status === "LIVE_PUBLIC") return "PUBLIC LIVE";
  if (status === "DELAYED_PUBLIC") return "PUBLIC DELAYED";
  if (status === "MARKET_CLOSED_LAST_TICK") return "LAST TICK";
  return "FEED ERROR";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatQuoteNumber(value, 2)}%`
    : "--";
}

function buildQuoteInsight(quote: LiveQuote) {
  const direction =
    quote.changePct === null
      ? "行情待校验"
      : quote.changePct > 0
      ? "上涨"
      : quote.changePct < 0
        ? "下跌"
        : "持平";
  const status = quoteStatusLabel(quote.feedStatus);
  const bidAsk =
    quote.bid !== null && quote.ask !== null
      ? `买一 ${formatQuoteNumber(quote.bid)} / 卖一 ${formatQuoteNumber(quote.ask)}`
      : "当前公开源未返回盘口深度";

  return {
    headline: `${quote.instrument.name} ${direction}${
      quote.changePct === null ? "" : ` ${formatPercent(quote.changePct)}`
    }`,
    drivers: [
      `最新价 ${formatQuoteNumber(quote.price)} ${quote.instrument.currency}`,
      `成交量 ${formatCompact(quote.volume)}，成交额 ${formatCompact(quote.turnover)}`,
      bidAsk
    ],
    risk:
      quote.feedStatus === "LICENSED_REALTIME"
        ? "当前行情来自已配置的持牌实时数据接口；权限范围和可再分发范围仍以数据合同为准。"
        : quote.feedStatus === "MARKET_CLOSED_LAST_TICK"
        ? "当前展示的是最近一个交易时段的最后公开 tick，不应当被当作盘中实时跳动。"
        : quote.feedStatus === "ERROR"
          ? quote.providerMessage
          : "公开免费行情源可能存在延迟、限频或字段缺失；真实交易前需要授权行情源校验。",
    nextCheck: `${status} / ${new Date(quote.timestamp).toLocaleString("zh-CN", {
      hour12: false
    })}`
  };
}

export function GlobalDataHub({
  workspace = false,
  watchlistIds = [],
  onWatchlistAdd,
  onWatchlistRemove
}: GlobalDataHubProps) {
  const [market, setMarket] = useState<StockMarket>("CN");
  const [exchange, setExchange] = useState("ALL");
  const [searchInput, setSearchInput] = useState("");
  // Typeahead suggestions for the search box. The main catalog list is NOT
  // filtered while typing — the box only proposes matches for quick navigation.
  const [suggestions, setSuggestions] = useState<StockInstrument[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // A stock picked from the suggestion dropdown may not be on the current
  // catalog page; pin it so the chart can still resolve and render it.
  const [pinnedInstrument, setPinnedInstrument] = useState<StockInstrument | null>(null);
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<StockCatalogResponse | null>(null);
  const [quotes, setQuotes] = useState<LiveQuote[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [chartPeriod, setChartPeriod] =
    useState<StockChartPeriod>("intraday");
  const [stockLens, setStockLens] = useState<StockLens>("kline");
  const [activeWorkspacePanel, setActiveWorkspacePanel] =
    useState<WorkspacePanel>("catalog");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const workspaceTabsId = useId();
  const workspaceTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const stockLensTabsId = useId();
  const stockLensTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function syncFromUrl() {
      const parameters = readWorkspaceUrl();
      const nextMarket = parameters.get("market")?.toUpperCase() === "US" ? "US" : "CN";
      const requestedExchange = parameters.get("exchange")?.toUpperCase() ?? "ALL";
      const validExchange = stockExchangeOptions[nextMarket].some(
        (option) => option.id === requestedExchange
      )
        ? requestedExchange
        : "ALL";
      const requestedPage = Number(parameters.get("page"));
      const nextPage =
        Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const requestedPanel = parameters.get("panel");
      const nextPanel = workspacePanels.some((panel) => panel.id === requestedPanel)
        ? (requestedPanel as WorkspacePanel)
        : "catalog";
      const requestedPeriod = parameters.get("period");
      const nextPeriod = stockChartPeriods.some((period) => period.id === requestedPeriod)
        ? (requestedPeriod as StockChartPeriod)
        : "intraday";
      const requestedStockLens = parameters.get("stockLens");
      const nextStockLens = stockLenses.some((lens) => lens.id === requestedStockLens)
        ? (requestedStockLens as StockLens)
        : "kline";
      const nextQuery = (parameters.get("q") ?? "").slice(0, 120);

      setMarket(nextMarket);
      setExchange(validExchange);
      setSearchInput(nextQuery);
      setPage(nextPage);
      setSelectedQuoteId((parameters.get("stock") ?? "").toUpperCase());
      setActiveWorkspacePanel(nextPanel);
      setChartPeriod(nextPeriod);
      setStockLens(nextStockLens);
      setUrlStateReady(true);
    }

    syncFromUrl();
    return subscribeWorkspaceUrl(syncFromUrl);
  }, []);

  // Typeahead suggestions. Debounced, lightweight query for the dropdown only —
  // the main catalog list is left untouched while typing, so input is never
  // interrupted by a full re-fetch.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (!urlStateReady || trimmed.length === 0 || !isSearchableQuery(trimmed)) {
      setSuggestionsOpen(false);
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    setSuggestionsOpen(true);
    setSuggestionsLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ market, page: "1", pageSize: "8" });
        params.set("q", trimmed);
        const response = await fetch(`/api/live/instruments?${params}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`instrument suggestions ${response.status}`);
        const payload = (await response.json()) as StockCatalogResponse;
        if (!controller.signal.aborted) {
          setSuggestions(payload.items);
          setSuggestionsLoading(false);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setSuggestionsLoading(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [market, searchInput, urlStateReady]);

  useEffect(() => {
    if (!urlStateReady) return;

    const controller = new AbortController();

    async function loadCatalog() {
      setCatalogLoading(true);
      setCatalog(null);
      setCatalogError("");
      try {
        const params = new URLSearchParams({
          market,
          page: String(page),
          pageSize: "50"
        });
        if (exchange !== "ALL") params.set("exchange", exchange);

        const response = await fetch(`/api/live/instruments?${params}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`instrument catalog ${response.status}`);
        const payload = (await response.json()) as StockCatalogResponse;

        setCatalog(payload);
        setCatalogError("");
        if (payload.totalPages > 0 && page > payload.totalPages) {
          setPage(payload.totalPages);
          updateWorkspaceUrl(
            { page: payload.totalPages === 1 ? null : payload.totalPages },
            "replace"
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    }

    loadCatalog();
    return () => controller.abort();
  }, [exchange, market, page, urlStateReady]);

  const currentPageKey = (catalog?.items ?? []).map((instrument) => instrument.id).join(",");
  // Include the suggestion-pinned stock in the live-quote fetch so its chart
  // and details panel resolve even when it isn't on the current catalog page.
  const quoteFetchIds = useMemo(() => {
    if (pinnedInstrument && !currentPageKey.split(",").includes(pinnedInstrument.id)) {
      return currentPageKey ? `${currentPageKey},${pinnedInstrument.id}` : pinnedInstrument.id;
    }
    return currentPageKey;
  }, [currentPageKey, pinnedInstrument]);

  useEffect(() => {
    if (!quoteFetchIds) {
      setQuotes([]);
      setQuotesLoading(false);
      return;
    }

    const controller = new AbortController();
    let quoteRequestInFlight = false;
    let lastQuoteRequestAt = 0;

    async function loadQuotes() {
      if (quoteRequestInFlight) return;
      quoteRequestInFlight = true;
      lastQuoteRequestAt = Date.now();
      try {
        const response = await fetch(
          `/api/live/quotes?ids=${encodeURIComponent(quoteFetchIds)}`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!response.ok) throw new Error(`live quotes ${response.status}`);
        const payload = (await response.json()) as {
          generatedAt: string;
          quotes: LiveQuote[];
        };

        setQuotes(payload.quotes);
        setLastUpdated(payload.generatedAt);
        setFeedError("");
      } catch (error) {
        if (!controller.signal.aborted) {
          setFeedError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        quoteRequestInFlight = false;
        if (!controller.signal.aborted) setQuotesLoading(false);
      }
    }

    setQuotesLoading(true);
    loadQuotes();
    const timer = window.setInterval(() => {
      const pollingInterval = isStockMarketOpen(market) ? 5_000 : 60_000;
      if (
        !document.hidden &&
        Date.now() - lastQuoteRequestAt >= pollingInterval
      ) {
        loadQuotes();
      }
    }, 1_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [quoteFetchIds, market, pinnedInstrument, refreshToken]);

  const instruments = catalog?.items ?? [];
  const quoteById = useMemo(
    () => new Map(quotes.map((quote) => [quote.instrument.id, quote])),
    [quotes]
  );
  const watchlistIdSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  useEffect(() => {
    if (!urlStateReady || catalogLoading) return;
    // A suggestion-pinned stock may not be on the current catalog page; keep it
    // so the auto-select below doesn't override the user's dropdown pick.
    if (pinnedInstrument && pinnedInstrument.id === selectedQuoteId) return;
    if (instruments.length === 0) {
      setSelectedQuoteId("");
      updateWorkspaceUrl({ stock: null }, "replace");
      return;
    }
    if (!instruments.some((instrument) => instrument.id === selectedQuoteId)) {
      const nextId = instruments[0].id;
      setSelectedQuoteId(nextId);
      updateWorkspaceUrl(
        {
          market,
          exchange: exchange === "ALL" ? null : exchange,
          page: page === 1 ? null : page,
          stock: nextId,
          panel: activeWorkspacePanel,
          period: chartPeriod,
          stockLens
        },
        "replace"
      );
    }
  }, [
    activeWorkspacePanel,
    catalogLoading,
    chartPeriod,
    exchange,
    instruments,
    market,
    page,
    pinnedInstrument,
    selectedQuoteId,
    stockLens,
    urlStateReady
  ]);

  const selectedInstrument =
    pinnedInstrument && pinnedInstrument.id === selectedQuoteId
      ? pinnedInstrument
      : instruments.find((instrument) => instrument.id === selectedQuoteId) ?? instruments[0];
  const selectedQuote = selectedInstrument ? quoteById.get(selectedInstrument.id) : undefined;
  const selectedWatched = selectedInstrument
    ? watchlistIdSet.has(selectedInstrument.id)
    : false;
  const insight = selectedQuote ? buildQuoteInsight(selectedQuote) : null;
  const successfulQuotes = quotes.filter((quote) => quote.feedStatus !== "ERROR").length;
  const liveCount = quotes.filter(
    (quote) =>
      quote.feedStatus === "LICENSED_REALTIME" || quote.feedStatus === "LIVE_PUBLIC"
  ).length;
  const marketUniverse = catalog?.counts.byMarket[market] ?? catalog?.total ?? 0;
  const currentPage = catalog?.page ?? page;
  const totalPages = catalog?.totalPages ?? 0;
  const hasDataError = Boolean(catalogError || feedError);
  const dataSyncing = catalogLoading || quotesLoading;
  const syncStatus = hasDataError
    ? "FEED ERROR"
    : dataSyncing
      ? "SYNCING"
      : lastUpdated
        ? `UPDATED ${new Date(lastUpdated).toLocaleTimeString("zh-CN", { hour12: false })}`
        : "WAITING";
  const metricItems = [
    {
      icon: Network,
      label: `${market} STOCK UNIVERSE`,
      value: catalogLoading && !catalog ? "--" : formatCompact(marketUniverse),
      tone: "text-acid"
    },
    {
      icon: Search,
      label: "MATCHED STOCKS",
      value: catalogLoading && !catalog ? "--" : formatCompact(catalog?.total ?? 0),
      tone: "text-cyanline"
    },
    {
      icon: Layers3,
      label: "CURRENT PAGE",
      value: `${instruments.length} / 50`,
      tone: "text-amberline"
    },
    {
      icon: Activity,
      label: "QUOTE COVERAGE",
      value: quotesLoading ? "SYNC" : `${successfulQuotes}/${instruments.length}`,
      tone: "text-acid"
    }
  ];

  function changeMarket(nextMarket: StockMarket) {
    setMarket(nextMarket);
    setExchange("ALL");
    setPage(1);
    setSelectedQuoteId("");
    setActiveWorkspacePanel("catalog");
    updateWorkspaceUrl({
      market: nextMarket,
      exchange: null,
      page: null,
      stock: null,
      panel: "catalog"
    });
  }

  function selectInstrument(id: string) {
    setSelectedQuoteId(id);
    setActiveWorkspacePanel("chart");
    updateWorkspaceUrl({
      stock: id,
      panel: "chart",
      period: chartPeriod,
      stockLens
    });

    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => workspaceTabRefs.current[1]?.focus());
    }
  }

  // Pick a stock from the suggestion dropdown. Unlike selectInstrument, the
  // chosen instrument is pinned so it renders even when it isn't on the current
  // catalog page.
  function selectSuggestion(instrument: StockInstrument) {
    setPinnedInstrument(instrument);
    setSelectedQuoteId(instrument.id);
    setActiveWorkspacePanel("chart");
    setSuggestionsOpen(false);
    setSearchInput("");
    updateWorkspaceUrl({
      stock: instrument.id,
      panel: "chart",
      period: chartPeriod,
      stockLens
    });

    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => workspaceTabRefs.current[1]?.focus());
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      event.currentTarget.blur();
    }
  }

  function selectWorkspacePanel(panel: WorkspacePanel) {
    setActiveWorkspacePanel(panel);
    updateWorkspaceUrl({ panel });
  }

  function changeChartPeriod(period: StockChartPeriod) {
    setChartPeriod(period);
    updateWorkspaceUrl({ period });
  }

  function selectStockLens(lens: StockLens) {
    setStockLens(lens);
    setActiveWorkspacePanel("chart");
    updateWorkspaceUrl({ panel: "chart", stockLens: lens });
  }

  function toggleWatchlist(instrument: StockInstrument) {
    if (watchlistIdSet.has(instrument.id)) {
      onWatchlistRemove?.(instrument.id);
    } else {
      onWatchlistAdd?.(instrument);
    }
  }

  function handleWorkspaceTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % workspacePanels.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + workspacePanels.length) % workspacePanels.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = workspacePanels.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    selectWorkspacePanel(workspacePanels[nextIndex].id);
    window.requestAnimationFrame(() => workspaceTabRefs.current[nextIndex]?.focus());
  }

  function handleStockLensKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % stockLenses.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + stockLenses.length) % stockLenses.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = stockLenses.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    selectStockLens(stockLenses[nextIndex].id);
    window.requestAnimationFrame(() => stockLensTabRefs.current[nextIndex]?.focus());
  }

  return (
    <section
      id="data-hub"
      className={className(
        "ink-section relative z-10",
        workspace ? "px-3 py-4 sm:px-4 lg:px-5" : "px-4 py-12 sm:px-6 lg:px-10"
      )}
    >
      <div
        className={className("mx-auto", workspace ? "max-w-[1800px]" : "max-w-7xl")}
      >
        <div
          className={className(
            "flex-wrap items-end justify-between gap-4",
            activeWorkspacePanel === "catalog" ? "flex" : "hidden lg:flex",
            workspace ? "mb-3" : "mb-6"
          )}
        >
          <div>
            <p
              className={className(
                "ink-kicker flex items-center gap-2 text-acid",
                workspace ? "text-xs" : "text-sm"
              )}
            >
              <DatabaseZap className="h-4 w-4" aria-hidden="true" />
              DATA FIELD / 03
            </p>
            <h2
              className={className(
                "mt-2 font-serif font-semibold text-white",
                workspace ? "text-xl sm:text-2xl" : "text-3xl sm:text-5xl"
              )}
            >
              中美全市场股票行情
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setRefreshToken((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white/68 transition hover:border-acid/50 hover:text-acid"
            >
              <RefreshCw
                className={className("h-4 w-4", quotesLoading && "animate-spin")}
                aria-hidden="true"
              />
              刷新本页
            </button>
            <div
              className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white/58"
              role="status"
              aria-live="polite"
            >
              <Globe2
                className={className(
                  "h-4 w-4",
                  hasDataError ? "text-dangerline" : dataSyncing ? "text-amberline" : "text-acid"
                )}
                aria-hidden="true"
              />
              PUBLIC FEED · {syncStatus}
            </div>
          </div>
        </div>

        <div
          className={className(
            "gap-2 font-mono text-[10px] text-white/46",
            activeWorkspacePanel === "catalog" ? "flex" : "hidden lg:flex",
            workspace ? "mb-3 overflow-x-auto pb-1 thin-scrollbar" : "mb-5 flex-wrap"
          )}
        >
          {[
            ["CATALOG", "CN + US"],
            ["PUBLIC", "3-10s"],
            ["SESSION", "LAST TICK"],
            ["LICENSED", "OPTIONAL"]
          ].map(([label, value]) => (
            <span
              key={label}
              className={className(
                "shrink-0 border border-white/10 bg-white/[0.025] px-3",
                workspace ? "py-1.5" : "py-2"
              )}
            >
              <span className="text-white/72">{label}</span>
              <span className="ml-2 text-white/36">{value}</span>
            </span>
          ))}
        </div>

        {workspace ? (
          <div
            className={className(
              "grid-cols-2 border-y border-white/10 sm:grid-cols-4",
              activeWorkspacePanel === "catalog" ? "grid" : "hidden lg:grid"
            )}
          >
            {metricItems.map(({ icon: Icon, label, value, tone }) => (
              <div
                key={label}
                className="min-w-0 border-b border-r border-white/[0.07] px-3 py-2 even:border-r-0 sm:border-b-0 sm:even:border-r sm:last:border-r-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] text-white/46">{label}</span>
                  <Icon
                    className={className("h-3.5 w-3.5 shrink-0", tone)}
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-1 truncate font-mono text-sm text-white/78">{value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            {metricItems.map((item) => (
              <MetricTile key={item.label} {...item} />
            ))}
          </div>
        )}

        {catalogError || feedError ? (
          <div
            className={className(
              "rounded-[8px] border border-dangerline/40 bg-dangerline/10 p-3 text-sm text-dangerline",
              workspace ? "mt-3" : "mt-5"
            )}
            role="status"
          >
            {[catalogError, feedError].filter(Boolean).join(" / ")}
          </div>
        ) : null}

        <div
          className={className(
            "grid grid-cols-3 border border-white/10 bg-black/20 p-1 lg:hidden",
            workspace ? "mt-3" : "mt-5"
          )}
          role="tablist"
          aria-label="行情工作区视图"
          aria-orientation="horizontal"
        >
          {workspacePanels.map((panel, index) => {
            const Icon = panel.icon;
            const selected = activeWorkspacePanel === panel.id;
            return (
              <button
                key={panel.id}
                ref={(node) => {
                  workspaceTabRefs.current[index] = node;
                }}
                id={`${workspaceTabsId}-${panel.id}-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${workspaceTabsId}-${panel.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectWorkspacePanel(panel.id)}
                onKeyDown={(event) => handleWorkspaceTabKeyDown(event, index)}
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

        <div
          className={className(
            "grid lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.22fr)] 2xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.34fr)_minmax(280px,0.88fr)]",
            workspace ? "mt-3 gap-3" : "mt-5 gap-5"
          )}
        >
          {/* Left Panel: Catalog Browser */}
          <div
            id={`${workspaceTabsId}-catalog-panel`}
            role="tabpanel"
            aria-labelledby={`${workspaceTabsId}-catalog-tab`}
            tabIndex={0}
            className={className(
              "ink-panel min-w-0 p-4 outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
              activeWorkspacePanel === "catalog" ? "block" : "hidden lg:block"
            )}
          >
            <div className="mb-4 flex items-center gap-2 text-sm text-white/62">
              <Layers3 className="h-4 w-4 text-acid" />
              全量证券目录
              <span className="font-mono text-xs text-acid ml-1">
                {catalogLoading ? "加载中..." : `共 ${(catalog?.total ?? 0).toLocaleString()} 只`}
              </span>
              <span
                className={className(
                  "ml-auto hidden max-w-28 truncate font-mono text-[10px] sm:inline",
                  hasDataError
                    ? "text-dangerline"
                    : dataSyncing
                      ? "text-amberline"
                      : "text-acid"
                )}
                title={syncStatus}
              >
                {syncStatus}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              {stockMarketOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => changeMarket(option.id)}
                  aria-pressed={market === option.id}
                  className={className(
                    "rounded-[8px] border px-3 py-2 text-left transition",
                    workspace ? "min-h-12" : "min-h-16",
                    market === option.id
                      ? "border-acid bg-acid/10"
                      : "border-white/10 bg-white/[0.035] hover:border-acid/50"
                  )}
                >
                  <span className="block text-sm text-white">{option.label}</span>
                  <span className="mt-1 block font-mono text-[10px] text-white/38">
                    {option.detail}
                  </span>
                </button>
              ))}
            </div>

            <label className="relative mb-3 block">
              <span className="sr-only">搜索股票代码或名称</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 z-20 h-4 w-4 -translate-y-1/2 text-white/36"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onFocus={() => {
                  if (searchInput.trim() && isSearchableQuery(searchInput)) {
                    setSuggestionsOpen(true);
                  }
                }}
                onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                onKeyDown={handleSearchKeyDown}
                placeholder={market === "CN" ? "代码、中文名或公司名" : "Ticker or company name"}
                className="h-11 w-full rounded-[8px] border border-white/10 bg-black/30 pl-10 pr-3 text-sm text-white placeholder:text-white/28"
              />
              {suggestionsOpen ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[8px] border border-white/10 bg-[#0b0d0f]/95 shadow-2xl backdrop-blur">
                  {suggestionsLoading ? (
                    <div className="grid h-10 place-items-center font-mono text-[10px] tracking-widest text-white/40">
                      SEARCHING...
                    </div>
                  ) : suggestions.length === 0 ? (
                    <div className="grid h-10 place-items-center font-mono text-[10px] tracking-widest text-white/40">
                      没有匹配的股票
                    </div>
                  ) : (
                    <ul className="thin-scrollbar max-h-72 overflow-y-auto">
                      {suggestions.map((suggestion) => (
                        <li key={suggestion.id}>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSuggestion(suggestion)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-acid/10"
                          >
                            <span className="min-w-0">
                              <span className="block font-mono text-sm text-white">
                                {suggestion.symbol}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-white/48">
                                {suggestion.name} / {suggestion.exchange}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[9px] tracking-widest text-white/30">
                              {suggestion.market}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </label>

            <div className="mb-4 flex flex-wrap gap-2">
              {stockExchangeOptions[market].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setExchange(option.id);
                    setPage(1);
                    setSelectedQuoteId("");
                    setActiveWorkspacePanel("catalog");
                    updateWorkspaceUrl({
                      exchange: option.id === "ALL" ? null : option.id,
                      page: null,
                      stock: null,
                      panel: "catalog"
                    });
                  }}
                  aria-pressed={exchange === option.id}
                  className={className(
                    "rounded-[8px] border px-3 py-2 font-mono text-[10px] transition",
                    exchange === option.id
                      ? "border-acid bg-acid/10 text-white"
                      : "border-white/10 bg-white/[0.035] text-white/52 hover:border-acid/50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div
              className={className(
                "grid min-h-48 grid-cols-[minmax(0,1fr)] gap-2 overflow-x-hidden overflow-y-auto pr-1 thin-scrollbar",
                workspace ? "max-h-[28rem] lg:max-h-[calc(100svh-22rem)]" : "max-h-[38rem]"
              )}
            >
              {instruments.map((instrument) => {
                const quote = quoteById.get(instrument.id);
                const watched = watchlistIdSet.has(instrument.id);
                const changePct = quote?.changePct;
                const hasChange =
                  typeof changePct === "number" && Number.isFinite(changePct);
                const hasCurve =
                  Boolean(quote) &&
                  Array.isArray(quote?.series) &&
                  (quote?.series?.length ?? 0) >= 2;
                return (
                  <div
                    key={instrument.id}
                    className={className(
                      "w-full min-w-0 rounded-[8px] border transition",
                      selectedInstrument?.id === instrument.id
                        ? "border-acid bg-acid/10"
                        : "border-white/10 bg-white/[0.035] hover:border-acid/50"
                    )}
                  >
                    <div className="flex items-center gap-3 p-3 pb-2">
                      <button
                        type="button"
                        onClick={() => selectInstrument(instrument.id)}
                        aria-pressed={selectedInstrument?.id === instrument.id}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block font-mono text-base font-semibold tracking-tight text-white">
                          {instrument.symbol}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-white/48">
                          {instrument.name} / {instrument.exchange}
                        </span>
                      </button>
                      <span className="shrink-0 text-right">
                        <span
                          className={className(
                            "block font-mono text-sm font-bold tabular-nums",
                            hasChange
                              ? marketChangeText(market, changePct)
                              : "text-white/38"
                          )}
                        >
                          {hasChange ? (
                            <AnimatedNumber value={changePct} digits={2} signed suffix="%" />
                          ) : (
                            "--"
                          )}
                        </span>
                        <AnimatedNumber
                          value={quote?.price}
                          digits={4}
                          className={className(
                            "mt-0.5 block font-mono text-2xl font-bold tabular-nums",
                            hasChange
                              ? marketChangeText(market, changePct)
                              : "text-white"
                          )}
                        />
                      </span>
                      {onWatchlistAdd && onWatchlistRemove ? (
                        <button
                          type="button"
                          onClick={() => toggleWatchlist(instrument)}
                          aria-pressed={watched}
                          aria-label={`${watched ? "移除" : "添加"} ${instrument.name} 自选`}
                          title={watched ? "移除自选" : "添加自选"}
                          className={className(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border transition",
                            watched
                              ? "border-amberline/45 bg-amberline/10 text-amberline"
                              : "border-white/10 text-white/38 hover:border-amberline/45 hover:text-amberline"
                          )}
                        >
                          <Star
                            className={className("h-4 w-4", watched && "fill-current")}
                            aria-hidden="true"
                          />
                        </button>
                      ) : null}
                    </div>
                    <div className="px-3 pb-3">
                      {hasCurve && quote ? (
                        <IntradaySparkline
                          values={quote.series}
                          baseline={quote.open}
                          riseColor={marketColorPalette(market).riseHex}
                          fallColor={marketColorPalette(market).fallHex}
                          width={480}
                          height={64}
                          className="h-16 w-full"
                          timeAxis={
                            market === "CN"
                              ? [
                                  { label: "09:30", pos: 0 },
                                  { label: "09:45", pos: 6.25 },
                                  { label: "10:00", pos: 12.5 },
                                  { label: "10:15", pos: 18.75 },
                                  { label: "10:30", pos: 25 },
                                  { label: "10:45", pos: 31.25 },
                                  { label: "11:00", pos: 37.5 },
                                  { label: "11:15", pos: 43.75 },
                                  { label: "11:30/13:00", pos: 50 },
                                  { label: "13:15", pos: 56.25 },
                                  { label: "13:30", pos: 62.5 },
                                  { label: "13:45", pos: 68.75 },
                                  { label: "14:00", pos: 75 },
                                  { label: "14:15", pos: 81.25 },
                                  { label: "14:30", pos: 87.5 },
                                  { label: "14:45", pos: 93.75 },
                                  { label: "15:00", pos: 100 }
                                ]
                              : [
                                  { label: "09:30", pos: 0 },
                                  { label: "10:00", pos: 7.69 },
                                  { label: "10:30", pos: 15.38 },
                                  { label: "11:00", pos: 23.08 },
                                  { label: "11:30", pos: 30.77 },
                                  { label: "12:00", pos: 38.46 },
                                  { label: "12:30", pos: 46.15 },
                                  { label: "13:00", pos: 53.85 },
                                  { label: "13:30", pos: 61.54 },
                                  { label: "14:00", pos: 69.23 },
                                  { label: "14:30", pos: 76.92 },
                                  { label: "15:00", pos: 84.62 },
                                  { label: "15:30", pos: 92.31 },
                                  { label: "16:00", pos: 100 }
                                ]
                          }
                        />
                      ) : (
                        <div className="grid h-16 w-full place-items-center rounded-[6px] border border-dashed border-white/10 font-mono text-[10px] text-white/30">
                          {quotesLoading ? "LOADING CURVE..." : "NO CURVE"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!catalogLoading && instruments.length === 0 ? (
                <div className="grid min-h-48 place-items-center rounded-[8px] border border-dashed border-white/10 text-center text-sm text-white/38">
                  没有找到匹配的股票
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                title="上一页"
                aria-label="上一页"
                disabled={currentPage <= 1 || catalogLoading}
                onClick={() => {
                  const nextPage = Math.max(1, currentPage - 1);
                  setPage(nextPage);
                  setSelectedQuoteId("");
                  updateWorkspaceUrl({
                    page: nextPage === 1 ? null : nextPage,
                    stock: null
                  });
                }}
                className="grid h-9 w-9 place-items-center rounded-[8px] border border-white/10 text-white/62 transition hover:border-acid/50 hover:text-acid disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="font-mono text-xs text-white/48">
                {totalPages > 0 ? `${currentPage} / ${totalPages}` : "0 / 0"}
              </span>
              <button
                type="button"
                title="下一页"
                aria-label="下一页"
                disabled={currentPage >= totalPages || catalogLoading}
                onClick={() => {
                  const nextPage = currentPage + 1;
                  setPage(nextPage);
                  setSelectedQuoteId("");
                  updateWorkspaceUrl({ page: nextPage, stock: null });
                }}
                className="grid h-9 w-9 place-items-center rounded-[8px] border border-white/10 text-white/62 transition hover:border-acid/50 hover:text-acid disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Center Panel: Quote Detail + Visualizations */}
          <div
            id={`${workspaceTabsId}-chart-panel`}
            role="tabpanel"
            aria-labelledby={`${workspaceTabsId}-chart-tab`}
            tabIndex={0}
            className={className(
              "ink-panel min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-acid/70",
              workspace ? "p-3 sm:p-4" : "p-4",
              activeWorkspacePanel === "chart" ? "block" : "hidden lg:block"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-white/58 sm:text-xs">
                  {selectedInstrument
                    ? `${selectedInstrument.exchange} / ${selectedInstrument.market} / ${selectedInstrument.securityType}`
                    : "等待证券目录"}
                </p>
                <h3 className="mt-1 break-words text-xl font-semibold text-white sm:mt-2 sm:text-2xl">
                  {selectedInstrument
                    ? `${selectedInstrument.name} ${selectedInstrument.symbol}`
                    : "暂无标的"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-white/68 sm:mt-2 sm:text-sm sm:leading-6">
                  {selectedQuote
                    ? `最新价 ${formatQuoteNumber(selectedQuote.price, 4)} ${selectedQuote.instrument.currency} / 涨跌幅 ${formatPercent(selectedQuote.changePct)}`
                    : selectedInstrument
                      ? "正在加载该股票的最新详细行情"
                      : "请从全量证券目录选择股票"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedInstrument && onWatchlistAdd && onWatchlistRemove ? (
                  <button
                    type="button"
                    onClick={() => toggleWatchlist(selectedInstrument)}
                    aria-pressed={selectedWatched}
                    aria-label={`${selectedWatched ? "移除" : "添加"} ${selectedInstrument.name} 自选`}
                    title={selectedWatched ? "移除自选" : "添加自选"}
                    className={className(
                      "grid h-10 w-10 place-items-center rounded-[6px] border transition",
                      selectedWatched
                        ? "border-amberline/45 bg-amberline/10 text-amberline"
                        : "border-white/10 text-white/48 hover:border-amberline/45 hover:text-amberline"
                    )}
                  >
                    <Star
                      className={className("h-4 w-4", selectedWatched && "fill-current")}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                <span className="rounded-[8px] border border-acid/30 bg-acid/10 px-2.5 py-1.5 font-mono text-[10px] text-acid sm:px-3 sm:py-2 sm:text-xs">
                  {selectedQuote ? quoteStatusLabel(selectedQuote.feedStatus) : quotesLoading ? "LOADING" : "NO FEED"}
                </span>
              </div>
            </div>

            {selectedQuote ? (
              <div
                className={className(
                  "hidden grid-cols-2 gap-2 sm:grid md:grid-cols-4",
                  workspace ? "mt-3" : "mt-5"
                )}
              >
                {[
                  ["OPEN", selectedQuote.open],
                  ["HIGH", selectedQuote.high],
                  ["LOW", selectedQuote.low],
                  ["PREV", selectedQuote.previousClose]
                ].map(([label, value]) => (
                  <div
                    key={label as string}
                    className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3"
                  >
                    <p className="font-mono text-[10px] text-white/60">{label}</p>
                    <p className="mt-2 font-mono text-sm text-white">
                      {formatQuoteNumber(value as number | null, 4)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {selectedInstrument ? (
              <StockChartPanel
                instrument={selectedInstrument}
                marketOpen={isStockMarketOpen(selectedInstrument.market)}
                refreshToken={refreshToken}
                period={chartPeriod}
                onPeriodChange={changeChartPeriod}
              />
            ) : (
              <div className="mt-5 grid min-h-64 place-items-center border-y border-dashed border-white/10 text-sm text-white/38">
                {catalogLoading ? "正在同步证券目录" : "请从全量证券目录选择股票"}
              </div>
            )}

            {/* Order Book Depth */}
            {selectedQuote && (selectedQuote.depth.bids.length > 0 || selectedQuote.depth.asks.length > 0) && (
              <div className="mt-5">
                <DepthChart
                  depth={selectedQuote.depth}
                  currentPrice={selectedQuote.price}
                />
              </div>
            )}
          </div>

          {/* Right Panel: Quote Insights + Statistics */}
          <div
            id={`${workspaceTabsId}-details-panel`}
            role="tabpanel"
            aria-labelledby={`${workspaceTabsId}-details-tab`}
            tabIndex={0}
            className={className(
              "ink-panel min-w-0 p-4 outline-none focus-visible:ring-2 focus-visible:ring-acid/70 lg:col-span-2 2xl:col-span-1",
              activeWorkspacePanel === "details" ? "block" : "hidden lg:block"
            )}
          >
            <div className="flex items-center gap-2 text-sm text-white/62">
              <ScanLine className="h-4 w-4 text-acid" />
              股票详细行情
            </div>
            <h3 className="mt-4 text-xl font-semibold leading-7 text-white">
              {insight?.headline ?? selectedInstrument?.name ?? "等待标的行情"}
            </h3>
            <div className="mt-5 grid gap-2">
              {(insight?.drivers ?? []).map((driver) => (
                <div
                  key={driver}
                  className="rounded-[8px] border border-white/10 bg-white/[0.035] px-3 py-2 text-sm leading-6 text-white/64"
                >
                  {driver}
                </div>
              ))}
            </div>
            {selectedQuote?.statistics ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                {[
                  ["MARKET CAP", `${formatCompact(selectedQuote.statistics.marketCap)} ${selectedQuote.instrument.currency}`],
                  ["FLOAT CAP", `${formatCompact(selectedQuote.statistics.floatMarketCap)} ${selectedQuote.instrument.currency}`],
                  ["PE / TTM", `${formatQuoteNumber(selectedQuote.statistics.peRatio)} / ${formatQuoteNumber(selectedQuote.statistics.peTtm)}`],
                  ["PB", formatQuoteNumber(selectedQuote.statistics.pbRatio)],
                  ["TURNOVER", `${formatQuoteNumber(selectedQuote.statistics.turnoverRate)}%`],
                  ["VOLUME RATIO", formatQuoteNumber(selectedQuote.statistics.volumeRatio)],
                  ["AMPLITUDE", `${formatQuoteNumber(selectedQuote.statistics.amplitude)}%`],
                  ["52W RANGE", `${formatQuoteNumber(selectedQuote.statistics.week52Low)} - ${formatQuoteNumber(selectedQuote.statistics.week52High)}`]
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-white/10 px-1 py-2">
                    <p className="font-mono text-[10px] text-white/34">{label}</p>
                    <p className="mt-1 break-words font-mono text-xs text-white/72">{value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="font-mono text-xs text-amberline">FEED STATUS</p>
              <p className="mt-2 text-sm leading-6 text-white/58">
                {insight?.risk ?? "公开行情尚未返回；证券仍保留在全量目录中。"}
              </p>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="font-mono text-xs text-acid">AS OF</p>
              <p className="mt-2 text-sm leading-6 text-white/58">
                {insight?.nextCheck ?? (lastUpdated ? new Date(lastUpdated).toLocaleString("zh-CN", { hour12: false }) : "--")}
              </p>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="mb-3 font-mono text-xs text-white/42">SECURITY + QUOTE DETAIL</p>
              <div className="grid gap-2">
                {selectedInstrument
                  ? [
                      ["MARKET / EXCHANGE", `${selectedInstrument.market} / ${selectedInstrument.exchange}`],
                      ["SECURITY TYPE", selectedInstrument.securityType],
                      ["SECTOR", selectedInstrument.sector || "--"],
                      ["LIST DATE", selectedInstrument.listDate || "--"],
                      ["PROVIDER", selectedQuote?.instrument.provider || selectedInstrument.provider],
                      ["SOURCE SYMBOL", selectedQuote?.instrument.providerSymbol || selectedInstrument.providerSymbol],
                      ["QUOTE TIME", selectedQuote ? new Date(selectedQuote.timestamp).toLocaleString("zh-CN", { hour12: false }) : "--"],
                      ["MESSAGE", selectedQuote?.providerMessage || "等待按需行情源返回"]
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-[8px] border border-white/10 bg-black/24 p-3"
                      >
                        <p className="font-mono text-xs text-white">{label}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-white/42">{value}</p>
                      </div>
                    ))
                  : null}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[10px] text-white/28">
                <span>{liveCount} LIVE ON PAGE</span>
                <span>{catalog?.catalogAsOf ? `CATALOG ${catalog.catalogAsOf}` : "CATALOG SYNC"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
