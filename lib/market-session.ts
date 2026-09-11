import type { StockMarket } from "@/lib/stock-catalog";

// Single source of truth for exchange trading hours. This module is imported by
// both server route handlers and client components, so it must stay free of
// Node/server-only dependencies — `StockMarket` is a type-only import, which
// keeps the 3 MB catalog JSON out of the client bundle.

export const MARKET_TIME_ZONE: Record<StockMarket, string> = {
  CN: "Asia/Shanghai",
  US: "America/New_York"
};

// Minutes from local midnight. CN trades two sessions with a lunch break;
// the US trades one continuous session.
const CN_MORNING_OPEN = 570; // 09:30
const CN_MORNING_CLOSE = 690; // 11:30
const CN_LUNCH_CLOSE = 780; // 13:00
const CN_AFTERNOON_CLOSE = 900; // 15:00
const US_OPEN = 570; // 09:30
const US_CLOSE = 960; // 16:00

export type ScheduledSessionState = "OPEN" | "BREAK" | "CLOSED";

/** Human-readable session label, matching what the quote instrument reports. */
export function marketSessionLabel(market: StockMarket): string {
  return market === "CN"
    ? "Asia/Shanghai 09:30-11:30 / 13:00-15:00"
    : "America/New_York 09:30-16:00";
}

/**
 * Weekday and minutes-past-midnight in the market's own time zone.
 *
 * A weekday clock alone cannot detect exchange holidays, so callers that must
 * not report a holiday as live should corroborate with a real bar timestamp.
 */
export function zonedSessionClock(date: Date, market: StockMarket) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE[market],
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((record, part) => {
      if (part.type !== "literal") record[part.type] = part.value;
      return record;
    }, {});

  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

/** Scheduled session state from the clock alone — ignores holidays. */
export function scheduledSessionState(
  market: StockMarket,
  date = new Date()
): ScheduledSessionState {
  const { weekday, minutes } = zonedSessionClock(date, market);
  if (weekday === "Sat" || weekday === "Sun") return "CLOSED";

  if (market === "US") {
    return minutes >= US_OPEN && minutes < US_CLOSE ? "OPEN" : "CLOSED";
  }

  if (
    (minutes >= CN_MORNING_OPEN && minutes < CN_MORNING_CLOSE) ||
    (minutes >= CN_LUNCH_CLOSE && minutes < CN_AFTERNOON_CLOSE)
  ) {
    return "OPEN";
  }
  return minutes >= CN_MORNING_CLOSE && minutes < CN_LUNCH_CLOSE ? "BREAK" : "CLOSED";
}

/** True only while the regular session is scheduled to be trading. */
export function isMarketScheduledOpen(market: StockMarket, date = new Date()): boolean {
  return scheduledSessionState(market, date) === "OPEN";
}
