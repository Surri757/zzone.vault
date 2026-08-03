import "server-only";

import catalogData from "@/data/stock-catalog.json";

export type StockMarket = "CN" | "US";

export type StockProvider = "sina" | "yahoo";

export const STOCK_CATALOG_PAGE_SIZE_MAX = 100;

export interface StockInstrument {
  id: string;
  market: StockMarket;
  exchange: string;
  symbol: string;
  name: string;
  nameEn?: string;
  securityType: string;
  board?: string;
  currency: string;
  provider: StockProvider;
  providerSymbol: string;
  sector?: string;
  listDate?: string;
  source: string;
}

export interface StockCatalogSource {
  id: string;
  name: string;
  url: string;
  asOf?: string;
  count: number;
}

export interface StockCatalogCounts {
  total: number;
  byMarket: Record<StockMarket, number>;
  byExchange: Record<string, number>;
}

export interface StockCatalogResponse {
  items: StockInstrument[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: StockCatalogCounts;
  catalogAsOf: string;
  sources: StockCatalogSource[];
}

export interface SearchStockCatalogOptions {
  market?: StockMarket;
  exchange?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

interface StockCatalogFile {
  catalogAsOf: string;
  sources: StockCatalogSource[];
  items: StockInstrument[];
}

const catalog = catalogData as StockCatalogFile;

if (!catalog.catalogAsOf || !Array.isArray(catalog.sources) || !Array.isArray(catalog.items)) {
  throw new Error("data/stock-catalog.json is malformed; run scripts/refresh-stock-catalog.mjs");
}

function normalizeSearchValue(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

const indexedItems = catalog.items.map((item) => ({
  item,
  searchText: normalizeSearchValue(
    [
      item.id,
      item.symbol,
      item.name,
      item.nameEn,
      item.exchange,
      item.board,
      item.securityType,
      item.sector,
      item.providerSymbol
    ]
      .filter(Boolean)
      .join(" ")
  )
}));

const instrumentsById = new Map(catalog.items.map((item) => [item.id, item]));
const instrumentsByMarket: Record<StockMarket, readonly StockInstrument[]> = {
  CN: catalog.items.filter((item) => item.market === "CN"),
  US: catalog.items.filter((item) => item.market === "US")
};

export const stockCatalogAsOf = catalog.catalogAsOf;
export const stockCatalogSources = catalog.sources;
export const stockCatalogCounts: StockCatalogCounts = catalog.items.reduce<StockCatalogCounts>(
  (counts, item) => {
    counts.total += 1;
    counts.byMarket[item.market] += 1;
    counts.byExchange[item.exchange] = (counts.byExchange[item.exchange] ?? 0) + 1;
    return counts;
  },
  {
    total: 0,
    byMarket: { CN: 0, US: 0 },
    byExchange: {}
  }
);

export function searchStockCatalog(
  options: SearchStockCatalogOptions = {}
): StockCatalogResponse {
  const market = options.market;
  const exchange = options.exchange?.trim().toUpperCase();
  const tokens = normalizeSearchValue(options.q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(
    STOCK_CATALOG_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(options.pageSize ?? 30))
  );

  const matches = indexedItems.filter(({ item, searchText }) => {
    if (market && item.market !== market) return false;
    if (exchange && item.exchange !== exchange) return false;
    return tokens.every((token) => searchText.includes(token));
  });
  const total = matches.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;

  return {
    items: matches.slice(start, start + pageSize).map(({ item }) => item),
    total,
    page,
    pageSize,
    totalPages,
    counts: stockCatalogCounts,
    catalogAsOf: stockCatalogAsOf,
    sources: stockCatalogSources
  };
}

export function findStockInstrumentsByIds(ids: readonly string[]): StockInstrument[] {
  const found: StockInstrument[] = [];
  const seen = new Set<string>();

  for (const rawId of ids) {
    const id = rawId.trim().toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const instrument = instrumentsById.get(id);
    if (instrument) found.push(instrument);
  }

  return found;
}

export function getStockInstrumentsByMarket(
  market: StockMarket
): readonly StockInstrument[] {
  return instrumentsByMarket[market];
}

export const getStockInstrumentsByIds = findStockInstrumentsByIds;
