import type { Asset, PortfolioSnapshot, StrategySignal } from "./types";

export const assets: Asset[] = [
  {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    assetClass: "crypto",
    price: 68420.18,
    change24h: 2.84,
    volatility: 0.62,
    liquidity: 0.94,
    heat: 0.89,
    trend: [61, 64, 60, 68, 70, 74, 72, 79, 83, 81, 88, 91]
  },
  {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    assetClass: "crypto",
    price: 3912.4,
    change24h: -1.18,
    volatility: 0.58,
    liquidity: 0.88,
    heat: 0.74,
    trend: [72, 71, 69, 65, 67, 64, 60, 62, 59, 57, 55, 53]
  },
  {
    id: "nvda",
    symbol: "NVDA",
    name: "NVIDIA",
    assetClass: "equity",
    price: 121.77,
    change24h: 3.42,
    volatility: 0.49,
    liquidity: 0.91,
    heat: 0.82,
    trend: [45, 48, 52, 56, 61, 58, 63, 67, 72, 74, 77, 84]
  },
  {
    id: "spy",
    symbol: "SPY",
    name: "S&P 500 ETF",
    assetClass: "index",
    price: 552.31,
    change24h: 0.64,
    volatility: 0.22,
    liquidity: 0.97,
    heat: 0.51,
    trend: [50, 51, 52, 53, 54, 54, 55, 55, 56, 57, 57, 58]
  },
  {
    id: "xau",
    symbol: "XAU",
    name: "Gold Spot",
    assetClass: "commodity",
    price: 2414.5,
    change24h: -0.32,
    volatility: 0.27,
    liquidity: 0.81,
    heat: 0.43,
    trend: [58, 57, 55, 56, 54, 52, 53, 51, 50, 51, 49, 48]
  },
  {
    id: "usdjpy",
    symbol: "USDJPY",
    name: "Dollar Yen",
    assetClass: "fx",
    price: 151.24,
    change24h: 0.21,
    volatility: 0.31,
    liquidity: 0.87,
    heat: 0.48,
    trend: [43, 44, 45, 46, 45, 47, 48, 48, 49, 50, 49, 51]
  }
];

export const portfolio: PortfolioSnapshot = {
  totalEquity: 1289340,
  cash: 186420,
  dayPnl: 24780,
  riskExposure: 0.68,
  valueAtRisk95: 43880,
  beta: 1.17,
  positions: [
    {
      assetId: "btc",
      symbol: "BTC",
      name: "Bitcoin",
      quantity: 4.2,
      averageCost: 61200,
      markPrice: 68420.18,
      marketValue: 287364.76,
      unrealizedPnl: 30324.76,
      allocation: 0.22
    },
    {
      assetId: "nvda",
      symbol: "NVDA",
      name: "NVIDIA",
      quantity: 1850,
      averageCost: 97.4,
      markPrice: 121.77,
      marketValue: 225274.5,
      unrealizedPnl: 45084.5,
      allocation: 0.17
    },
    {
      assetId: "spy",
      symbol: "SPY",
      name: "S&P 500 ETF",
      quantity: 640,
      averageCost: 520.2,
      markPrice: 552.31,
      marketValue: 353478.4,
      unrealizedPnl: 20550.4,
      allocation: 0.27
    },
    {
      assetId: "xau",
      symbol: "XAU",
      name: "Gold Spot",
      quantity: 72,
      averageCost: 2250,
      markPrice: 2414.5,
      marketValue: 173844,
      unrealizedPnl: 11844,
      allocation: 0.13
    }
  ]
};

export const strategies: StrategySignal[] = [
  {
    id: "vol-break",
    name: "波动断层",
    assetSymbol: "BTC",
    direction: "long",
    confidence: 0.81,
    reason: "成交热度与趋势轨迹同步扩张",
    status: "armed",
    intensity: 0.92
  },
  {
    id: "mean-revert",
    name: "均值回声",
    assetSymbol: "ETH",
    direction: "short",
    confidence: 0.66,
    reason: "短周期反弹未突破压力带",
    status: "watching",
    intensity: 0.58
  },
  {
    id: "risk-parity",
    name: "风险平衡",
    assetSymbol: "SPY",
    direction: "neutral",
    confidence: 0.74,
    reason: "组合 beta 偏高，建议降低相关暴露",
    status: "cooldown",
    intensity: 0.44
  },
  {
    id: "liquidity-map",
    name: "流动性地图",
    assetSymbol: "NVDA",
    direction: "long",
    confidence: 0.77,
    reason: "盘口流动性恢复，动量仍在扩散",
    status: "armed",
    intensity: 0.79
  }
];

export function findAssetPrice(assetId: string) {
  return assets.find((asset) => asset.id === assetId)?.price;
}
