export type MarketDataClass =
  | "crypto"
  | "equity"
  | "fx"
  | "futures"
  | "commodity"
  | "rates"
  | "macro";

export type FeedTransport = "websocket" | "rest" | "fix" | "vendor-stream";

export type FeedStatus = "adapter-ready" | "requires-key" | "licensed";

export type VisualizationMode =
  | "line"
  | "area"
  | "bars"
  | "heatmap"
  | "surface"
  | "network"
  | "candlestick";

export interface ExchangeSource {
  id: string;
  name: string;
  region: string;
  coverage: string;
  assetClasses: MarketDataClass[];
  transport: FeedTransport[];
  latencyProfile: string;
  status: FeedStatus;
}

export interface MarketPoint {
  t: string;
  value: number;
  volume: number;
  volatility: number;
  depth: number;
  sentiment: number;
}

export interface VisualizationLens {
  id: VisualizationMode;
  label: string;
  description: string;
}

export interface DataInsight {
  headline: string;
  drivers: string[];
  risk: string;
  nextCheck: string;
}

export interface ClassifiedMarketGroup {
  id: string;
  label: string;
  assetClass: MarketDataClass;
  region: string;
  description: string;
  instruments: string[];
  sourceIds: string[];
  refreshCadence: string;
  sampleSeries: MarketPoint[];
  insight: DataInsight;
}

export const exchangeSources: ExchangeSource[] = [
  {
    id: "crypto-direct",
    name: "Direct Crypto Exchange Mesh",
    region: "Global",
    coverage: "Binance, Coinbase, Kraken, OKX, Bybit and other exchange adapters",
    assetClasses: ["crypto"],
    transport: ["websocket", "rest"],
    latencyProfile: "sub-second exchange streams when enabled",
    status: "adapter-ready"
  },
  {
    id: "polygon-massive",
    name: "Massive / Polygon Market Data",
    region: "US and global aggregates",
    coverage: "Stocks, options, indices, forex, crypto and futures depending on plan",
    assetClasses: ["equity", "fx", "crypto", "futures"],
    transport: ["websocket", "rest"],
    latencyProfile: "vendor real-time tiers",
    status: "requires-key"
  },
  {
    id: "finnhub",
    name: "Finnhub Stream",
    region: "Global",
    coverage: "Stocks, forex, crypto, news and fundamentals",
    assetClasses: ["equity", "fx", "crypto", "macro"],
    transport: ["websocket", "rest"],
    latencyProfile: "vendor real-time tiers",
    status: "requires-key"
  },
  {
    id: "twelve-data",
    name: "Twelve Data",
    region: "Global",
    coverage: "Global exchanges, forex, crypto, ETFs, indices and fundamentals",
    assetClasses: ["equity", "fx", "crypto", "commodity", "macro"],
    transport: ["websocket", "rest"],
    latencyProfile: "vendor real-time tiers",
    status: "requires-key"
  },
  {
    id: "licensed-venues",
    name: "Licensed Venue Layer",
    region: "Global",
    coverage: "CME, ICE, Eurex, LSE, HKEX, JPX and regional exchange feeds",
    assetClasses: ["equity", "futures", "commodity", "rates"],
    transport: ["fix", "vendor-stream"],
    latencyProfile: "exchange permission dependent",
    status: "licensed"
  }
];

export const visualizationLenses: VisualizationLens[] = [
  {
    id: "line",
    label: "Line",
    description: "价格路径和拐点"
  },
  {
    id: "area",
    label: "Area",
    description: "趋势强度和区间"
  },
  {
    id: "bars",
    label: "Bars",
    description: "成交量节奏"
  },
  {
    id: "heatmap",
    label: "Heat",
    description: "波动和深度热区"
  },
  {
    id: "surface",
    label: "Surface",
    description: "价格、波动、深度的立体剖面"
  },
  {
    id: "network",
    label: "Network",
    description: "跨市场联动关系"
  }
];

function series(seed: number, base: number, amplitude: number): MarketPoint[] {
  return Array.from({ length: 18 }, (_, index) => {
    const wave = Math.sin((index + seed) * 0.62) * amplitude;
    const drift = Math.cos((index + seed) * 0.21) * amplitude * 0.38;
    const value = base + wave + drift + index * amplitude * 0.12;

    return {
      t: `${String(index).padStart(2, "0")}:00`,
      value: Number(value.toFixed(2)),
      volume: Number((58 + Math.abs(Math.sin(index + seed)) * 42).toFixed(2)),
      volatility: Number((0.18 + Math.abs(Math.cos(index * 0.7 + seed)) * 0.62).toFixed(2)),
      depth: Number((0.28 + Math.abs(Math.sin(index * 0.4 + seed)) * 0.58).toFixed(2)),
      sentiment: Number((0.38 + Math.sin(index * 0.35 + seed) * 0.22).toFixed(2))
    };
  });
}

export const marketGroups: ClassifiedMarketGroup[] = [
  {
    id: "crypto-global",
    label: "全球加密资产",
    assetClass: "crypto",
    region: "Global",
    description: "现货、永续、资金费率、深度和跨所价差。",
    instruments: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BTC-PERP"],
    sourceIds: ["crypto-direct", "polygon-massive", "finnhub", "twelve-data"],
    refreshCadence: "500ms to 2s stream",
    sampleSeries: series(1, 68400, 880),
    insight: {
      headline: "BTC 主导的流动性仍在扩散，ETH 相对动能偏弱。",
      drivers: ["跨所深度恢复", "永续资金费率抬升", "成交量集中在亚洲和美国重叠时段"],
      risk: "高波动时需要校验交易所断线和异常插针。",
      nextCheck: "监控 1m 波动率、买卖盘深度和资金费率同步变化。"
    }
  },
  {
    id: "equity-global",
    label: "全球股票与 ETF",
    assetClass: "equity",
    region: "US / EU / HK / JP",
    description: "股票、ETF、指数成分股、盘前盘后和成交额分布。",
    instruments: ["NVDA", "AAPL", "SPY", "0700.HK", "7203.T"],
    sourceIds: ["polygon-massive", "finnhub", "twelve-data", "licensed-venues"],
    refreshCadence: "1s to 15s stream",
    sampleSeries: series(3, 552, 8.4),
    insight: {
      headline: "科技权重仍支撑指数，非美市场跟随强度分化。",
      drivers: ["美股权重股成交占比高", "ETF 资金净流入稳定", "港股和日股相关性短线升高"],
      risk: "全球股票实时行情通常受交易所授权和延迟等级限制。",
      nextCheck: "拆分盘中、盘前盘后、地区时区和交易币种。"
    }
  },
  {
    id: "futures-macro",
    label: "期货与宏观风险",
    assetClass: "futures",
    region: "CME / ICE / Eurex",
    description: "股指期货、能源、贵金属、利率和宏观事件冲击。",
    instruments: ["ES", "NQ", "CL", "GC", "ZN"],
    sourceIds: ["licensed-venues", "twelve-data"],
    refreshCadence: "licensed real-time stream",
    sampleSeries: series(5, 2414, 28),
    insight: {
      headline: "贵金属和利率端出现同向防御信号。",
      drivers: ["美元波动压低风险偏好", "黄金深度扩张", "利率期货短端成交活跃"],
      risk: "期货数据必须处理主力换月、合约乘数和交易时段。",
      nextCheck: "将价格、期限结构、未平仓和宏观日历合并解析。"
    }
  },
  {
    id: "fx-commodity",
    label: "外汇与商品",
    assetClass: "fx",
    region: "Global OTC",
    description: "主要货币对、商品报价、美元流动性和区域风险。",
    instruments: ["EURUSD", "USDJPY", "USDCNH", "XAUUSD", "CLUSD"],
    sourceIds: ["polygon-massive", "finnhub", "twelve-data"],
    refreshCadence: "1s to 5s stream",
    sampleSeries: series(7, 151.2, 1.35),
    insight: {
      headline: "美元兑日元维持高位，黄金短线承压但深度稳定。",
      drivers: ["利差交易仍拥挤", "亚洲时段美元买盘集中", "商品和外汇风险信号背离"],
      risk: "OTC 外汇没有单一中央交易所，需要标注报价来源。",
      nextCheck: "对比多供应商报价中位数，过滤异常点。"
    }
  }
];
