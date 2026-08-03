import "server-only";

import type { LiveInstrument, LiveProvider, LiveQuote } from "@/lib/live-instruments";
import type { StockInstrument, StockMarket } from "@/lib/stock-catalog";

type ProviderResult = {
  quotes: LiveQuote[];
  unresolved: StockInstrument[];
  providers: Array<"tushare" | "massive">;
};

type TushareResponse = {
  code?: number;
  msg?: string;
  data?: { fields?: string[]; items?: unknown[][] };
};

type MassiveTicker = {
  ticker?: string;
  todaysChange?: number;
  todaysChangePerc?: number;
  updated?: number;
  day?: { c?: number; h?: number; l?: number; o?: number; v?: number; vw?: number };
  min?: { c?: number; h?: number; l?: number; o?: number; v?: number; vw?: number; t?: number };
  prevDay?: { c?: number; h?: number; l?: number; o?: number; v?: number; vw?: number };
  lastQuote?: { p?: number; P?: number; s?: number; S?: number; t?: number };
  lastTrade?: { p?: number; s?: number; t?: number };
};

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toLiveInstrument(
  instrument: StockInstrument,
  provider: LiveProvider,
  providerSymbol: string
): LiveInstrument {
  return {
    id: instrument.id,
    name: instrument.name,
    symbol: instrument.symbol,
    assetClass: instrument.market === "CN" ? "cn-stock" : "us-stock",
    exchange: instrument.exchange,
    venue: instrument.market === "CN" ? "China A-share" : "US listed equity",
    provider,
    providerSymbol,
    currency: instrument.currency,
    unit: "share",
    session:
      instrument.market === "CN"
        ? "Asia/Shanghai 09:30-11:30 / 13:00-15:00"
        : "America/New_York 09:30-16:00"
  };
}

function zonedParts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone,
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

  return {
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function isRegularSession(market: StockMarket, date = new Date()) {
  const parts = zonedParts(date, market === "CN" ? "Asia/Shanghai" : "America/New_York");
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  if (market === "US") return parts.minutes >= 570 && parts.minutes < 960;
  return (
    (parts.minutes >= 570 && parts.minutes < 690) ||
    (parts.minutes >= 780 && parts.minutes < 900)
  );
}

function licensedStatus(market: StockMarket, timestamp: Date): LiveQuote["feedStatus"] {
  const age = Date.now() - timestamp.getTime();
  return isRegularSession(market) && age >= 0 && age < 5 * 60 * 1000
    ? "LICENSED_REALTIME"
    : "MARKET_CLOSED_LAST_TICK";
}

function tushareCode(instrument: StockInstrument) {
  const suffix =
    instrument.exchange === "XSHG" ? "SH" : instrument.exchange === "XBSE" ? "BJ" : "SZ";
  return `${instrument.symbol}.${suffix}`;
}

function rowRecord(fields: string[], values: unknown[]) {
  return fields.reduce<Record<string, unknown>>((record, field, index) => {
    record[field] = values[index];
    return record;
  }, {});
}

function parseTushareTimestamp(row: Record<string, unknown>) {
  const raw = String(row.trade_time ?? row.datetime ?? row.time ?? "").trim();
  const compact = raw.match(
    /^(\d{4})(\d{2})(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/
  );
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  }
  if (raw) {
    const timestamp = new Date(raw.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"));
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }

  const tradeDate = String(row.trade_date ?? row.date ?? "").trim();
  if (/^\d{8}$/.test(tradeDate)) {
    if (/^\d{2}:?\d{2}:?\d{2}$/.test(raw)) {
      const time = raw.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3");
      return new Date(
        `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T${time}+08:00`
      );
    }
    const timestamp = new Date(
      `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T15:00:00+08:00`
    );
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }

  return new Date(0);
}

async function fetchTushareQuotes(instruments: StockInstrument[], token: string) {
  const byCode = new Map(instruments.map((instrument) => [tushareCode(instrument), instrument]));
  const response = await fetch(process.env.TUSHARE_API_URL || "https://api.tushare.pro", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_name: "rt_k",
      token,
      params: { ts_code: [...byCode.keys()].join(",") },
      fields: ""
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Tushare rt_k ${response.status}`);

  const payload = (await response.json()) as TushareResponse;
  if (payload.code && payload.code !== 0) {
    throw new Error(`Tushare rt_k ${payload.code}: ${payload.msg || "provider error"}`);
  }

  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const quotes: LiveQuote[] = [];

  for (const values of items) {
    const row = rowRecord(fields, values);
    const code = String(row.ts_code ?? "").toUpperCase();
    const instrument = byCode.get(code);
    if (!instrument) continue;

    const price = numberOrNull(row.close ?? row.price);
    const previousClose = numberOrNull(row.pre_close ?? row.previous_close);
    const change = numberOrNull(
      row.change ?? (price !== null && previousClose !== null ? price - previousClose : null)
    );
    const changePct = numberOrNull(
      row.pct_chg ??
        (change !== null && previousClose ? (change / previousClose) * 100 : null)
    );
    const timestamp = parseTushareTimestamp(row);
    const bid = numberOrNull(row.bid_price1 ?? row.bid1);
    const ask = numberOrNull(row.ask_price1 ?? row.ask1);
    const bidSize = numberOrNull(row.bid_volume1 ?? row.bid_vol1);
    const askSize = numberOrNull(row.ask_volume1 ?? row.ask_vol1);
    const open = numberOrNull(row.open);
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);

    quotes.push({
      instrument: toLiveInstrument(instrument, "tushare", code),
      price,
      change,
      changePct,
      open,
      previousClose,
      high,
      low,
      bid,
      ask,
      volume: numberOrNull(row.vol ?? row.volume),
      turnover: numberOrNull(row.amount ?? row.turnover),
      timestamp: timestamp.toISOString(),
      feedStatus: licensedStatus("CN", timestamp),
      providerMessage: "Tushare Pro rt_k licensed market-data adapter",
      series: [previousClose, open, low, price, high].filter(
        (value): value is number => value !== null
      ),
      depth: {
        bids: bid === null ? [] : [{ price: bid, size: bidSize ?? 0 }],
        asks: ask === null ? [] : [{ price: ask, size: askSize ?? 0 }]
      }
    });
  }

  return quotes;
}

function massiveTimestamp(value: unknown) {
  const timestamp = numberOrNull(value);
  if (timestamp === null) return new Date(0);
  const milliseconds = timestamp > 10 ** 16 ? timestamp / 10 ** 6 : timestamp;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

async function fetchMassiveQuotes(instruments: StockInstrument[], apiKey: string) {
  const bySymbol = new Map(instruments.map((instrument) => [instrument.symbol.toUpperCase(), instrument]));
  const baseUrl = process.env.MASSIVE_API_URL || "https://api.massive.com";
  const url = new URL("/v2/snapshot/locale/us/markets/stocks/tickers", baseUrl);
  url.searchParams.set("tickers", [...bySymbol.keys()].join(","));

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Massive stocks snapshot ${response.status}`);

  const payload = (await response.json()) as { tickers?: MassiveTicker[] };
  const quotes: LiveQuote[] = [];

  for (const snapshot of payload.tickers ?? []) {
    const symbol = String(snapshot.ticker ?? "").toUpperCase();
    const instrument = bySymbol.get(symbol);
    if (!instrument) continue;

    const price = numberOrNull(snapshot.lastTrade?.p ?? snapshot.min?.c ?? snapshot.day?.c);
    const previousClose = numberOrNull(snapshot.prevDay?.c);
    const change = numberOrNull(
      snapshot.todaysChange ??
        (price !== null && previousClose !== null ? price - previousClose : null)
    );
    const changePct = numberOrNull(
      snapshot.todaysChangePerc ??
        (change !== null && previousClose ? (change / previousClose) * 100 : null)
    );
    const timestamp = massiveTimestamp(
      snapshot.lastTrade?.t ?? snapshot.lastQuote?.t ?? snapshot.updated ?? snapshot.min?.t
    );
    const bid = numberOrNull(snapshot.lastQuote?.p);
    const ask = numberOrNull(snapshot.lastQuote?.P);
    const bidSize = numberOrNull(snapshot.lastQuote?.s);
    const askSize = numberOrNull(snapshot.lastQuote?.S);
    const open = numberOrNull(snapshot.day?.o);
    const high = numberOrNull(snapshot.day?.h);
    const low = numberOrNull(snapshot.day?.l);

    quotes.push({
      instrument: toLiveInstrument(instrument, "massive", symbol),
      price,
      change,
      changePct,
      open,
      previousClose,
      high,
      low,
      bid,
      ask,
      volume: numberOrNull(snapshot.day?.v),
      turnover:
        snapshot.day?.v !== undefined && snapshot.day?.vw !== undefined
          ? snapshot.day.v * snapshot.day.vw
          : null,
      timestamp: timestamp.toISOString(),
      feedStatus: licensedStatus("US", timestamp),
      providerMessage: "Massive US stocks snapshot licensed market-data adapter",
      series: [
        previousClose,
        open,
        low,
        numberOrNull(snapshot.min?.o),
        numberOrNull(snapshot.min?.c),
        price,
        high
      ].filter((value): value is number => value !== null),
      depth: {
        bids: bid === null ? [] : [{ price: bid, size: bidSize ?? 0 }],
        asks: ask === null ? [] : [{ price: ask, size: askSize ?? 0 }]
      }
    });
  }

  return quotes;
}

export function licensedMarketDataConfiguration() {
  return {
    CN: Boolean(process.env.TUSHARE_TOKEN),
    US: Boolean(process.env.MASSIVE_API_KEY)
  } satisfies Record<StockMarket, boolean>;
}

export async function fetchLicensedStockQuotes(
  instruments: StockInstrument[]
): Promise<ProviderResult> {
  const quotes: LiveQuote[] = [];
  const providers: ProviderResult["providers"] = [];
  const unresolved = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const cnInstruments = instruments.filter((instrument) => instrument.market === "CN");
  const usInstruments = instruments.filter((instrument) => instrument.market === "US");

  if (cnInstruments.length > 0 && process.env.TUSHARE_TOKEN) {
    try {
      const result = await fetchTushareQuotes(cnInstruments, process.env.TUSHARE_TOKEN);
      result.forEach((quote) => {
        quotes.push(quote);
        unresolved.delete(quote.instrument.id);
      });
      providers.push("tushare");
    } catch {
      // The public adapter resolves the same instruments below the licensed layer.
    }
  }

  if (usInstruments.length > 0 && process.env.MASSIVE_API_KEY) {
    try {
      const result = await fetchMassiveQuotes(usInstruments, process.env.MASSIVE_API_KEY);
      result.forEach((quote) => {
        quotes.push(quote);
        unresolved.delete(quote.instrument.id);
      });
      providers.push("massive");
    } catch {
      // The public adapter resolves the same instruments below the licensed layer.
    }
  }

  return { quotes, unresolved: [...unresolved.values()], providers };
}
