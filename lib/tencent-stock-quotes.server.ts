import "server-only";

import type { LiveInstrument, LiveQuote } from "@/lib/live-instruments";
import type { StockInstrument, StockMarket } from "@/lib/stock-catalog";

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tencentSymbol(instrument: StockInstrument) {
  if (instrument.market === "CN") {
    const prefix =
      instrument.exchange === "XSHG" ? "sh" : instrument.exchange === "XBSE" ? "bj" : "sz";
    return `${prefix}${instrument.symbol}`;
  }

  return `us${instrument.symbol.replaceAll("^", "-").replaceAll("/", ".")}`;
}

function toLiveInstrument(instrument: StockInstrument, providerSymbol: string): LiveInstrument {
  return {
    id: instrument.id,
    name: instrument.name,
    symbol: instrument.symbol,
    assetClass: instrument.market === "CN" ? "cn-stock" : "us-stock",
    exchange: instrument.exchange,
    venue: instrument.market === "CN" ? "China A-share" : "US listed equity",
    provider: "tencent",
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

function isUsDaylightTime(year: number, month: number, day: number) {
  const secondSundayInMarch = 14 - new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const firstSundayInNovember = 7 - new Date(Date.UTC(year, 10, 1)).getUTCDay();
  if (month > 3 && month < 11) return true;
  if (month === 3) return day >= secondSundayInMarch;
  if (month === 11) return day < firstSundayInNovember;
  return false;
}

function parseTimestamp(raw: string, market: StockMarket) {
  const trimmed = raw.trim();
  if (market === "CN" && /^\d{14}$/.test(trimmed)) {
    const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(8, 10)}:${trimmed.slice(10, 12)}:${trimmed.slice(12, 14)}+08:00`;
    return new Date(iso);
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (market === "US" && match) {
    const [, year, month, day, time] = match;
    const daylight = isUsDaylightTime(Number(year), Number(month), Number(day));
    return new Date(`${year}-${month}-${day}T${time}${daylight ? "-04:00" : "-05:00"}`);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function publicStatus(market: StockMarket, timestamp: Date): LiveQuote["feedStatus"] {
  const age = Date.now() - timestamp.getTime();
  if (isRegularSession(market) && age >= 0 && age < 10 * 60 * 1000) return "LIVE_PUBLIC";
  if (isRegularSession(market) && age >= 0 && age < 45 * 60 * 1000) return "DELAYED_PUBLIC";
  return "MARKET_CLOSED_LAST_TICK";
}

function depthLevel(fields: string[], priceIndex: number, sizeIndex: number, multiplier: number) {
  const price = numberOrNull(fields[priceIndex]);
  const size = numberOrNull(fields[sizeIndex]);
  return price === null ? null : { price, size: (size ?? 0) * multiplier };
}

function parseQuote(instrument: StockInstrument, providerSymbol: string, fields: string[]): LiveQuote {
  const isChina = instrument.market === "CN";
  const price = numberOrNull(fields[3]);
  const previousClose = numberOrNull(fields[4]);
  const open = numberOrNull(fields[5]);
  const change = numberOrNull(fields[31]);
  const changePct = numberOrNull(fields[32]);
  const high = numberOrNull(fields[33]);
  const low = numberOrNull(fields[34]);
  const timestamp = parseTimestamp(fields[30] ?? "", instrument.market);
  const shareMultiplier = isChina ? 100 : 1;
  const amountMultiplier = isChina ? 10000 : 1;
  const bidLevels = isChina ? [9, 11, 13, 15, 17] : [9];
  const askLevels = isChina ? [19, 21, 23, 25, 27] : [19];

  return {
    instrument: toLiveInstrument(instrument, providerSymbol),
    price,
    change,
    changePct,
    open,
    previousClose,
    high,
    low,
    bid: numberOrNull(fields[9]),
    ask: numberOrNull(fields[19]),
    volume:
      numberOrNull(fields[36]) === null
        ? null
        : (numberOrNull(fields[36]) as number) * shareMultiplier,
    turnover:
      numberOrNull(fields[37]) === null
        ? null
        : (numberOrNull(fields[37]) as number) * amountMultiplier,
    timestamp: timestamp.toISOString(),
    feedStatus: publicStatus(instrument.market, timestamp),
    providerMessage:
      "Tencent public quote fallback; timing, availability and redistribution rights are unspecified",
    series: [previousClose, open, low, price, high].filter(
      (value): value is number => value !== null
    ),
    statistics: {
      marketCap:
        numberOrNull(fields[45]) === null ? null : (numberOrNull(fields[45]) as number) * 100000000,
      floatMarketCap:
        numberOrNull(fields[44]) === null ? null : (numberOrNull(fields[44]) as number) * 100000000,
      peRatio: numberOrNull(fields[39]),
      peTtm: isChina ? numberOrNull(fields[52]) : numberOrNull(fields[39]),
      pbRatio: isChina ? numberOrNull(fields[46]) : numberOrNull(fields[47]),
      turnoverRate: numberOrNull(fields[38]),
      volumeRatio: isChina ? numberOrNull(fields[49]) : null,
      amplitude: numberOrNull(fields[43]),
      week52High: isChina ? numberOrNull(fields[67]) : numberOrNull(fields[48]),
      week52Low: isChina ? numberOrNull(fields[68]) : numberOrNull(fields[49])
    },
    depth: {
      bids: bidLevels
        .map((index) => depthLevel(fields, index, index + 1, shareMultiplier))
        .filter((level): level is { price: number; size: number } => level !== null),
      asks: askLevels
        .map((index) => depthLevel(fields, index, index + 1, shareMultiplier))
        .filter((level): level is { price: number; size: number } => level !== null)
    }
  };
}

export async function fetchTencentStockQuotes(instruments: StockInstrument[]) {
  if (instruments.length === 0) return { quotes: [] as LiveQuote[], unresolved: [] as StockInstrument[] };

  const providerEntries = instruments.map(
    (instrument) => [tencentSymbol(instrument), instrument] as const
  );
  const byProviderSymbol = new Map(
    providerEntries.map(([providerSymbol, instrument]) => [providerSymbol.toLowerCase(), instrument])
  );
  const url = new URL("https://qt.gtimg.cn/q=");
  url.pathname = "/q=" + providerEntries.map(([providerSymbol]) => providerSymbol).join(",");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://gu.qq.com/"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Tencent quote ${response.status}`);

  const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
  const quotes: LiveQuote[] = [];
  const resolvedIds = new Set<string>();
  const pattern = /v_([^=]+)="([^"]*)"/g;

  for (const match of text.matchAll(pattern)) {
    const providerSymbol = match[1].toLowerCase();
    const instrument = byProviderSymbol.get(providerSymbol);
    if (!instrument || !match[2]) continue;

    const fields = match[2].split("~");
    if (fields.length < 35 || numberOrNull(fields[3]) === null) continue;
    quotes.push(parseQuote(instrument, providerSymbol, fields));
    resolvedIds.add(instrument.id);
  }

  return {
    quotes,
    unresolved: instruments.filter((instrument) => !resolvedIds.has(instrument.id))
  };
}
