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
  if (instrument.market === "US") {
    return `us${instrument.symbol.replaceAll("^", "-").replaceAll("/", ".")}`;
  }
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

function tencentDailyTimestamp(raw: unknown, market: StockMarket) {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  // Noon UTC keeps the exchange trading date stable across CN and US time zones,
  // matching the Eastmoney daily contract so marketState is consistent cross-source.
  if (market === "US") return `${value}T12:00:00Z`;
  return `${value}T15:00:00+08:00`;
}

function isRegularCnMinute(timestamp: string) {
  const match = timestamp.match(/T(\d{2}):(\d{2}):/);
  if (!match) return false;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

function parseTencentRows(
  rows: unknown,
  interval: StockBarInterval,
  market: StockMarket
) {
  if (!Array.isArray(rows)) return [];

  const minute = interval === "1m" || interval === "5m";
  const bars: OHLCBar[] = [];
  for (const rawRow of rows) {
    if (!Array.isArray(rawRow) || rawRow.length < 6) continue;

    const rawTimestamp = minute
      ? cnTimestamp(rawRow[0], true)
      : tencentDailyTimestamp(rawRow[0], market);
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

    // Tencent emits zero high/low for illiquid US issues (e.g. low-volume ETNs)
    // where only a close prints. A zero high/low alongside a non-zero close is a
    // stale quote, not a real bar — drop it rather than draw a flat-zero candle.
    if (close > 0 && (high === 0 || low === 0)) {
      continue;
    }

    // Tencent reports A-share volume in lots; the public chart contract uses shares.
    // US rows are already share-denominated and must not be scaled.
    const scaledVolume = market === "US" ? volume : volume * 100;
    bars.push({ t: timestamp, o: open, h: high, l: low, c: close, v: scaledVolume });
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
  // Tencent requires the qfq flag for daily/monthly series — without it the US
  // endpoint returns "bad params". A-share history is forward-adjusted (qfq);
  // US history is shallow regardless, but the flag is mandatory for a 200 response.
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
  const bars = normalizeBars(
    parseTencentRows(rows, config.interval, instrument.market),
    config.limit
  );
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

async function fetchNasdaqChartBars(
  instrument: StockInstrument,
  config: PeriodConfig
) {
  if (config.interval !== "1m" && config.interval !== "5m") {
    throw new Error("Nasdaq chart fallback supports 1m/5m intraday bars only");
  }

  const url = new URL(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(instrument.symbol)}/chart`
  );
  url.searchParams.set("assetclass", "stocks");

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
  if (!response.ok) throw new Error(`Nasdaq chart HTTP ${response.status}`);

  const payload = (await response.json()) as {
    data?: {
      chart?: Array<{
        x: number;
        y: number;
        z?: { dateTime?: string; value?: string };
      }>;
    } | null;
  };
  const points = payload.data?.chart ?? [];
  if (points.length === 0) throw new Error("Nasdaq chart returned no data points");

  // Nasdaq chart timestamps are epoch milliseconds in US Eastern time.
  // Build 1-minute OHLCV bars from the raw price series.
  const oneMinuteBars: OHLCBar[] = points.map((point) => ({
    t: new Date(point.x).toISOString(),
    o: point.y,
    h: point.y,
    l: point.y,
    c: point.y,
    v: 0,
  }));

  if (config.interval === "1m") {
    const normalized = normalizeBars(oneMinuteBars, config.limit);
    if (normalized.length === 0) throw new Error("Nasdaq chart produced no 1m OHLCV bars");
    return normalized;
  }

  // config.interval === "5m": aggregate 1-minute points into 5-minute buckets.
  const bucketMs = 5 * 60_000;
  const buckets = new Map<number, OHLCBar>();
  for (const bar of oneMinuteBars) {
    const epoch = Date.parse(bar.t);
    if (!Number.isFinite(epoch)) continue;
    const bucketKey = Math.floor(epoch / bucketMs) * bucketMs;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.h = Math.max(existing.h, bar.h);
      existing.l = Math.min(existing.l, bar.l);
      existing.c = bar.c;
      existing.v = 0;
    } else {
      buckets.set(bucketKey, {
        t: new Date(bucketKey).toISOString(),
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: 0,
      });
    }
  }

  const fiveMinuteBars = [...buckets.values()].sort(
    (left, right) => Date.parse(left.t) - Date.parse(right.t)
  );
  const normalized = normalizeBars(fiveMinuteBars, config.limit);
  if (normalized.length === 0) throw new Error("Nasdaq chart produced no 5m OHLCV bars");
  return normalized;
}

async function fetchNasdaqDailyBars(
  instrument: StockInstrument,
  config: PeriodConfig
) {
  if (config.interval !== "1d" && config.interval !== "1mo") {
    throw new Error("Nasdaq historical fallback supports daily/monthly bars only");
  }

  // Daily needs ~1 year; monthly aggregation needs the full 10-year window so
  // it can produce the 120 monthly bars the chart contract asks for.
  const lookbackYears = config.interval === "1mo" ? 10 : 2;
  const fromDate = new Date();
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - lookbackYears);
  const url = new URL(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(instrument.symbol)}/historical`
  );
  url.searchParams.set("assetclass", "stocks");
  url.searchParams.set("fromdate", fromDate.toISOString().slice(0, 10));
  url.searchParams.set("limit", String(config.interval === "1mo" ? 3000 : config.limit));

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
  const dailyBars = rows.flatMap((row): OHLCBar[] => {
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

  if (config.interval === "1mo") {
    const monthlyBars = aggregateMonthlyBars(dailyBars);
    const normalized = normalizeBars(monthlyBars, config.limit);
    if (normalized.length === 0) {
      throw new Error("Nasdaq historical returned no valid monthly OHLCV bars");
    }
    return normalized;
  }

  const normalized = normalizeBars(dailyBars, config.limit);
  if (normalized.length === 0) {
    throw new Error("Nasdaq historical returned no valid OHLCV bars");
  }
  return normalized;
}

// Aggregate a daily OHLCV series into monthly bars keyed by calendar month.
// Each bar carries the first session's open, the last session's close, the
// period high/low, and the summed volume. The timestamp anchors to the first
// trading day of that month at noon UTC, matching the daily contract.
function aggregateMonthlyBars(dailyBars: OHLCBar[]): OHLCBar[] {
  const buckets = new Map<string, OHLCBar>();
  for (const bar of dailyBars) {
    const monthKey = bar.t.slice(0, 7); // YYYY-MM
    const existing = buckets.get(monthKey);
    if (existing) {
      existing.h = Math.max(existing.h, bar.h);
      existing.l = Math.min(existing.l, bar.l);
      existing.c = bar.c;
      existing.v += bar.v;
    } else {
      buckets.set(monthKey, { ...bar });
    }
  }
  return [...buckets.values()];
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

// Sina K-line (money.finance.sina.com.cn) covers China A-shares and the Beijing
// Stock Exchange with full daily/5-minute history that Tencent lacks for BJ.
// It does NOT cover US equities (gb_ symbols return null) and has no 1-minute
// series (smallest scale is 5). Volume is share-denominated; no adjustment flag.
async function fetchSinaBars(instrument: StockInstrument, config: PeriodConfig) {
  if (instrument.market !== "CN") {
    throw new Error("Sina K-line supports China markets only");
  }
  // scale: 5 → 5-minute, 240 → daily. Monthly is derived by aggregating daily.
  const scale = config.interval === "5m" ? 5 : 240;
  const isMonthly = config.interval === "1mo";
  // For monthly aggregation pull enough daily history to fill the window.
  const datalen = isMonthly ? Math.max(config.limit * 22, 2500) : config.limit;
  const url = new URL(
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
  );
  url.searchParams.set("symbol", instrument.providerSymbol);
  url.searchParams.set("scale", String(scale));
  url.searchParams.set("ma", "no");
  url.searchParams.set("datalen", String(datalen));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Sina K-line HTTP ${response.status}`);

  const payload = (await response.json()) as Array<{
    day: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("Sina K-line returned no OHLCV bars");
  }

  const minute = config.interval === "5m";
  const dailyBars = payload.flatMap((row): OHLCBar[] => {
    const open = numberValue(row.open);
    const close = numberValue(row.close);
    const high = numberValue(row.high);
    const low = numberValue(row.low);
    const volume = numberValue(row.volume) ?? 0;
    if (open === null || close === null || high === null || low === null) return [];

    const raw = row.day.trim();
    let timestamp = "";
    if (minute && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
      // Sina labels 5-minute bars by bucket end in Beijing time; shift to the
      // interval-start contract used by the rest of the pipeline.
      const bucketEnd = Date.parse(`${raw.replace(" ", "T")}+08:00`);
      timestamp = new Date(bucketEnd - 5 * 60_000).toISOString();
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      timestamp = `${raw}T15:00:00+08:00`;
    }
    if (!timestamp) return [];
    return [{ t: timestamp, o: open, h: high, l: low, c: close, v: volume }];
  });

  if (isMonthly) {
    const monthlyBars = aggregateMonthlyBars(dailyBars);
    const normalized = normalizeBars(monthlyBars, config.limit);
    if (normalized.length === 0) {
      throw new Error("Sina K-line returned no valid monthly OHLCV bars");
    }
    return normalized;
  }

  const normalized = normalizeBars(dailyBars, config.limit);
  if (normalized.length === 0) throw new Error("Sina K-line returned no valid OHLCV bars");
  return normalized;
}

async function fetchFreshBars(
  instrument: StockInstrument,
  period: StockChartPeriod,
  previous?: StockBarsResult
): Promise<StockBarsResult> {
  const config = PERIOD_CONFIG[period];
  const isUs = instrument.market === "US";
  const isBj = instrument.exchange === "XBSE";
  const isUsIntraday = isUs && (period === "intraday" || period === "five-day");
  const isUsDailyMonthly = isUs && (period === "daily" || period === "monthly");
  // Beijing Stock Exchange: Sina is the only source with full daily/5m history
  // (Tencent returns just the latest day, Eastmoney is blocked here). Sina has
  // no 1-minute series, so BJ intraday still relies on Tencent.
  const isBjSinaPeriod =
    isBj && (period === "five-day" || period === "daily" || period === "monthly");
  // Primary source selection:
  //   A-share (all periods) → Tencent
  //   Beijing Stock Exchange 5m/daily/monthly → Sina (full history)
  //   Beijing Stock Exchange intraday(1m) → Tencent (Sina has no 1m)
  //   US intraday/five-day → Nasdaq chart
  //   US daily/monthly → Nasdaq historical (full coverage of common stocks);
  //     Tencent US daily is only 1-2 points, so it is a last-resort ETF fallback,
  //     not the primary, to avoid returning 2 bars when 250 are available.
  const expectedPrimarySource: StockBarsResult["source"] = isUs
    ? "nasdaq"
    : isBjSinaPeriod
      ? "sina"
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

  // Tier 1 — primary source per the selection above.
  if (isBjSinaPeriod) {
    try {
      bars = await fetchSinaBars(instrument, primaryConfig);
      source = "sina";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } else if (isUs) {
    // US primary: Nasdaq chart (intraday/5m) or Nasdaq historical (daily/monthly).
    try {
      if (isUsDailyMonthly) {
        bars = await fetchNasdaqDailyBars(instrument, primaryConfig);
      } else {
        bars = await fetchNasdaqChartBars(instrument, primaryConfig);
      }
      source = "nasdaq";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    // A-share (incl. BJ intraday) primary: Tencent.
    try {
      bars = await fetchTencentBars(instrument, primaryConfig);
      source = "tencent";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Tier 2 — Eastmoney fallback when the primary returned nothing. Retained
  // because Eastmoney offers fuller history where reachable; silently degrades
  // where the domain is blocked, letting the chain continue below.
  if (bars.length === 0 && (isUs || isBj)) {
    try {
      bars = await fetchEastmoneyBars(instrument, primaryConfig);
      source = "eastmoney";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Tier 2b — BJ intraday fallback to Sina 5m when Tencent 1m returned nothing,
  // covering the case where BJ 1m is unavailable but 5m history exists.
  if (bars.length === 0 && isBj && period === "intraday") {
    try {
      bars = await fetchSinaBars(instrument, { ...config, interval: "5m" });
      source = "sina";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Tier 3 — US ETF/ETN fallback. Nasdaq does not cover ETFs/ETNs (returns null)
  // and Eastmoney is often blocked, so for US daily/monthly with no data yet,
  // try Tencent's US daily series. It is shallow (often just first listing +
  // latest) but every point is a real tick — preferable to a hard failure.
  if (bars.length === 0 && isUsDailyMonthly) {
    try {
      bars = await fetchTencentBars(instrument, config);
      source = "tencent";
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Tier 4 — Yahoo last-resort fallback. Yahoo only returns forward-adjusted
  // prices, which diverge from Tencent/Eastmoney adjusted basis, so it is only
  // used when the price basis is already forward-adjusted (US, or intraday where
  // only same-day ticks matter). Returns 403 in some regions.
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
          : source === "sina"
            ? "SINA PUBLIC"
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
            : source === "sina"
              ? "Sina public OHLCV feed; timing, availability and redistribution rights are not guaranteed."
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
