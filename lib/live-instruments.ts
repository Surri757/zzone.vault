export type LiveAssetClass =
  | "crypto"
  | "cn-stock"
  | "cn-etf"
  | "us-stock"
  | "global-etf"
  | "cn-future"
  | "global-future"
  | "fx"
  | "commodity";

export type LiveProvider =
  | "binance"
  | "sina"
  | "tencent"
  | "yahoo"
  | "tushare"
  | "massive";

export interface LiveInstrument {
  id: string;
  name: string;
  symbol: string;
  assetClass: LiveAssetClass;
  exchange: string;
  venue: string;
  provider: LiveProvider;
  providerSymbol: string;
  currency: string;
  unit: string;
  session: string;
}

export interface LiveQuote {
  instrument: LiveInstrument;
  price: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  turnover: number | null;
  openInterest?: number | null;
  timestamp: string;
  feedStatus:
    | "LICENSED_REALTIME"
    | "LIVE_PUBLIC"
    | "DELAYED_PUBLIC"
    | "MARKET_CLOSED_LAST_TICK"
    | "ERROR";
  providerMessage: string;
  series: number[];
  statistics?: {
    marketCap?: number | null;
    floatMarketCap?: number | null;
    peRatio?: number | null;
    peTtm?: number | null;
    pbRatio?: number | null;
    turnoverRate?: number | null;
    volumeRatio?: number | null;
    amplitude?: number | null;
    week52High?: number | null;
    week52Low?: number | null;
  };
  depth: {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  };
}

export const liveInstruments: LiveInstrument[] = [
  {
    id: "crypto-btcusdt",
    name: "Bitcoin",
    symbol: "BTCUSDT",
    assetClass: "crypto",
    exchange: "Binance",
    venue: "Spot",
    provider: "binance",
    providerSymbol: "BTCUSDT",
    currency: "USDT",
    unit: "coin",
    session: "24/7"
  },
  {
    id: "crypto-ethusdt",
    name: "Ethereum",
    symbol: "ETHUSDT",
    assetClass: "crypto",
    exchange: "Binance",
    venue: "Spot",
    provider: "binance",
    providerSymbol: "ETHUSDT",
    currency: "USDT",
    unit: "coin",
    session: "24/7"
  },
  {
    id: "crypto-solusdt",
    name: "Solana",
    symbol: "SOLUSDT",
    assetClass: "crypto",
    exchange: "Binance",
    venue: "Spot",
    provider: "binance",
    providerSymbol: "SOLUSDT",
    currency: "USDT",
    unit: "coin",
    session: "24/7"
  },
  {
    id: "cn-stock-600519",
    name: "贵州茅台",
    symbol: "600519.SH",
    assetClass: "cn-stock",
    exchange: "SSE",
    venue: "A股",
    provider: "sina",
    providerSymbol: "sh600519",
    currency: "CNY",
    unit: "share",
    session: "China A-share"
  },
  {
    id: "cn-stock-000001",
    name: "平安银行",
    symbol: "000001.SZ",
    assetClass: "cn-stock",
    exchange: "SZSE",
    venue: "A股",
    provider: "sina",
    providerSymbol: "sz000001",
    currency: "CNY",
    unit: "share",
    session: "China A-share"
  },
  {
    id: "cn-stock-300750",
    name: "宁德时代",
    symbol: "300750.SZ",
    assetClass: "cn-stock",
    exchange: "SZSE",
    venue: "A股",
    provider: "sina",
    providerSymbol: "sz300750",
    currency: "CNY",
    unit: "share",
    session: "China A-share"
  },
  {
    id: "cn-etf-510300",
    name: "沪深300ETF",
    symbol: "510300.SH",
    assetClass: "cn-etf",
    exchange: "SSE",
    venue: "ETF",
    provider: "sina",
    providerSymbol: "sh510300",
    currency: "CNY",
    unit: "share",
    session: "China A-share"
  },
  {
    id: "cn-etf-159915",
    name: "创业板ETF",
    symbol: "159915.SZ",
    assetClass: "cn-etf",
    exchange: "SZSE",
    venue: "ETF",
    provider: "sina",
    providerSymbol: "sz159915",
    currency: "CNY",
    unit: "share",
    session: "China A-share"
  },
  {
    id: "cn-future-jd0",
    name: "鸡蛋连续",
    symbol: "JD0",
    assetClass: "cn-future",
    exchange: "DCE",
    venue: "商品期货",
    provider: "sina",
    providerSymbol: "nf_JD0",
    currency: "CNY",
    unit: "contract",
    session: "China futures"
  },
  {
    id: "cn-future-sh0",
    name: "烧碱连续",
    symbol: "SH0",
    assetClass: "cn-future",
    exchange: "CZCE",
    venue: "商品期货",
    provider: "sina",
    providerSymbol: "nf_SH0",
    currency: "CNY",
    unit: "contract",
    session: "China futures"
  },
  {
    id: "cn-future-sa0",
    name: "纯碱连续",
    symbol: "SA0",
    assetClass: "cn-future",
    exchange: "CZCE",
    venue: "商品期货",
    provider: "sina",
    providerSymbol: "nf_SA0",
    currency: "CNY",
    unit: "contract",
    session: "China futures"
  },
  {
    id: "us-stock-nvda",
    name: "NVIDIA",
    symbol: "NVDA",
    assetClass: "us-stock",
    exchange: "NASDAQ",
    venue: "US stock",
    provider: "sina",
    providerSymbol: "gb_nvda",
    currency: "USD",
    unit: "share",
    session: "US equity"
  },
  {
    id: "global-etf-spy",
    name: "SPDR S&P 500 ETF",
    symbol: "SPY",
    assetClass: "global-etf",
    exchange: "NYSE Arca",
    venue: "ETF",
    provider: "sina",
    providerSymbol: "gb_spy",
    currency: "USD",
    unit: "share",
    session: "US equity"
  },
  {
    id: "fx-eurusd",
    name: "Euro Dollar",
    symbol: "EURUSD",
    assetClass: "fx",
    exchange: "OTC",
    venue: "FX",
    provider: "sina",
    providerSymbol: "fx_seurusd",
    currency: "USD",
    unit: "pair",
    session: "24/5"
  },
  {
    id: "fx-usdjpy",
    name: "Dollar Yen",
    symbol: "USDJPY",
    assetClass: "fx",
    exchange: "OTC",
    venue: "FX",
    provider: "sina",
    providerSymbol: "fx_susdjpy",
    currency: "JPY",
    unit: "pair",
    session: "24/5"
  },
  {
    id: "future-gc",
    name: "COMEX Gold",
    symbol: "GC=F",
    assetClass: "commodity",
    exchange: "COMEX",
    venue: "Commodity futures",
    provider: "sina",
    providerSymbol: "hf_GC",
    currency: "USD",
    unit: "contract",
    session: "CME Globex"
  },
  {
    id: "future-cl",
    name: "WTI Crude Oil",
    symbol: "CL=F",
    assetClass: "commodity",
    exchange: "NYMEX",
    venue: "Commodity futures",
    provider: "sina",
    providerSymbol: "hf_CL",
    currency: "USD",
    unit: "contract",
    session: "CME Globex"
  },
  {
    id: "future-es",
    name: "E-mini S&P 500",
    symbol: "ES=F",
    assetClass: "global-future",
    exchange: "CME",
    venue: "Index futures",
    provider: "sina",
    providerSymbol: "hf_ES",
    currency: "USD",
    unit: "contract",
    session: "CME Globex"
  }
];

export const liveAssetClassLabels: Record<LiveAssetClass, string> = {
  crypto: "加密资产",
  "cn-stock": "A股个股",
  "cn-etf": "A股 ETF",
  "us-stock": "美股个股",
  "global-etf": "全球 ETF",
  "cn-future": "国内商品期货",
  "global-future": "全球股指期货",
  fx: "外汇",
  commodity: "商品"
};
