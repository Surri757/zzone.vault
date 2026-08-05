import "server-only";

import {
  getStockInstrumentsByMarket,
  type StockInstrument,
  type StockMarket,
} from "@/lib/stock-catalog";

export interface TopMover {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  changePct: number;
  price: number | null;
}

type MarketSnapshotFeedStatus =
  | "LIVE_PUBLIC"
  | "DELAYED_PUBLIC"
  | "MARKET_CLOSED_LAST_TICK";

interface MarketSnapshotMetadata {
  generatedAt: string;
  dataAsOf: string;
  sourceLabel: string;
  feedStatus: MarketSnapshotFeedStatus;
  providerMessage: string;
  catalogTotal: number;
  providerTotal: number;
  totalWithQuotes: number;
  coverageRatio: number;
  coverageLevel: "FULL" | "PARTIAL";
  stale: boolean;
}

export interface MarketMoversResponse extends MarketSnapshotMetadata {
  market: StockMarket;
  topGainers: TopMover[];
  topLosers: TopMover[];
  advancing: number;
  declining: number;
  unchanged: number;
  avgChangePct: number;
}

export interface SectorAggregate {
  sector: string;
  stockCount: number;
  avgChangePct: number;
  advancing: number;
  declining: number;
}

export interface SectorHeatmapResponse extends MarketSnapshotMetadata {
  market: StockMarket;
  sectors: SectorAggregate[];
}

export interface SectorStrengthConstituent {
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

export interface SectorStrengthComponent {
  rawValue: number;
  percentileScore: number;
  coefficient: number;
}

export interface SectorStrengthAggregate {
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

export interface SectorStrengthResponse extends MarketSnapshotMetadata {
  market: StockMarket;
  source: string;
  asOf: string;
  coverage: number;
  methodology: {
    version: "sector-strength-v1";
    taxonomy: string;
    constituentWeightFormula: string;
    scoreFormula: string;
    percentileRange: readonly [-100, 100];
    topConstituentLimit: 8;
    unclassifiedExcludedFromRanking: true;
    missingWeightBasisFallback: string;
  };
  rankedSectorCount: number;
  unclassifiedStockCount: number;
  sectors: SectorStrengthAggregate[];
}

export interface MarketBreadthResponse extends MarketSnapshotMetadata {
  market: StockMarket;
  advancing: number;
  declining: number;
  unchanged: number;
  upVolume: number;
  downVolume: number;
  totalVolume: number;
  newHighs: number | null;
  newLows: number | null;
  advDeclRatio: number;
  volumeRatio: number;
}

type EastmoneyRow = {
  f2?: unknown;
  f3?: unknown;
  f5?: unknown;
  f6?: unknown;
  f12?: unknown;
  f13?: unknown;
  f14?: unknown;
  f15?: unknown;
  f16?: unknown;
  f17?: unknown;
  f18?: unknown;
  f20?: unknown;
  f100?: unknown;
  f124?: unknown;
};

type SnapshotIssue = {
  instrument: StockInstrument;
  name: string;
  sector: string;
  changePct: number;
  price: number | null;
  volume: number | null;
  turnover: number | null;
  marketCap: number | null;
};

type MarketSnapshot = MarketSnapshotMetadata & {
  market: StockMarket;
  issues: SnapshotIssue[];
};

type SnapshotCacheEntry = {
  snapshot: MarketSnapshot;
  expiresAt: number;
};

type WeightedSectorIssue = {
  issue: SnapshotIssue;
  weight: number;
};

type SectorStrengthDraft = {
  sector: string;
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
  weightedIssues: WeightedSectorIssue[];
};

// Eastmoney's clist `pz` is silently capped at 100 rows/page, so walking the
// full CN universe (~5889 rows) needs ~59 pages — well over Cloudflare's
// default 50-subrequest cap on the free plan. Instead we fetch exactly the
// catalog instruments via the bulk `ulist.np/get` endpoint, batching secids
// so the total subrequest count stays under the cap (CN ~37, US ~41 at the
// batch size below).
const EASTMONEY_ULIST_BATCH = 150;
const EASTMONEY_CONCURRENCY = 8;
const EASTMONEY_FIELDS = [
  "f2",
  "f3",
  "f5",
  "f6",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f20",
  "f100",
  "f124",
].join(",");
// Eastmoney `secids` use a numeric market prefix + security code.
// CN: 1 = Shanghai, 0 = Shenzhen/Beijing. US: 105 = NASDAQ, 106 = NYSE,
// 107 = AMEX (ARCX/BATS route through it).
const EASTMONEY_MARKET_PREFIX: Record<string, string> = {
  XSHG: "1",
  XSHE: "0",
  XBSE: "0",
  XNAS: "105",
  XNYS: "106",
  XASE: "107",
  ARCX: "107",
  BATS: "107",
};
const UNCLASSIFIED_SECTOR = "未分类";
const TOP_SECTOR_CONSTITUENT_LIMIT = 8;
const SECTOR_SCORE_COEFFICIENTS = {
  priceMomentum: 0.55,
  breadth: 0.25,
  turnoverDirection: 0.2,
} as const;
const snapshotCache = new Map<StockMarket, SnapshotCacheEntry>();
const snapshotInFlight = new Map<StockMarket, Promise<MarketSnapshot>>();

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function sectorValue(value: unknown) {
  const sector = stringValue(value);
  return sector && sector !== "-" ? sector : UNCLASSIFIED_SECTOR;
}

function marketScheduledOpen(market: StockMarket, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market === "CN" ? "Asia/Shanghai" : "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((record, part) => {
      if (part.type !== "literal") record[part.type] = part.value;
      return record;
    }, {});

  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (market === "US") return minutes >= 570 && minutes < 960;
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

function cacheTtl(market: StockMarket) {
  return marketScheduledOpen(market) ? 30_000 : 5 * 60_000;
}

function symbolAliases(value: string) {
  const symbol = value.trim().toUpperCase();
  return [...new Set([symbol, symbol.replaceAll("-", "."), symbol.replaceAll(".", "-")])];
}

function catalogBySymbol(instruments: readonly StockInstrument[]) {
  const index = new Map<string, StockInstrument>();
  for (const instrument of instruments) {
    for (const alias of symbolAliases(instrument.symbol)) {
      if (!index.has(alias)) index.set(alias, instrument);
    }
  }
  return index;
}

function secidForInstrument(instrument: StockInstrument) {
  const market = EASTMONEY_MARKET_PREFIX[instrument.exchange];
  if (!market) return null;
  return `${market}.${instrument.symbol}`;
}

async function fetchEastmoneyUlistBatch(secids: string[], preferredHost?: string) {
  const hosts = [
    ...new Set([
      preferredHost,
      "https://push2.eastmoney.com",
      "https://82.push2.eastmoney.com",
      "https://push2delay.eastmoney.com",
    ].filter((host): host is string => Boolean(host))),
  ];
  let lastFailure = "unknown provider failure";

  for (const host of hosts) {
    try {
      const url = new URL("/api/qt/ulist.np/get", host);
      url.searchParams.set("secids", secids.join(","));
      url.searchParams.set("fltt", "2");
      url.searchParams.set("invt", "2");
      url.searchParams.set("fields", EASTMONEY_FIELDS);

      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as {
        data?: { diff?: EastmoneyRow[] | Record<string, EastmoneyRow> } | null;
      };
      const data = payload.data;
      if (!data) throw new Error("empty market snapshot payload");
      const rows = Array.isArray(data.diff)
        ? data.diff
        : Object.values(data.diff ?? {});
      if (rows.length === 0) throw new Error("market snapshot returned no rows");
      return { rows, host };
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Eastmoney bulk quote failed: ${lastFailure}`);
}

// Fetch quotes for exactly the catalog instruments, batching secid lists so
// the per-invocation subrequest count stays under Cloudflare's cap.
async function fetchCatalogQuotes(instruments: readonly StockInstrument[]) {
  const secidBatches: string[][] = [];
  let batch: string[] = [];
  for (const instrument of instruments) {
    const secid = secidForInstrument(instrument);
    if (!secid) continue;
    batch.push(secid);
    if (batch.length >= EASTMONEY_ULIST_BATCH) {
      secidBatches.push(batch);
      batch = [];
    }
  }
  if (batch.length > 0) secidBatches.push(batch);

  const rows: EastmoneyRow[] = [];
  let providerHost = "https://push2.eastmoney.com";
  let nextBatch = 0;
  let failedBatches = 0;

  async function worker() {
    while (nextBatch < secidBatches.length) {
      const index = nextBatch;
      nextBatch += 1;
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await fetchEastmoneyUlistBatch(secidBatches[index], providerHost);
          providerHost = result.host;
          rows.push(...result.rows);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError !== undefined) failedBatches += 1;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(EASTMONEY_CONCURRENCY, secidBatches.length) },
      () => worker()
    )
  );

  // A transient batch failure just drops those instruments (lower coverage)
  // rather than 502-ing the whole request, but a fully empty result means the
  // provider is unreachable.
  if (rows.length === 0) {
    throw new Error(
      `Eastmoney bulk quote returned no data (${failedBatches}/${secidBatches.length} batches failed)`
    );
  }
  return { providerTotal: rows.length, rows, providerHost };
}

async function fetchFreshMarketSnapshot(market: StockMarket): Promise<MarketSnapshot> {
  const instruments = getStockInstrumentsByMarket(market);
  const symbolIndex = catalogBySymbol(instruments);
  const { providerTotal, rows, providerHost } = await fetchCatalogQuotes(instruments);
  const issuesById = new Map<string, SnapshotIssue>();
  let latestTimestamp = 0;

  for (const row of rows) {
    const providerSymbol = stringValue(row.f12);
    const instrument = symbolAliases(providerSymbol)
      .map((alias) => symbolIndex.get(alias))
      .find((candidate): candidate is StockInstrument => Boolean(candidate));
    const changePct = numberValue(row.f3);
    if (!instrument || changePct === null) continue;

    const timestamp = numberValue(row.f124);
    if (timestamp !== null) latestTimestamp = Math.max(latestTimestamp, timestamp * 1000);
    issuesById.set(instrument.id, {
      instrument,
      name: stringValue(row.f14) || instrument.name,
      sector: sectorValue(row.f100),
      changePct,
      price: numberValue(row.f2),
      volume: numberValue(row.f5),
      turnover: numberValue(row.f6),
      marketCap: numberValue(row.f20),
    });
  }

  const issues = [...issuesById.values()];
  if (issues.length === 0) throw new Error("market snapshot did not match the stock catalog");
  const coverageRatio = instruments.length > 0 ? issues.length / instruments.length : 0;
  const generatedAt = new Date().toISOString();
  const scheduledOpen = marketScheduledOpen(market);
  const delayedHost = providerHost.includes("push2delay");
  const feedStatus: MarketSnapshotFeedStatus = scheduledOpen
    ? market === "US" || delayedHost
      ? "DELAYED_PUBLIC"
      : "LIVE_PUBLIC"
    : "MARKET_CLOSED_LAST_TICK";

  return {
    market,
    issues,
    generatedAt,
    dataAsOf: latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : generatedAt,
    sourceLabel: delayedHost
      ? "EASTMONEY PUBLIC DELAYED SNAPSHOT"
      : "EASTMONEY PUBLIC MARKET SNAPSHOT",
    feedStatus,
    providerMessage:
      market === "US"
        ? "Eastmoney public US market snapshot; quotes may be delayed by about 15 minutes and have no SLA"
        : delayedHost
          ? "Eastmoney public delayed A-share snapshot; delay, availability and redistribution rights have no SLA"
        : "Eastmoney public A-share market snapshot; timing, availability and redistribution rights are unspecified",
    catalogTotal: instruments.length,
    providerTotal,
    totalWithQuotes: issues.length,
    coverageRatio,
    coverageLevel: coverageRatio >= 0.9 ? "FULL" : "PARTIAL",
    stale: false,
  };
}

async function getMarketSnapshot(market: StockMarket) {
  const cached = snapshotCache.get(market);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const running = snapshotInFlight.get(market);
  if (running) return running;

  const request = fetchFreshMarketSnapshot(market)
    .then((snapshot) => {
      snapshotCache.set(market, {
        snapshot,
        expiresAt: Date.now() + cacheTtl(market),
      });
      return snapshot;
    })
    .catch((error) => {
      if (!cached) throw error;
      const staleSnapshot: MarketSnapshot = {
        ...cached.snapshot,
        stale: true,
        providerMessage: `${cached.snapshot.providerMessage}; refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      snapshotCache.set(market, {
        snapshot: staleSnapshot,
        expiresAt: Date.now() + 15_000,
      });
      return staleSnapshot;
    })
    .finally(() => snapshotInFlight.delete(market));

  snapshotInFlight.set(market, request);
  return request;
}

function metadata(snapshot: MarketSnapshot): MarketSnapshotMetadata {
  return {
    generatedAt: snapshot.generatedAt,
    dataAsOf: snapshot.dataAsOf,
    sourceLabel: snapshot.sourceLabel,
    feedStatus: snapshot.feedStatus,
    providerMessage: snapshot.providerMessage,
    catalogTotal: snapshot.catalogTotal,
    providerTotal: snapshot.providerTotal,
    totalWithQuotes: snapshot.totalWithQuotes,
    coverageRatio: snapshot.coverageRatio,
    coverageLevel: snapshot.coverageLevel,
    stale: snapshot.stale,
  };
}

export async function getMarketMovers(
  market: StockMarket,
  limit = 20
): Promise<MarketMoversResponse> {
  const snapshot = await getMarketSnapshot(market);
  const sorted = [...snapshot.issues].sort((left, right) => right.changePct - left.changePct);
  const topGainers = sorted
    .filter((issue) => issue.changePct > 0)
    .slice(0, limit)
    .map((issue) => ({
      id: issue.instrument.id,
      symbol: issue.instrument.symbol,
      name: issue.name,
      exchange: issue.instrument.exchange,
      changePct: issue.changePct,
      price: issue.price,
    }));
  const topLosers = sorted
    .filter((issue) => issue.changePct < 0)
    .slice(-limit)
    .reverse()
    .map((issue) => ({
      id: issue.instrument.id,
      symbol: issue.instrument.symbol,
      name: issue.name,
      exchange: issue.instrument.exchange,
      changePct: issue.changePct,
      price: issue.price,
    }));
  const advancing = snapshot.issues.filter((issue) => issue.changePct > 0).length;
  const declining = snapshot.issues.filter((issue) => issue.changePct < 0).length;
  const unchanged = snapshot.issues.length - advancing - declining;
  const totalChange = snapshot.issues.reduce((sum, issue) => sum + issue.changePct, 0);

  return {
    market,
    ...metadata(snapshot),
    topGainers,
    topLosers,
    advancing,
    declining,
    unchanged,
    avgChangePct: totalChange / snapshot.issues.length,
  };
}

export async function getSectorHeatmap(
  market: StockMarket
): Promise<SectorHeatmapResponse> {
  const snapshot = await getMarketSnapshot(market);
  const groups = new Map<
    string,
    { sector: string; stockCount: number; totalChange: number; advancing: number; declining: number }
  >();

  for (const issue of snapshot.issues) {
    const group = groups.get(issue.sector) ?? {
      sector: issue.sector,
      stockCount: 0,
      totalChange: 0,
      advancing: 0,
      declining: 0,
    };
    group.stockCount += 1;
    group.totalChange += issue.changePct;
    if (issue.changePct > 0) group.advancing += 1;
    if (issue.changePct < 0) group.declining += 1;
    groups.set(issue.sector, group);
  }

  const sectors = [...groups.values()]
    .map(({ totalChange, ...group }) => ({
      ...group,
      avgChangePct: totalChange / group.stockCount,
    }))
    .sort((left, right) => Math.abs(right.avgChangePct) - Math.abs(left.avgChangePct));

  return {
    market,
    ...metadata(snapshot),
    sectors,
  };
}

function positiveValue(value: number | null) {
  return value !== null && value > 0 ? value : 0;
}

function buildSectorStrengthDraft(
  sector: string,
  issues: SnapshotIssue[]
): SectorStrengthDraft {
  const stockCount = issues.length;
  const totalMarketCap = issues.reduce(
    (sum, issue) => sum + positiveValue(issue.marketCap),
    0
  );
  const totalTurnover = issues.reduce(
    (sum, issue) => sum + positiveValue(issue.turnover),
    0
  );
  const rawWeights = issues.map((issue) => {
    const marketCapShare =
      totalMarketCap > 0 ? positiveValue(issue.marketCap) / totalMarketCap : 0;
    const turnoverShare =
      totalTurnover > 0 ? positiveValue(issue.turnover) / totalTurnover : 0;
    return (
      0.65 * marketCapShare +
      0.35 * turnoverShare
    );
  });
  const rawWeightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const equalWeight = stockCount > 0 ? 1 / stockCount : 0;
  const weightedIssues = issues.map((issue, index) => ({
    issue,
    weight:
      rawWeightTotal > 0 ? rawWeights[index] / rawWeightTotal : equalWeight,
  }));
  const advancing = issues.filter((issue) => issue.changePct > 0).length;
  const declining = issues.filter((issue) => issue.changePct < 0).length;
  const unchanged = stockCount - advancing - declining;
  const weightedChangePct = weightedIssues.reduce(
    (sum, member) => sum + member.weight * member.issue.changePct,
    0
  );
  const turnoverWeightedDirection =
    totalTurnover > 0
      ? issues.reduce(
          (sum, issue) =>
            sum +
            (positiveValue(issue.turnover) / totalTurnover) *
              Math.sign(issue.changePct),
          0
        )
      : 0;

  return {
    sector,
    stockCount,
    advancing,
    declining,
    unchanged,
    totalMarketCap,
    totalTurnover,
    marketCapCoverage:
      stockCount > 0
        ? issues.filter((issue) => positiveValue(issue.marketCap) > 0).length /
          stockCount
        : 0,
    turnoverCoverage:
      stockCount > 0
        ? issues.filter((issue) => positiveValue(issue.turnover) > 0).length /
          stockCount
        : 0,
    weightedChangePct,
    breadthRatio: stockCount > 0 ? (advancing - declining) / stockCount : 0,
    turnoverWeightedDirection,
    weightedIssues,
  };
}

function percentileScores(
  sectors: SectorStrengthDraft[],
  value: (sector: SectorStrengthDraft) => number
) {
  const sorted = sectors
    .map((sector) => ({ sector: sector.sector, value: value(sector) }))
    .sort(
      (left, right) =>
        left.value - right.value || left.sector.localeCompare(right.sector, "zh-CN")
    );
  const scores = new Map<string, number>();

  if (sorted.length === 1) {
    scores.set(sorted[0].sector, 0);
    return scores;
  }

  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[start].value) {
      end += 1;
    }

    const averagePosition = (start + end) / 2;
    const percentileScore =
      sorted.length > 1
        ? (averagePosition / (sorted.length - 1)) * 200 - 100
        : 0;
    for (let index = start; index <= end; index += 1) {
      scores.set(sorted[index].sector, percentileScore);
    }
    start = end + 1;
  }

  return scores;
}

export async function getSectorStrength(
  market: StockMarket
): Promise<SectorStrengthResponse> {
  const snapshot = await getMarketSnapshot(market);
  const groupedIssues = new Map<string, SnapshotIssue[]>();

  for (const issue of snapshot.issues) {
    const issues = groupedIssues.get(issue.sector) ?? [];
    issues.push(issue);
    groupedIssues.set(issue.sector, issues);
  }

  const unclassifiedStockCount = groupedIssues.get(UNCLASSIFIED_SECTOR)?.length ?? 0;
  const rankableSectors = [...groupedIssues.entries()]
    .filter(([sector]) => sector !== UNCLASSIFIED_SECTOR)
    .map(([sector, issues]) => buildSectorStrengthDraft(sector, issues));
  const priceMomentumScores = percentileScores(
    rankableSectors,
    (sector) => sector.weightedChangePct
  );
  const breadthScores = percentileScores(
    rankableSectors,
    (sector) => sector.breadthRatio
  );
  const turnoverDirectionScores = percentileScores(
    rankableSectors,
    (sector) => sector.turnoverWeightedDirection
  );

  const sectors = rankableSectors
    .map((sector) => {
      const priceMomentumScore = priceMomentumScores.get(sector.sector) ?? 0;
      const breadthScore = breadthScores.get(sector.sector) ?? 0;
      const turnoverDirectionScore =
        turnoverDirectionScores.get(sector.sector) ?? 0;
      const score =
        SECTOR_SCORE_COEFFICIENTS.priceMomentum * priceMomentumScore +
        SECTOR_SCORE_COEFFICIENTS.breadth * breadthScore +
        SECTOR_SCORE_COEFFICIENTS.turnoverDirection * turnoverDirectionScore;
      const topConstituents = [...sector.weightedIssues]
        .sort(
          (left, right) =>
            right.weight - left.weight ||
            left.issue.instrument.symbol.localeCompare(right.issue.instrument.symbol)
        )
        .slice(0, TOP_SECTOR_CONSTITUENT_LIMIT)
        .map(({ issue, weight }) => ({
          id: issue.instrument.id,
          symbol: issue.instrument.symbol,
          name: issue.name,
          exchange: issue.instrument.exchange,
          price: issue.price,
          changePct: issue.changePct,
          weight,
          contribution: weight * issue.changePct,
          marketCap: issue.marketCap,
          turnover: issue.turnover,
        }));

      return {
        sector: sector.sector,
        rank: 0,
        score,
        stockCount: sector.stockCount,
        advancing: sector.advancing,
        declining: sector.declining,
        unchanged: sector.unchanged,
        totalMarketCap: sector.totalMarketCap,
        totalTurnover: sector.totalTurnover,
        marketCapCoverage: sector.marketCapCoverage,
        turnoverCoverage: sector.turnoverCoverage,
        weightedChangePct: sector.weightedChangePct,
        breadthRatio: sector.breadthRatio,
        turnoverWeightedDirection: sector.turnoverWeightedDirection,
        components: {
          priceMomentum: {
            rawValue: sector.weightedChangePct,
            percentileScore: priceMomentumScore,
            coefficient: SECTOR_SCORE_COEFFICIENTS.priceMomentum,
          },
          breadth: {
            rawValue: sector.breadthRatio,
            percentileScore: breadthScore,
            coefficient: SECTOR_SCORE_COEFFICIENTS.breadth,
          },
          turnoverDirection: {
            rawValue: sector.turnoverWeightedDirection,
            percentileScore: turnoverDirectionScore,
            coefficient: SECTOR_SCORE_COEFFICIENTS.turnoverDirection,
          },
        },
        topConstituents,
      } satisfies SectorStrengthAggregate;
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.weightedChangePct - left.weightedChangePct ||
        left.sector.localeCompare(right.sector, "zh-CN")
    )
    .map((sector, index) => ({ ...sector, rank: index + 1 }));
  const snapshotMetadata = metadata(snapshot);

  return {
    market,
    ...snapshotMetadata,
    source: snapshotMetadata.sourceLabel,
    asOf: snapshotMetadata.dataAsOf,
    coverage: snapshotMetadata.coverageRatio,
    methodology: {
      version: "sector-strength-v1",
      taxonomy: "Eastmoney f100 provider industry classification",
      constituentWeightFormula:
        "weight_i = normalize(0.65 * marketCapShare_i + 0.35 * turnoverShare_i)",
      scoreFormula:
        "score = 0.55 * P(weightedDailyPriceMomentum) + 0.25 * P(advanceDeclineBreadth) + 0.20 * P(turnoverWeightedDirection); P maps cross-sector percentiles to [-100, 100]",
      percentileRange: [-100, 100],
      topConstituentLimit: TOP_SECTOR_CONSTITUENT_LIMIT,
      unclassifiedExcludedFromRanking: true,
      missingWeightBasisFallback:
        "Each unavailable basis contributes zero before normalization; equal weights are used only when both sector market cap and turnover are unavailable",
    },
    rankedSectorCount: sectors.length,
    unclassifiedStockCount,
    sectors,
  };
}

export async function getMarketBreadth(
  market: StockMarket
): Promise<MarketBreadthResponse> {
  const snapshot = await getMarketSnapshot(market);
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let upVolume = 0;
  let downVolume = 0;

  for (const issue of snapshot.issues) {
    if (issue.changePct > 0) {
      advancing += 1;
      upVolume += issue.volume ?? 0;
    } else if (issue.changePct < 0) {
      declining += 1;
      downVolume += issue.volume ?? 0;
    } else {
      unchanged += 1;
    }
  }

  const totalVolume = upVolume + downVolume;
  return {
    market,
    ...metadata(snapshot),
    advancing,
    declining,
    unchanged,
    upVolume,
    downVolume,
    totalVolume,
    // The public market-list snapshot has no trustworthy 52-week extrema field.
    newHighs: null,
    newLows: null,
    advDeclRatio: advancing / Math.max(1, declining),
    volumeRatio: upVolume / Math.max(1, downVolume),
  };
}
