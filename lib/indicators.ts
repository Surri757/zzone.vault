// ---------------------------------------------------------------------------
// Technical Indicators — pure functions, client-side compatible
// All functions accept number arrays and return same-length arrays with
// NaN for undefined leading values.
// ---------------------------------------------------------------------------

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export interface StochasticResult {
  k: number[];
  d: number[];
}

// ---------------------------------------------------------------------------
// Simple Moving Average
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): number[] {
  if (period <= 0 || values.length === 0) return new Array(values.length).fill(NaN);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    result.push(i >= period - 1 ? sum / period : NaN);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exponential Moving Average
// ---------------------------------------------------------------------------

export function ema(values: number[], period: number): number[] {
  if (period <= 0 || values.length === 0) return new Array(values.length).fill(NaN);
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  // Seed with SMA for the first period
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
    if (i === period - 1) {
      result[i] = sum / period;
    } else {
      result[i] = NaN;
    }
  }

  for (let i = period; i < values.length; i++) {
    result.push((values[i] - result[i - 1]) * multiplier + result[i - 1]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// MACD (Moving Average Convergence Divergence)
// ---------------------------------------------------------------------------

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const fastEMA = ema(values, fastPeriod);
  const slowEMA = ema(values, slowPeriod);
  const macdLine: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(fastEMA[i]) || Number.isNaN(slowEMA[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }
  }

  const signalLine = ema(macdLine.filter((v) => !Number.isNaN(v)), signalPeriod);

  // Pad signal line to match original length
  const signalPadded: number[] = [];
  let sigIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (Number.isNaN(macdLine[i])) {
      signalPadded.push(NaN);
    } else {
      signalPadded.push(sigIdx < signalLine.length ? signalLine[sigIdx] : NaN);
      sigIdx++;
    }
  }

  const histogram: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (Number.isNaN(macdLine[i]) || Number.isNaN(signalPadded[i])) {
      histogram.push(NaN);
    } else {
      histogram.push(macdLine[i] - signalPadded[i]);
    }
  }

  return { macd: macdLine, signal: signalPadded, histogram };
}

// ---------------------------------------------------------------------------
// RSI (Relative Strength Index)
// ---------------------------------------------------------------------------

export function rsi(values: number[], period = 14): number[] {
  if (values.length < period + 1) return new Array(values.length).fill(NaN);

  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Smoothed
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export function bollingerBands(
  values: number[],
  period = 20,
  stdDev = 2
): BollingerResult {
  const middle = sma(values, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(middle[i]) || i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);

    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }

  return { upper, lower, middle };
}

// ---------------------------------------------------------------------------
// ATR (Average True Range)
// ---------------------------------------------------------------------------

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  if (highs.length < 2) return new Array(highs.length).fill(NaN);

  const trueRanges: number[] = [NaN]; // First bar has no previous close

  for (let i = 1; i < highs.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trueRanges.push(tr);
  }

  // Use Wilder's smoothing (same as EMA with period)
  const result: number[] = [NaN];
  let avgTR = 0;
  let count = 0;

  for (let i = 1; i < trueRanges.length; i++) {
    if (Number.isNaN(trueRanges[i])) {
      result.push(NaN);
      continue;
    }
    count++;
    if (count <= period) {
      avgTR += trueRanges[i];
      if (count === period) {
        avgTR /= period;
        result.push(avgTR);
      } else {
        result.push(NaN);
      }
    } else {
      avgTR = (avgTR * (period - 1) + trueRanges[i]) / period;
      result.push(avgTR);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Stochastic Oscillator
// ---------------------------------------------------------------------------

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): StochasticResult {
  const kRaw: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      kRaw.push(NaN);
      continue;
    }

    const sliceHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const sliceLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const range = sliceHigh - sliceLow;
    kRaw.push(range === 0 ? 50 : ((closes[i] - sliceLow) / range) * 100);
  }

  const k = [...kRaw];
  const d = new Array(closes.length).fill(NaN);
  for (let i = kPeriod + dPeriod - 2; i < closes.length; i++) {
    const window = kRaw.slice(i - dPeriod + 1, i + 1);
    if (window.every(Number.isFinite)) {
      d[i] = window.reduce((sum, value) => sum + value, 0) / dPeriod;
    }
  }

  return { k, d };
}

// ---------------------------------------------------------------------------
// Utility: detect crossover signals
// ---------------------------------------------------------------------------

export function crossover(
  fast: number[],
  slow: number[]
): Array<{ index: number; type: "golden" | "dead" }> {
  const signals: Array<{ index: number; type: "golden" | "dead" }> = [];
  for (let i = 1; i < fast.length; i++) {
    if (Number.isNaN(fast[i]) || Number.isNaN(slow[i])) continue;
    if (Number.isNaN(fast[i - 1]) || Number.isNaN(slow[i - 1])) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      signals.push({ index: i, type: "golden" });
    } else if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      signals.push({ index: i, type: "dead" });
    }
  }
  return signals;
}
