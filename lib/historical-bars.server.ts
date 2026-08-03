import "server-only";

import type { StockInstrument, StockMarket } from "@/lib/stock-catalog";
import type {
  OHLCBar,
  StockBarInterval,
  StockBarsResult,
  StockChartPeriod,
  StockMarketState,
} from "@/lib/stock-bars";

type PeriodConfig = {
  interval: StockBarInterval;
  limit: number;
  yahooRange: string;
  tencentType: "m1" | "m5" | "day" | "month";
};

const PERIOD_CONFIG: Record<StockChartPeriod, PeriodConfig> = {
  intraday: {
    interval: "1m",
    // A full regular US session contains 390 one-minute bars. Keep a little
    // headroom so the session filter can always retain the complete day.
    limit: 480,
    yahooRange: "1d",
    tencentType: "m1",
  },
  "five-day": {
    interval: "5m",
    limit: 500,
    yahooRange: "5d",
    tencentType: "m5",
  },
  daily: {
    interval: "1d",
    limit: 250,
    yahooRange: "1y",
    tencentType: "day",
  },
  monthly: {
    interval: "1mo",
    limit: 120,
    yahooRange: "10y",
    tencentType: "month",
  },
};

type CacheEntry = {
  result: StockBarsResult;
  expiresAt: number;
};

const barsCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StockBarsResult>>();

function marketTimeZone(market: StockMarket) {
  return market === "CN" ? "Asia/Shanghai" : "America/New_York";
}

function marketState(
  market: StockMarket,
  date = new Date(),
  bars: OHLCBar[] = [],
  interval?: StockBarInterval
): StockMarketState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: marketTimeZone(market),
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

  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "CLOSED";

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const scheduledState =
    market === "US"
      ? minutes >= 570 && minutes < 960
        ? "OPEN"
        : "CLOSED"
      : (minutes >= 570 && minutes < 690) ||
          (minutes >= 780 && minutes < 900)
        ? "OPEN"
        : minutes >= 690 && minutes < 780
          ? "BREAK"
          : "CLOSED";

  if (scheduledState !== "OPEN" || bars.length === 0) return scheduledState;

  // A weekday clock alone incorrectly marks exchange holidays as live. A real
  // bar from today's exchange session is required before exposing OPEN.
  const today = sessionDate(date.toISOString(), market);
  const latestBar = bars.at(-1);
  const latestSession = sessionDate(latestBar?.t ?? "", market);
  if (latestSession !== today) return "CLOSED";

  if ((interval === "1m" || interval === "5m") && latestBar) {
    const ageMs = date.getTime() - Date.parse(latestBar.t);
    const freshnessWindowMs = interval === "1m" ? 5 * 60_000 : 10 * 60_000;
    if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > freshnessWindowMs) {
      return "DELAYED";
    }
  }

  return "OPEN";
}

function tencentSymbol(instrument: StockInstrument) {
  if (instrument.exchange === "XSHG") return `sh${instrument.symbol}`;
  if (instrument.exchange === "XBSE") return `bj${instrument.symbol}`;
  return `sz${instrument.symbol}`;
}

function yahooSymbol(instrument: StockInstrument) {
  if (instrument.market === "CN") {
    const suffix =
      instrument.exchange === "XSHG"
        ? "SS"
        : instrument.exchange === "XBSE"
          ? "BJ"
          : "SZ";
    return `${instrument.symbol}.${suffix}`;
  }
  return instrument.symbol.replaceAll(".", "-");
}

function eastmoneySymbol(instrument: StockInstrument) {
  if (instrument.market === "CN") {
    return `${instrument.exchange === "XSHG" ? "1" : "0"}.${instrument.symbol}`;
  }

  const marketCode =
    instrument.exchange === "XNAS"
      ? "105"
      : instrument.exchange === "XNYS"
        ? "106"
        : "107";
  return `${marketCode}.${instrument.symbol}`;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function marketNumberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cnTimestamp(raw: unknown, minute: boolean) {
  const value = String(raw ?? "").trim();
  if (minute && /^\d{12}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(
      8,
      10
    )}:${value.slice(10, 12)}:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T15:00:00+08:00`;
  return "";
}

function isRegularCnMinute(timestamp: string) {
  const match = timestamp.match(/T(\d{2}):(\d{2}):/);
  if (!match) return false;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

function parseTencentRows(rows: unknown, interval: StockBarInterval) {
  if (!Array.isArray(rows)) return [];

  const minute = interval === "1m" || interval === "5m";
  const bars: OHLCBar[] = [];
  for (const rawRow of rows) {
    if (!Array.isArray(rawRow) || rawRow.length < 6) continue;

    const rawTimestamp = cnTimestamp(rawRow[0], minute);
    // Tencent's one-minute series includes the 09:30 opening-auction point,
    // while five-minute bars are labelled by bucket end (09:35 = 09:30-09:35).
    // Only the five-minute series needs shifting to the interval-start contract.
    const timestamp =
      interval === "5m" && rawTimestamp
        ? new Date(Date.parse(rawTimestamp) - 5 * 60_000).toISOString()
        : rawTimestamp;
    const open = numberValue(rawRow[1]);
    const close = numberValue(rawRow[2]);
    const high = numberValue(rawRow[3]);
    const low = numberValue(rawRow[4]);
    const volume = numberValue(rawRow[5]) ?? 0;

    if (
      !timestamp ||
      (minute && !isRegularCnMinute(rawTimestamp)) ||
      open === null ||
      close === null ||
      high === null ||
      low === null
    ) {
      continue;
    }

    // Tencent reports A-share volume in lots; the public chart contract uses shares.
    bars.push({ t: timestamp, o: open, h: high, l: low, c: close, v: volume * 100 });
  }
  return bars;
}

function normalizeBars(bars: OHLCBar[], limit: number) {
  const byTimestamp = new Map<string, OHLCBar>();
  for (const bar of bars) {
    if (
      !bar.t ||
      !Number.isFinite(Date.parse(bar.t)) ||
      ![bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite)
    ) {
      continue;
    }
    byTimestamp.set(bar.t, bar);
  }

  return [...byTimestamp.values()]
    .sort((left, right) => Date.parse(left.t) - Date.parse(right.t))
    .slice(-limit);
}

function sessionDate(timestamp: string, market: StockMarket) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: marketTimeZone(market),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(timestamp))
    .reduce<Record<string, string>>((record, part) => {
      if (part.type !== "literal") record[part.type] = part.value;
      return record;
    }, {});
  return `${values.year}-${values.month}-${values.day}`;
}

function limitTradingSessions(
  bars: OHLCBar[],
  period: StockChartPeriod,
  market: StockMarket
) {
  if (period !== "intraday" && period !== "five-day") return bars;
  const sessionCount = period === "intraday" ? 1 : 5;
  const sessions = [...new Set(bars.map((bar) => sessionDate(bar.t, market)))];
  const visibleSessions = new Set(sessions.slice(-sessionCount));
  return bars.filter((bar) => visibleSessions.has(sessionDate(bar.t, market)));
}

async function fetchTencentBars(instrument: StockInstrument, config: PeriodConfig) {
  const symbol = tencentSymbol(instrument);
  const minute = config.tencentType === "m1" || config.tencentType === "m5";
  const url = minute
    ? `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${config.tencentType},,${config.limit}`
    : `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${config.tencentType},,,${config.limit},qfq`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Tencent K-line HTTP ${response.status}`);

  const payload = (await response.json()) as {
    data?: Record<string, Record<string, unknown>>;
  };
  const node = payload.data?.[symbol];
  if (!node) throw new Error("Tencent K-line payload missing instrument");

  const rows = minute
    ? node[config.tencentType]
    : node[`qfq${config.tencentType}`] ?? node[config.tencentType];
  const bars = normalizeBars(parseTencentRows(rows, config.interval), config.limit);
  if (bars.length === 0) throw new Error("Tencent K-line returned no OHLCV bars");
  return bars;
}

async function fetchYahooBars(instrument: StockInstrument, config: PeriodConfig) {
  const symbol = yahooSymbol(instrument);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("range", config.yahooRange);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);

  const payload = (await response.json()) as {
    chart?: {
      error?: { description?: string } | null;
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  if (payload.chart?.error) {
    throw new Error(payload.chart.error.description || "Yahoo chart provider error");
  }

  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  if (!quote || timestamps.length === 0) throw new Error("Yahoo chart returned no data");

  const bars = timestamps.flatMap((timestamp, index): OHLCBar[] => {
    const open = numberValue(quote.open?.[index]);
    const high = numberValue(quote.high?.[index]);
    const low = numberValue(quote.low?.[index]);
    const close = numberValue(quote.close?.[index]);
    const volume = numberValue(quote.volume?.[index]) ?? 0;
    if (open === null || high === null || low === null || close === null) return [];
    return [
      {
        t: new Date(timestamp * 1000).toISOString(),
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume,
      },
    ];
  });

  const normalized = normalizeBars(bars, config.limit);
  if (normalized.length === 0) throw new Error("Yahoo chart returned no valid OHLCV bars");
  return normalized;
}

async function fetchNasdaqDailyBars(
  instrument: StockInstrument,
  config: PeriodConfig
) {
  if (config.interval !== "1d") {
    throw new Error("Nasdaq historical fallback supports daily bars only");
  }

  const fromDate = new Date();
  fromDate.setUTCMonth(fromDate.getUTCMonth() - 18);
  const url = new URL(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(instrument.symbol)}/historical`
  );
  url.searchParams.set("assetclass", "stocks");
  url.searchParams.set("fromdate", fromDate.toISOString().slice(0, 10));
  url.searchParams.set("limit", String(config.limit));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nasdaq historical HTTP ${response.status}`);

  const payload = (await response.json()) as {
    data?: {
      tradesTable?: {
        rows?: Array<{
          date?: string;
          close?: string;
          volume?: string;
          open?: string;
          high?: string;
          low?: string;
        }>;
      };
    } | null;
  };
  const rows = payload.data?.tradesTable?.rows ?? [];
  const bars = rows.flatMap((row): OHLCBar[] => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.date ?? "");
    const open = marketNumberValue(row.open);
    const high = marketNumberValue(row.high);
    const low = marketNumberValue(row.low);
    const close = marketNumberValue(row.close);
    const volume = marketNumberValue(row.volume) ?? 0;
    if (!match || open === null || high === null || low === null || close === null) {
      return [];
    }
    const [, month, day, year] = match;
    return [
      {
        t: `${year}-${month}-${day}T12:00:00Z`,
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume,
      },
    ];
  });

  const normalized = normalizeBars(bars, config.limit);
  if (normalized.length === 0) {
    throw new Error("Nasdaq historical returned no valid OHLCV bars");
  }
  return normalized;
}

function eastmoneyTimestamp(raw: string, interval: StockBarInterval) {
  if (
    (interval === "1m" || interval === "5m") &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)
  ) {
    // Eastmoney serializes minute bars in Beijing time and labels them by
    // bucket end. Lightweight Charts expects the interval start timestamp.
    const bucketEnd = Date.parse(`${raw.replace(" ", "T")}:00+08:00`);
    const intervalMs = interval === "1m" ? 60_000 : 5 * 60_000;
    return new Date(bucketEnd - intervalMs).toISOString();
  }
  if (
    interval !== "1m" &&
    interval !== "5m" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw)
  ) {
    // Noon UTC keeps the exchange trading date stable across CN and US time zones.
    return `${raw}T12:00:00Z`;
  }
  return "";
}

async function fetchEastmoneyBars(instrument: StockInstrument, config: PeriodConfig) {
  const klineType: Record<StockBarInterval, string> = {
    "1m": "1",
    "5m": "5",
    "1d": "101",
    "1mo": "103",
  };
  const url = new URL("https://63.push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", eastmoneySymbol(instrument));
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56");
  url.searchParams.set("klt", klineType[config.interval]);
  url.searchParams.set(
    "fqt",
    instrument.market === "CN" &&
      (config.interval === "1d" || config.interval === "1mo")
      ? "1"
      : "0"
  );
  url.searchParams.set("beg", "0");
  url.searchParams.set("end", "20500000");
  url.searchParams.set("lmt", String(config.limit));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Eastmoney K-line HTTP ${response.status}`);

  const payload = (await response.json()) as {
    data?: { klines?: string[] } | null;
  };
  const rows = payload.data?.klines ?? [];
  const bars = rows.flatMap((row): OHLCBar[] => {
    const [rawTime, rawOpen, rawClose, rawHigh, rawLow, rawVolume] = row.split(",");
    const timestamp = eastmoneyTimestamp(rawTime, config.interval);
    const open = numberValue(rawOpen);
    const close = numberValue(rawClose);
    const high = numberValue(rawHigh);
    const low = numberValue(rawLow);
    const rawVolumeValue = numberValue(rawVolume) ?? 0;
    // Eastmoney reports Beijing Stock Exchange volume in lots. The shared
    // OHLCV contract is expressed in shares; US Eastmoney rows are already
    // share-denominated and must not be scaled.
    const volume =
      instrument.exchange === "XBSE" ? rawVolumeValue * 100 : rawVolumeValue;
    if (!timestamp || open === null || close === null || high === null || low === null) {
      return [];
    }
    return [{ t: timestamp, o: open, h: high, l: low, c: close, v: volume }];
  });

  const normalized = normalizeBars(bars, config.limit);
  if (normalized.length === 0) throw new Error("Eastmoney K-line returned no OHLCV bars");
  return normalized;
}

async function fetchFreshBars(
  instrument: StockInstrument,
  period: StockChartPeriod,
  previous?: StockBarsResult
): Promise<StockBarsResult> {
  const config = PERIOD_CONFIG[period];
  const expectedPrimarySource =
    instrument.market === "US" || instrument.exchange === "XBSE"
      ? "eastmoney"
      : "tencent";
  const canFetchTail =
    marketState(instrument.market) === "OPEN" &&
    previous?.instrument.id === instrument.id &&
    previous.period === period &&
    previous.marketState === "OPEN" &&
    previous.source === expectedPrimarySource;
  const primaryConfig = canFetchTail ? { ...config, limit: 12 } : config;
  const failures: string[] = [];
  let bars: OHLCBar[] = [];
  let source: StockBarsResult["source"] = expectedPrimarySource;

  if (instrument.market === "CN" && instrument.exchange !== "XBSE") {
    try {
      bars = await fetchTencentBars(instrument, primaryConfig);
      source = "tencent";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (instrument.market === "US" || instrument.exchange === "XBSE") {
    try {
      bars = await fetchEastmoneyBars(instrument, primaryConfig);
      source = "eastmoney";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (bars.length === 0 && instrument.market === "US" && config.interval === "1d") {
    try {
      bars = await fetchNasdaqDailyBars(instrument, config);
      source = "nasdaq";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const yahooPreservesPriceBasis =
    instrument.market === "US" || period === "intraday" || period === "five-day";
  if (bars.length === 0 && yahooPreservesPriceBasis) {
    try {
      bars = await fetchYahooBars(instrument, config);
      source = "yahoo";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (bars.length === 0) {
    throw new Error(`No real OHLCV data returned: ${failures.join("; ")}`);
  }

  if (canFetchTail && previous?.source === source) {
    bars = normalizeBars([...previous.bars, ...bars], config.limit);
  }

  bars = limitTradingSessions(bars, period, instrument.market);

  const state = marketState(instrument.market, new Date(), bars, config.interval);
  const generatedAt = new Date().toISOString();
  const sourceLabel =
    source === "tencent"
      ? "TENCENT PUBLIC"
      : source === "eastmoney"
        ? "EASTMONEY PUBLIC"
        : source === "nasdaq"
          ? "NASDAQ PUBLIC"
          : "YAHOO PUBLIC";
  const adjustment =
    instrument.market === "CN" && (period === "daily" || period === "monthly")
      ? "qfq"
      : "none";

  return {
    instrument: {
      id: instrument.id,
      market: instrument.market,
      exchange: instrument.exchange,
      symbol: instrument.symbol,
      name: instrument.name,
      currency: instrument.currency,
    },
    period,
    interval: config.interval,
    bars,
    generatedAt,
    dataAsOf: bars.at(-1)?.t ?? generatedAt,
    source,
    sourceLabel,
    timeZone: marketTimeZone(instrument.market),
    marketState: state,
    refreshAfterMs: state === "OPEN" || state === "DELAYED" ? 5_000 : null,
    latestBarPartial:
      state === "OPEN" ||
      (period === "daily" && state === "BREAK") ||
      (period === "monthly" &&
        sessionDate(bars.at(-1)?.t ?? generatedAt, instrument.market).slice(0, 7) ===
          sessionDate(generatedAt, instrument.market).slice(0, 7)),
    barTimeSemantics: "interval-start",
    volumeUnit: "shares",
    adjustment,
    cacheHit: false,
    stale: false,
    staleReason: null,
    providerMessage:
      source === "tencent"
        ? "Tencent public OHLCV feed; timing, availability and redistribution rights are not guaranteed."
        : source === "eastmoney"
          ? "Eastmoney public OHLCV feed; timing, availability and redistribution rights are not guaranteed."
          : source === "nasdaq"
            ? "Nasdaq public historical feed; timing, availability and redistribution rights are not guaranteed."
            : "Yahoo public OHLCV feed; timing, availability and redistribution rights are not guaranteed.",
  };
}

export async function fetchStockBars(
  instrument: StockInstrument,
  period: StockChartPeriod = "intraday"
) {
  const key = `${instrument.id}:${period}`;
  const now = Date.now();
  const currentState = marketState(instrument.market);
  const cached = barsCache.get(key);

  if (
    cached &&
    cached.expiresAt > now &&
    cached.result.marketState === currentState
  ) {
    return {
      ...cached.result,
      generatedAt: new Date().toISOString(),
      cacheHit: true,
    };
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchFreshBars(instrument, period, cached?.result)
    .then((result) => {
      const ttl = result.marketState === "OPEN" ? 4_000 : 300_000;
      barsCache.set(key, { result, expiresAt: Date.now() + ttl });
      return result;
    })
    .catch((error) => {
      if (!cached) throw error;

      const staleReason = error instanceof Error ? error.message : String(error);
      const state = marketState(
        instrument.market,
        new Date(),
        cached.result.bars,
        cached.result.interval
      );
      const staleResult: StockBarsResult = {
        ...cached.result,
        generatedAt: new Date().toISOString(),
        marketState: state,
        refreshAfterMs: state === "OPEN" || state === "DELAYED" ? 5_000 : null,
        cacheHit: true,
        stale: true,
        staleReason,
      };
      barsCache.set(key, {
        result: staleResult,
        expiresAt: Date.now() + (state === "OPEN" || state === "DELAYED" ? 4_000 : 15_000),
      });
      return staleResult;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}
