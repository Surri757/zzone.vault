import { NextResponse } from "next/server";
import {
  liveInstruments,
  type LiveInstrument,
  type LiveProvider,
  type LiveQuote
} from "@/lib/live-instruments";
import {
  findStockInstrumentsByIds,
  type StockInstrument
} from "@/lib/stock-catalog";
import { fetchLicensedStockQuotes } from "@/lib/licensed-stock-quotes.server";
import { fetchTencentStockQuotes } from "@/lib/tencent-stock-quotes.server";
import { quoteCache } from "@/lib/quote-cache";

// =============================================================================
// Quote resolution pipeline — defaults to FREE PUBLIC feeds.
//
// Tier 1 (optional): Licensed real-time via TUSHARE_TOKEN / MASSIVE_API_KEY.
//   Activated only when token is present in .env.local.
// Tier 2 (default):  Tencent public batch quotes (qt.gtimg.cn, GBK).
// Tier 3 (default):  Sina public quotes (hq.sinajs.cn, GB18030).
// Tier 4 (fallback): Yahoo Finance chart endpoint for US stocks.
//
// Public feeds have ~3-10s delay. No SLA. No redistribution rights.
// Minimum polling interval enforced: 5s during market hours, 60s otherwise.
// =============================================================================

const MAX_IDS_PER_REQUEST = 200;

export const dynamic = "force-dynamic";

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lastNumber(values: Array<number | null | undefined>) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function statusFromTimestamp(timestamp: Date, alwaysLive = false): LiveQuote["feedStatus"] {
  if (alwaysLive) return "LIVE_PUBLIC";

  const ageMs = Date.now() - timestamp.getTime();
  if (ageMs < 1000 * 60 * 8) return "LIVE_PUBLIC";
  return "MARKET_CLOSED_LAST_TICK";
}

function safeDate(input: string) {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function sinaDateTime(date: string, time: string) {
  if (!date || !time) return new Date();
  return safeDate(`${date}T${time}+08:00`);
}

async function fetchBinanceQuote(instrument: LiveInstrument): Promise<LiveQuote> {
  const [tickerResponse, klineResponse] = await Promise.all([
    fetch(
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${instrument.providerSymbol}`,
      { cache: "no-store" }
    ),
    fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${instrument.providerSymbol}&interval=1m&limit=30`,
      { cache: "no-store" }
    )
  ]);

  if (!tickerResponse.ok) throw new Error(`Binance ticker ${tickerResponse.status}`);
  if (!klineResponse.ok) throw new Error(`Binance klines ${klineResponse.status}`);

  const ticker = await tickerResponse.json();
  const klines = (await klineResponse.json()) as unknown[][];
  const price = numberOrNull(ticker.lastPrice);
  const previousClose = numberOrNull(ticker.prevClosePrice);
  const timestamp = new Date(Number(ticker.closeTime));

  return {
    instrument,
    price,
    change: numberOrNull(ticker.priceChange),
    changePct: numberOrNull(ticker.priceChangePercent),
    open: numberOrNull(ticker.openPrice),
    previousClose,
    high: numberOrNull(ticker.highPrice),
    low: numberOrNull(ticker.lowPrice),
    bid: numberOrNull(ticker.bidPrice),
    ask: numberOrNull(ticker.askPrice),
    volume: numberOrNull(ticker.volume),
    turnover: numberOrNull(ticker.quoteVolume),
    timestamp: timestamp.toISOString(),
    feedStatus: "LIVE_PUBLIC",
    providerMessage: "Binance public spot ticker and 1m klines",
    series: klines
      .map((row) => numberOrNull(row[4]))
      .filter((value): value is number => value !== null),
    depth: {
      bids: [{ price: numberOrNull(ticker.bidPrice) ?? 0, size: numberOrNull(ticker.bidQty) ?? 0 }],
      asks: [{ price: numberOrNull(ticker.askPrice) ?? 0, size: numberOrNull(ticker.askQty) ?? 0 }]
    }
  };
}

async function fetchYahooQuote(instrument: LiveInstrument): Promise<LiveQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    instrument.providerSymbol
  )}?interval=1m&range=1d`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) throw new Error(`Yahoo chart ${response.status}`);

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error("Yahoo chart empty result");

  const meta = result.meta ?? {};
  const quote = result.indicators?.quote?.[0] ?? {};
  const closeValues = (quote.close ?? []) as Array<number | null>;
  const highValues = (quote.high ?? []) as Array<number | null>;
  const lowValues = (quote.low ?? []) as Array<number | null>;
  const openValues = (quote.open ?? []) as Array<number | null>;
  const volumeValues = (quote.volume ?? []) as Array<number | null>;
  const price =
    numberOrNull(meta.regularMarketPrice) ??
    lastNumber(closeValues);
  const previousClose =
    numberOrNull(meta.chartPreviousClose) ??
    numberOrNull(meta.previousClose);
  const timestampSeconds = Number(meta.regularMarketTime ?? result.timestamp?.at(-1));
  const timestamp = Number.isFinite(timestampSeconds)
    ? new Date(timestampSeconds * 1000)
    : new Date();
  const change =
    price !== null && previousClose !== null ? Number((price - previousClose).toFixed(6)) : null;
  const changePct =
    change !== null && previousClose ? Number(((change / previousClose) * 100).toFixed(4)) : null;

  return {
    instrument,
    price,
    change,
    changePct,
    open: lastNumber(openValues),
    previousClose,
    high: lastNumber(highValues) ?? numberOrNull(meta.regularMarketDayHigh),
    low: lastNumber(lowValues) ?? numberOrNull(meta.regularMarketDayLow),
    bid: null,
    ask: null,
    volume: lastNumber(volumeValues),
    turnover: null,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Yahoo public chart feed, exchange delay depends on venue and plan",
    series: closeValues.filter((value): value is number => typeof value === "number"),
    depth: {
      bids: [],
      asks: []
    }
  };
}

function parseSinaLines(text: string) {
  const lines: Record<string, string[]> = {};
  const regex = /var hq_str_([^=]+)="([^"]*)";/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    lines[match[1]] = match[2].split(",");
  }

  return lines;
}

function quoteFromSinaStock(instrument: LiveInstrument, fields: string[]): LiveQuote {
  const open = numberOrNull(fields[1]);
  const previousClose = numberOrNull(fields[2]);
  const price = numberOrNull(fields[3]);
  const high = numberOrNull(fields[4]);
  const low = numberOrNull(fields[5]);
  const bid = numberOrNull(fields[6]);
  const ask = numberOrNull(fields[7]);
  const volume = numberOrNull(fields[8]);
  const turnover = numberOrNull(fields[9]);
  const date = fields[30] ?? "";
  const time = fields[31] ?? "";
  const timestamp = sinaDateTime(date, time);
  const change =
    price !== null && previousClose !== null ? Number((price - previousClose).toFixed(4)) : null;
  const changePct =
    change !== null && previousClose ? Number(((change / previousClose) * 100).toFixed(4)) : null;
  const bids = [10, 12, 14, 16, 18].map((sizeIndex) => ({
    size: numberOrNull(fields[sizeIndex]) ?? 0,
    price: numberOrNull(fields[sizeIndex + 1]) ?? 0
  }));
  const asks = [20, 22, 24, 26, 28].map((sizeIndex) => ({
    size: numberOrNull(fields[sizeIndex]) ?? 0,
    price: numberOrNull(fields[sizeIndex + 1]) ?? 0
  }));

  return {
    instrument: { ...instrument, name: fields[0] || instrument.name },
    price,
    change,
    changePct,
    open,
    previousClose,
    high,
    low,
    bid,
    ask,
    volume,
    turnover,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Sina public quote feed for A-share and ETF instruments",
    series: [previousClose, open, low, price, high].filter(
      (value): value is number => value !== null
    ),
    depth: {
      bids,
      asks
    }
  };
}

function quoteFromSinaFuture(instrument: LiveInstrument, fields: string[]): LiveQuote {
  const open = numberOrNull(fields[2]);
  const high = numberOrNull(fields[3]);
  const low = numberOrNull(fields[4]);
  const bid = numberOrNull(fields[6]);
  const ask = numberOrNull(fields[7]);
  const price = numberOrNull(fields[8]) ?? bid ?? ask;
  const previousClose = numberOrNull(fields[10]) || numberOrNull(fields[26]);
  const volume = numberOrNull(fields[13]);
  const openInterest = numberOrNull(fields[14]);
  const date = fields[17] ?? "";
  const timestamp = date ? safeDate(`${date}T15:00:00+08:00`) : new Date();
  const change =
    price !== null && previousClose !== null ? Number((price - previousClose).toFixed(4)) : null;
  const changePct =
    change !== null && previousClose ? Number(((change / previousClose) * 100).toFixed(4)) : null;

  return {
    instrument: {
      ...instrument,
      name: fields[0] || instrument.name,
      exchange: fields[15] || instrument.exchange
    },
    price,
    change,
    changePct,
    open,
    previousClose,
    high,
    low,
    bid,
    ask,
    volume,
    turnover: null,
    openInterest,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Sina public futures quote feed",
    series: [previousClose, open, low, price, high].filter(
      (value): value is number => value !== null
    ),
    depth: {
      bids: [{ price: bid ?? 0, size: numberOrNull(fields[11]) ?? 0 }],
      asks: [{ price: ask ?? 0, size: numberOrNull(fields[12]) ?? 0 }]
    }
  };
}

function quoteFromSinaGlobalStock(instrument: LiveInstrument, fields: string[]): LiveQuote {
  const price = numberOrNull(fields[1]);
  const changePct = numberOrNull(fields[2]);
  const timestamp = fields[3] ? safeDate(`${fields[3].replace(" ", "T")}+08:00`) : new Date();
  const change = numberOrNull(fields[4]);
  const open = numberOrNull(fields[5]);
  const high = numberOrNull(fields[6]);
  const low = numberOrNull(fields[7]);
  const volume = numberOrNull(fields[10]);
  const turnover = price !== null && volume !== null ? Number((price * volume).toFixed(2)) : null;
  const previousClose =
    price !== null && change !== null ? Number((price - change).toFixed(4)) : null;

  return {
    instrument: { ...instrument, name: fields[0] || instrument.name },
    price,
    change,
    changePct,
    open,
    previousClose,
    high,
    low,
    bid: numberOrNull(fields[34]),
    ask: numberOrNull(fields[35]),
    volume,
    turnover,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Sina public global stock and ETF quote feed",
    series: [previousClose, open, low, price, high].filter(
      (value): value is number => value !== null
    ),
    depth: {
      bids: [],
      asks: []
    }
  };
}

function quoteFromSinaGlobalFuture(instrument: LiveInstrument, fields: string[]): LiveQuote {
  const price = numberOrNull(fields[0]);
  const bid = numberOrNull(fields[2]);
  const ask = numberOrNull(fields[3]);
  const high = numberOrNull(fields[4]);
  const low = numberOrNull(fields[5]);
  const previousClose = numberOrNull(fields[7]);
  const open = numberOrNull(fields[8]);
  const date = fields[12] ?? "";
  const time = fields[6] ?? "";
  const timestamp = sinaDateTime(date, time);
  const change =
    price !== null && previousClose !== null ? Number((price - previousClose).toFixed(4)) : null;
  const changePct =
    change !== null && previousClose ? Number(((change / previousClose) * 100).toFixed(4)) : null;

  return {
    instrument: { ...instrument, name: fields[13] || instrument.name },
    price,
    change,
    changePct,
    open,
    previousClose,
    high,
    low,
    bid,
    ask,
    volume: null,
    turnover: null,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Sina public global futures and commodity quote feed",
    series: [previousClose, open, low, price, high].filter(
      (value): value is number => value !== null
    ),
    depth: {
      bids: [{ price: bid ?? 0, size: 0 }],
      asks: [{ price: ask ?? 0, size: 0 }]
    }
  };
}

function quoteFromSinaFx(instrument: LiveInstrument, fields: string[]): LiveQuote {
  const bid = numberOrNull(fields[1]);
  const ask = numberOrNull(fields[2]);
  const price = numberOrNull(fields[3]) ?? bid ?? ask;
  const previousClose = numberOrNull(fields[5]);
  const high = numberOrNull(fields[6]);
  const low = numberOrNull(fields[7]);
  const changePct = numberOrNull(fields[10]);
  const change = numberOrNull(fields[11]);
  const time = fields[0] ?? "";
  const date = fields[17] ?? "";
  const timestamp = sinaDateTime(date, time);

  return {
    instrument: { ...instrument, name: fields[9] || instrument.name },
    price,
    change,
    changePct,
    open: previousClose,
    previousClose,
    high,
    low,
    bid,
    ask,
    volume: numberOrNull(fields[4]),
    turnover: null,
    timestamp: timestamp.toISOString(),
    feedStatus: statusFromTimestamp(timestamp),
    providerMessage: "Sina public FX quote feed",
    series: [previousClose, low, bid, price, ask, high].filter(
      (value): value is number => value !== null
    ),
    depth: {
      bids: [{ price: bid ?? 0, size: 0 }],
      asks: [{ price: ask ?? 0, size: 0 }]
    }
  };
}

async function fetchSinaQuotes(instruments: LiveInstrument[]): Promise<LiveQuote[]> {
  const symbols = instruments.map((instrument) => instrument.providerSymbol).join(",");
  const response = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
    cache: "no-store",
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent": "Mozilla/5.0 Zz.one Vault"
    }
  });

  if (!response.ok) throw new Error(`Sina quote ${response.status}`);

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder("gb18030").decode(buffer);
  const lines = parseSinaLines(text);

  return instruments.map((instrument) => {
    try {
      const fields = lines[instrument.providerSymbol] ?? [];
      if (fields.length === 0) throw new Error(`Sina missing ${instrument.providerSymbol}`);

      if (instrument.providerSymbol.startsWith("nf_")) {
        return quoteFromSinaFuture(instrument, fields);
      }

      if (instrument.providerSymbol.startsWith("gb_")) {
        return quoteFromSinaGlobalStock(instrument, fields);
      }

      if (instrument.providerSymbol.startsWith("hf_")) {
        return quoteFromSinaGlobalFuture(instrument, fields);
      }

      if (instrument.providerSymbol.startsWith("fx_")) {
        return quoteFromSinaFx(instrument, fields);
      }

      return quoteFromSinaStock(instrument, fields);
    } catch (error) {
      return errorQuote(instrument, error);
    }
  });
}

function errorQuote(instrument: LiveInstrument, error: unknown): LiveQuote {
  const message = error instanceof Error ? error.message : String(error);

  return {
    instrument,
    price: null,
    change: null,
    changePct: null,
    open: null,
    previousClose: null,
    high: null,
    low: null,
    bid: null,
    ask: null,
    volume: null,
    turnover: null,
    timestamp: new Date().toISOString(),
    feedStatus: "ERROR",
    providerMessage: message,
    series: [],
    depth: {
      bids: [],
      asks: []
    }
  };
}

function catalogInstrumentToLiveInstrument(instrument: StockInstrument): LiveInstrument {
  return {
    id: instrument.id,
    name: instrument.name,
    symbol: instrument.symbol,
    assetClass: instrument.market === "CN" ? "cn-stock" : "us-stock",
    exchange: instrument.exchange,
    venue: instrument.board ?? instrument.securityType,
    provider: instrument.provider,
    providerSymbol: instrument.providerSymbol,
    currency: instrument.currency,
    unit: "share",
    session: instrument.market === "CN" ? "China A-share" : "US equity"
  };
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size)
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function yahooProviderSymbol(symbol: string) {
  return symbol.replaceAll(".", "-");
}

async function fetchQuotes(instruments: LiveInstrument[]) {
  const providerGroups = instruments.reduce(
    (groups, instrument) => {
      groups[instrument.provider].push(instrument);
      return groups;
    },
    {
      binance: [],
      sina: [],
      tencent: [],
      yahoo: [],
      tushare: [],
      massive: []
    } as Record<LiveProvider, LiveInstrument[]>
  );
  const quotes: LiveQuote[] = [];

  const sinaInstruments = providerGroups.sina ?? [];
  if (sinaInstruments.length > 0) {
    const sinaBatches = await mapWithConcurrency(chunks(sinaInstruments, 40), 3, async (batch) => {
      try {
        return await fetchSinaQuotes(batch);
      } catch (error) {
        return batch.map((instrument) => errorQuote(instrument, error));
      }
    });
    const sinaQuotes = sinaBatches.flat();
    const quotesWithFallback = await mapWithConcurrency(sinaQuotes, 6, async (quote) => {
      if (quote.feedStatus !== "ERROR" || quote.instrument.assetClass !== "us-stock") {
        return quote;
      }

      const fallbackInstrument: LiveInstrument = {
        ...quote.instrument,
        provider: "yahoo",
        providerSymbol: yahooProviderSymbol(quote.instrument.symbol)
      };

      try {
        const fallback = await fetchYahooQuote(fallbackInstrument);
        return {
          ...fallback,
          providerMessage: `Sina unavailable; ${fallback.providerMessage}`
        };
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return errorQuote(quote.instrument, `${quote.providerMessage}; Yahoo fallback: ${message}`);
      }
    });
    quotes.push(...quotesWithFallback);
  }

  const directInstruments = [
    ...(providerGroups.binance ?? []),
    ...(providerGroups.yahoo ?? [])
  ];

  const directQuotes = await mapWithConcurrency(
    directInstruments,
    6,
    async (instrument) => {
      try {
        if (instrument.provider === "binance") return await fetchBinanceQuote(instrument);
        return await fetchYahooQuote(instrument);
      } catch (error) {
        return errorQuote(instrument, error);
      }
    }
  );

  quotes.push(...directQuotes);
  return quotes;
}

export async function GET(request: Request) {
  const idsParameter = new URL(request.url).searchParams.get("ids");
  let instruments = liveInstruments;
  let requestedIds = liveInstruments.map((instrument) => instrument.id);
  let unresolvedIds: string[] = [];
  let licensedQuotes: LiveQuote[] = [];
  let tencentQuotes: LiveQuote[] = [];
  let licensedProviders: Array<"tushare" | "massive"> = [];
  let cachedQuotes: LiveQuote[] = [];

  if (idsParameter !== null) {
    requestedIds = [
      ...new Set(
        idsParameter
          .split(",")
          .map((id) => id.trim().toUpperCase())
          .filter(Boolean)
      )
    ];

    if (requestedIds.length === 0) {
      return NextResponse.json({ error: "ids must contain at least one stock catalog id" }, { status: 400 });
    }
    if (requestedIds.length > MAX_IDS_PER_REQUEST) {
      return NextResponse.json(
        { error: `ids must not contain more than ${MAX_IDS_PER_REQUEST} stock catalog ids` },
        { status: 400 }
      );
    }

    // Check cache first
    const cacheResult = quoteCache.getMany(requestedIds);
    cachedQuotes = [...cacheResult.found.values()];
    const staleIds = cacheResult.missing;

    if (staleIds.length === 0) {
      // All requested IDs are fresh in cache — return immediately
      const quotes = cachedQuotes.sort((left, right) =>
        left.instrument.id.localeCompare(right.instrument.id)
      );
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        source: "cache",
        providers: [...new Set(quotes.map((quote) => quote.instrument.provider))],
        licensedProviders: [],
        requested: requestedIds.length,
        resolved: quotes.length,
        failed: 0,
        resolvedIds: quotes.map((quote) => quote.instrument.id),
        failedIds: [],
        unresolvedIds: [],
        quotes,
      }, {
        headers: { "X-Cache": "HIT" },
      });
    }

    // Only resolve stale IDs through the pipeline
    const staleCatalogInstruments = findStockInstrumentsByIds(staleIds);
    const foundIds = new Set(staleCatalogInstruments.map((instrument) => instrument.id));
    unresolvedIds = staleIds.filter((id) => !foundIds.has(id));

    const licensedResult = await fetchLicensedStockQuotes(staleCatalogInstruments);
    licensedQuotes = licensedResult.quotes;
    licensedProviders = licensedResult.providers;
    // Cache licensed results
    quoteCache.setMany(licensedQuotes);

    try {
      const tencentResult = await fetchTencentStockQuotes(licensedResult.unresolved);
      tencentQuotes = tencentResult.quotes;
      // Cache tencent results
      quoteCache.setMany(tencentQuotes);
      instruments = tencentResult.unresolved.map(catalogInstrumentToLiveInstrument);
    } catch {
      instruments = licensedResult.unresolved.map(catalogInstrumentToLiveInstrument);
    }
  }

  const publicQuotes = await fetchQuotes(instruments);
  // Cache public results
  quoteCache.setMany(publicQuotes);

  const quotes = [...cachedQuotes, ...licensedQuotes, ...tencentQuotes, ...publicQuotes].sort((left, right) =>
    left.instrument.id.localeCompare(right.instrument.id)
  );
  const successfulQuotes = quotes.filter((quote) => quote.feedStatus !== "ERROR");
  const failedQuoteIds = quotes
    .filter((quote) => quote.feedStatus === "ERROR")
    .map((quote) => quote.instrument.id);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    source: licensedProviders.length > 0 ? "licensed-and-public-feeds" : "live-public-feeds",
    providers: [...new Set(quotes.map((quote) => quote.instrument.provider))],
    licensedProviders,
    requested: requestedIds.length,
    resolved: successfulQuotes.length,
    failed: failedQuoteIds.length + unresolvedIds.length,
    resolvedIds: successfulQuotes.map((quote) => quote.instrument.id),
    failedIds: [...failedQuoteIds, ...unresolvedIds],
    unresolvedIds,
    quotes
  }, {
    headers: { "X-Cache": cachedQuotes.length > 0 ? "PARTIAL" : "MISS" },
  });
}
