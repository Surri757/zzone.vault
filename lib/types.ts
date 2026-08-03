export type AssetClass = "crypto" | "equity" | "fx" | "commodity" | "index";

export type OrderSide = "buy" | "sell";

export type OrderStatus = "queued" | "accepted" | "simulated" | "rejected";

export type StrategyDirection = "long" | "short" | "neutral";

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change24h: number;
  volatility: number;
  liquidity: number;
  trend: number[];
  heat: number;
}

export interface Position {
  assetId: string;
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  markPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  allocation: number;
}

export interface PortfolioSnapshot {
  totalEquity: number;
  cash: number;
  dayPnl: number;
  riskExposure: number;
  valueAtRisk95: number;
  beta: number;
  positions: Position[];
}

export interface StrategySignal {
  id: string;
  name: string;
  assetSymbol: string;
  direction: StrategyDirection;
  confidence: number;
  reason: string;
  status: "watching" | "armed" | "cooldown";
  intensity: number;
}

export interface SimulatedOrderRequest {
  side: OrderSide;
  assetId: string;
  quantity: number;
  limitPrice?: number;
}

export interface SimulatedOrder {
  id: string;
  side: OrderSide;
  assetId: string;
  quantity: number;
  price: number;
  status: OrderStatus;
  createdAt: string;
}
