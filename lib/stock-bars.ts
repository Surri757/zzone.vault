import type { StockMarket } from "@/lib/stock-catalog";

export type StockChartPeriod = "intraday" | "five-day" | "daily" | "monthly";

export type StockBarInterval = "1m" | "5m" | "1d" | "1mo";

export type StockBarSource = "tencent" | "eastmoney" | "nasdaq" | "yahoo";

export type StockMarketState = "OPEN" | "DELAYED" | "BREAK" | "CLOSED";

export interface OHLCBar {
  /** ISO-8601 timestamp with an explicit offset or UTC suffix. */
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface StockBarsResult {
  instrument: {
    id: string;
    market: StockMarket;
    exchange: string;
    symbol: string;
    name: string;
    currency: string;
  };
  period: StockChartPeriod;
  interval: StockBarInterval;
  bars: OHLCBar[];
  generatedAt: string;
  dataAsOf: string;
  source: StockBarSource;
  sourceLabel: string;
  timeZone: string;
  marketState: StockMarketState;
  refreshAfterMs: number | null;
  latestBarPartial: boolean;
  barTimeSemantics: "interval-start";
  volumeUnit: "shares";
  adjustment: "qfq" | "none";
  cacheHit: boolean;
  stale: boolean;
  staleReason: string | null;
  providerMessage: string;
}

export interface StockBarsApiResponse {
  generatedAt: string;
  results: StockBarsResult[];
}

export const stockChartPeriods: Array<{
  id: StockChartPeriod;
  label: string;
  detail: string;
}> = [
  { id: "intraday", label: "分时", detail: "1分钟 K / 当日" },
  { id: "five-day", label: "五日", detail: "5分钟 K / 近5交易日" },
  { id: "daily", label: "日K", detail: "日线 / 近一年" },
  { id: "monthly", label: "月K", detail: "月线 / 近十年" },
];
