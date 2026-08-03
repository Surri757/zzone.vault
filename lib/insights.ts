import type { LiveQuote } from "@/lib/live-instruments";
import type { OHLCBar } from "@/lib/stock-bars";
import { sma, rsi, macd } from "@/lib/indicators";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnomalyFlag {
  type: "volume-spike" | "price-breakout" | "volatility-surge" | "gap" | "extreme-rsi" | "unusual-depth";
  severity: "info" | "warning" | "critical";
  message: string;
  threshold: number;
  actualValue: number;
}

export interface EnhancedInsight {
  headline: string;
  drivers: string[];
  risk: string;
  nextCheck: string;
  anomalies: AnomalyFlag[];
  technicalSummary: string;
  riskScore: number; // 0-100
  direction: "bullish" | "bearish" | "neutral";
}

// ---------------------------------------------------------------------------
// Volume anomaly detection
// ---------------------------------------------------------------------------

export function detectVolumeSpike(
  currentVolume: number,
  historicalVolumes: number[],
  threshold = 2.0
): AnomalyFlag | null {
  if (historicalVolumes.length < 5) return null;
  const avgVolume = historicalVolumes.reduce((sum, v) => sum + v, 0) / historicalVolumes.length;
  if (avgVolume <= 0) return null;
  const ratio = currentVolume / avgVolume;

  if (ratio >= threshold) {
    return {
      type: "volume-spike",
      severity: ratio >= 4 ? "critical" : ratio >= 3 ? "warning" : "info",
      message: `成交量 ${ratio.toFixed(1)}× 均量（${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(currentVolume)} vs ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(avgVolume)}）`,
      threshold: avgVolume * threshold,
      actualValue: currentVolume,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Price breakout detection
// ---------------------------------------------------------------------------

export function detectPriceBreakout(
  currentPrice: number,
  bars: OHLCBar[],
  lookbackPeriod = 20
): AnomalyFlag | null {
  if (bars.length < lookbackPeriod) return null;

  const recentBars = bars.slice(-lookbackPeriod);
  const recentHighs = recentBars.map((b) => b.h);
  const recentLows = recentBars.map((b) => b.l);
  const maxHigh = Math.max(...recentHighs);
  const minLow = Math.min(...recentLows);

  if (currentPrice > maxHigh) {
    const breakoutPct = ((currentPrice - maxHigh) / maxHigh) * 100;
    return {
      type: "price-breakout",
      severity: breakoutPct > 3 ? "critical" : "warning",
      message: `价格突破 ${lookbackPeriod} 期高点 ${maxHigh.toFixed(2)}（+${breakoutPct.toFixed(2)}%）`,
      threshold: maxHigh,
      actualValue: currentPrice,
    };
  }

  if (currentPrice < minLow) {
    const breakdownPct = ((minLow - currentPrice) / minLow) * 100;
    return {
      type: "price-breakout",
      severity: breakdownPct > 3 ? "critical" : "warning",
      message: `价格跌破 ${lookbackPeriod} 期低点 ${minLow.toFixed(2)}（-${breakdownPct.toFixed(2)}%）`,
      threshold: minLow,
      actualValue: currentPrice,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

export function detectGap(
  open: number | null,
  prevClose: number | null,
  threshold = 3
): AnomalyFlag | null {
  if (open === null || prevClose === null || prevClose <= 0) return null;

  const gapPct = ((open - prevClose) / prevClose) * 100;
  const absGap = Math.abs(gapPct);

  if (absGap >= threshold) {
    return {
      type: "gap",
      severity: absGap >= 8 ? "critical" : absGap >= 5 ? "warning" : "info",
      message: `${gapPct > 0 ? "向上" : "向下"}跳空 ${absGap.toFixed(2)}%（开 ${open.toFixed(2)} vs 昨收 ${prevClose.toFixed(2)}）`,
      threshold,
      actualValue: absGap,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// RSI extreme detection
// ---------------------------------------------------------------------------

export function detectExtremeRSI(rsiValue: number | null): AnomalyFlag | null {
  if (rsiValue === null || !Number.isFinite(rsiValue)) return null;

  if (rsiValue >= 80) {
    return {
      type: "extreme-rsi",
      severity: rsiValue >= 90 ? "critical" : "warning",
      message: `RSI 极度超买 (${rsiValue.toFixed(1)})`,
      threshold: 70,
      actualValue: rsiValue,
    };
  }

  if (rsiValue <= 20) {
    return {
      type: "extreme-rsi",
      severity: rsiValue <= 10 ? "critical" : "warning",
      message: `RSI 极度超卖 (${rsiValue.toFixed(1)})`,
      threshold: 30,
      actualValue: rsiValue,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Unusual depth / spread detection
// ---------------------------------------------------------------------------

export function detectUnusualSpread(
  bid: number | null,
  ask: number | null,
  price: number | null
): AnomalyFlag | null {
  if (bid === null || ask === null || price === null || price <= 0) return null;

  const spread = ask - bid;
  const spreadPct = (spread / price) * 100;

  if (spreadPct > 5) {
    return {
      type: "unusual-depth",
      severity: spreadPct > 10 ? "critical" : "warning",
      message: `买卖价差异常扩大 (${spreadPct.toFixed(2)}%)`,
      threshold: 5,
      actualValue: spreadPct,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Comprehensive analysis
// ---------------------------------------------------------------------------

export function analyzeQuote(
  quote: LiveQuote,
  bars?: OHLCBar[],
  sectorData?: { avgChangePct: number; name: string }
): EnhancedInsight {
  const anomalies: AnomalyFlag[] = [];

  // Volume spike
  if (bars && bars.length >= 20 && quote.volume !== null) {
    const historicalVolumes = bars.slice(-20).map((b) => b.v);
    const vs = detectVolumeSpike(quote.volume, historicalVolumes);
    if (vs) anomalies.push(vs);
  }

  // Price breakout
  if (bars && bars.length >= 20 && quote.price !== null) {
    const pb = detectPriceBreakout(quote.price, bars);
    if (pb) anomalies.push(pb);
  }

  // Gap detection
  const gap = detectGap(quote.open, quote.previousClose);
  if (gap) anomalies.push(gap);

  // RSI extreme
  if (bars && bars.length >= 20) {
    const closes = bars.map((b) => b.c);
    const rsiValues = rsi(closes, 14);
    const lastRSI = rsiValues[rsiValues.length - 1];
    if (lastRSI !== undefined && Number.isFinite(lastRSI)) {
      const rsiAnomaly = detectExtremeRSI(lastRSI);
      if (rsiAnomaly) anomalies.push(rsiAnomaly);
    }
  }

  // Spread
  const spreadAnomaly = detectUnusualSpread(quote.bid, quote.ask, quote.price);
  if (spreadAnomaly) anomalies.push(spreadAnomaly);

  // Direction
  const changePct = quote.changePct ?? 0;
  const direction = changePct > 0.5 ? "bullish" : changePct < -0.5 ? "bearish" : "neutral";

  // Risk score (0-100)
  let riskScore = 25; // base risk
  if (anomalies.filter((a) => a.severity === "critical").length > 0) riskScore += 40;
  else if (anomalies.filter((a) => a.severity === "warning").length > 0) riskScore += 20;
  if (anomalies.filter((a) => a.severity === "info").length > 0) riskScore += 10;
  if (quote.feedStatus === "DELAYED_PUBLIC") riskScore += 15;
  if (quote.feedStatus === "ERROR") riskScore += 50;
  riskScore = Math.min(100, riskScore);

  // Technical summary
  let technicalSummary = "";
  if (bars && bars.length >= 26) {
    const closes = bars.map((b) => b.c);
    const ma20 = sma(closes, 20);
    const lastMA20 = ma20[ma20.length - 1];
    const price = quote.price ?? 0;
    const macdResult = macd(closes);
    const lastMACD = macdResult.macd[macdResult.macd.length - 1];
    const lastSignal = macdResult.signal[macdResult.signal.length - 1];

    const parts: string[] = [];
    if (lastMA20 !== undefined && Number.isFinite(lastMA20)) {
      parts.push(
        price > lastMA20 ? "价格高于 MA20（偏多）" : "价格低于 MA20（偏空）"
      );
    }
    if (lastMACD !== undefined && lastSignal !== undefined && Number.isFinite(lastMACD) && Number.isFinite(lastSignal)) {
      parts.push(
        lastMACD > lastSignal ? "MACD 金叉区域" : "MACD 死叉区域"
      );
    }
    technicalSummary = parts.join("；") || "指标数据不足";
  } else {
    technicalSummary = "需要至少 26 根 K 线数据";
  }

  // Headline
  const directionText = changePct > 0 ? "上涨" : changePct < 0 ? "下跌" : "持平";
  let headline = `${quote.instrument.name} ${directionText} ${Math.abs(changePct).toFixed(2)}%`;
  if (sectorData && sectorData.avgChangePct !== 0) {
    const relativeStrength = changePct - sectorData.avgChangePct;
    const rsLabel = relativeStrength > 0 ? "强于" : "弱于";
    headline += `，${rsLabel}板块`;
  }

  // Drivers
  const drivers = [
    `最新价 ${quote.price?.toFixed(4) ?? "--"} ${quote.instrument.currency}`,
    `成交量 ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(quote.volume ?? 0)}，成交额 ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(quote.turnover ?? 0)}`,
    quote.bid !== null && quote.ask !== null
      ? `买一 ${quote.bid.toFixed(4)} / 卖一 ${quote.ask.toFixed(4)}`
      : "当前公开源未返回盘口深度",
  ];

  // Risk
  let risk = "";
  if (quote.feedStatus === "LICENSED_REALTIME") {
    risk = "当前行情来自已配置的持牌实时数据接口。";
  } else if (quote.feedStatus === "MARKET_CLOSED_LAST_TICK") {
    risk = "当前展示的是最近一个交易时段的最后公开 tick。";
  } else if (quote.feedStatus === "ERROR") {
    risk = quote.providerMessage;
  } else {
    risk = "公开免费行情源可能存在延迟、限频或字段缺失。";
  }
  if (anomalies.length > 0) {
    risk += ` 检测到 ${anomalies.length} 个异常信号。`;
  }

  // Next check
  const status = quote.feedStatus === "LICENSED_REALTIME"
    ? "LICENSED LIVE"
    : quote.feedStatus === "LIVE_PUBLIC"
    ? "PUBLIC LIVE"
    : quote.feedStatus === "DELAYED_PUBLIC"
    ? "PUBLIC DELAYED"
    : quote.feedStatus === "MARKET_CLOSED_LAST_TICK"
    ? "LAST TICK"
    : "FEED ERROR";
  const nextCheck = `${status} / ${new Date(quote.timestamp).toLocaleString("zh-CN", { hour12: false })}`;

  return {
    headline,
    drivers,
    risk,
    nextCheck,
    anomalies,
    technicalSummary,
    riskScore,
    direction,
  };
}
