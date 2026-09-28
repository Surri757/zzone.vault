/**
 * 舆图时段引擎 —— 纯函数，无依赖，server/client 双端可用。
 * 数据形状由 scripts/refresh-atlas.mjs 产出（data/atlas-exchanges.json）。
 *
 * 崩溃纪律：任何坏输入（缺字段/坏时区/NaN 日期/空时段）一律收敛为 "CLOSED"，
 * 永不抛异常 —— 灯早亮晚亮是瑕疵，整页白屏是事故。
 */

export type LampState = "OPEN" | "BREAK" | "PRE" | "CLOSED";

export interface AtlasExchange {
  mic: string;
  mics?: string[];
  city: string;
  zh: string;
  lat: number;
  lon: number;
  off?: number[];
  tz: string;
  /** weekday(0=周日) → 当地时间的 [startMin, endMin)[] */
  sessions: Record<string, [number, number][]>;
  /** "YYYY-MM-DD"（交易所当地日期） */
  holidays?: string[];
  /** "YYYY-MM-DD" → 提前收盘的当地分钟数 */
  earlyCloses?: Record<string, number>;
  calendar?: string;
}

export const PRE_WINDOW_MIN = 30;

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export interface ZonedClock {
  weekday: number;
  minutes: number;
  dateKey: string;
}

/** UTC 时刻 → 某时区的 {周几, 当日分钟, 当地日期键}。坏时区回退 UTC，坏日期返回 null。 */
export function zonedClock(date: Date, tz: string): ZonedClock | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(String(tz || "UTC")).formatToParts(date);
  } catch {
    parts = formatterFor("UTC").formatToParts(date);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const hour = Number(get("hour")) % 24;
  const minutes = hour * 60 + Number(get("minute"));
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  return { weekday, minutes, dateKey };
}

function effectiveSegments(exch: AtlasExchange, weekday: number, dateKey: string): [number, number][] {
  const raw = exch?.sessions?.[String(weekday)];
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const segs: [number, number][] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 2) continue;
    const a = Number(s[0]);
    const b = Number(s[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && a < b) segs.push([a, b]);
  }
  if (segs.length === 0) return [];
  segs.sort((x, y) => x[0] - y[0]);
  const ec = Number(exch?.earlyCloses?.[dateKey]);
  if (Number.isFinite(ec) && ec > segs[0][0]) {
    segs[segs.length - 1] = [segs[segs.length - 1][0], Math.min(segs[segs.length - 1][1], ec)];
    if (segs[segs.length - 1][0] >= segs[segs.length - 1][1]) segs.pop();
  }
  return segs;
}

/** 某时刻某交易所的灯态。 */
export function stateAt(exch: AtlasExchange, date: Date, preWindowMin: number = PRE_WINDOW_MIN): LampState {
  if (!exch || typeof exch !== "object") return "CLOSED";
  const clock = zonedClock(date, exch.tz);
  if (!clock) return "CLOSED";
  if (Array.isArray(exch.holidays) && exch.holidays.includes(clock.dateKey)) return "CLOSED";
  const segs = effectiveSegments(exch, clock.weekday, clock.dateKey);
  if (segs.length === 0) return "CLOSED";
  const m = clock.minutes;
  for (const [s, e] of segs) {
    if (m >= s && m < e) return "OPEN";
  }
  for (let i = 0; i + 1 < segs.length; i++) {
    if (m >= segs[i][1] && m < segs[i + 1][0]) return "BREAK";
  }
  const first = segs[0][0];
  const w = Number.isFinite(preWindowMin) ? Math.max(0, preWindowMin) : 0;
  if (m >= first - w && m < first) return "PRE";
  return "CLOSED";
}

/**
 * 当地墙钟 (y, m, d, 分钟) → UTC 毫秒。二分逼近 + DST 跳变线性兜底，误差 ≤ 1 分钟。
 * 被跳过的当地时刻（春令时空档）返回最近的可表达时刻。
 */
export function utcForLocal(tz: string, y: number, m: number, d: number, minutes: number): number {
  const target = Date.UTC(y, m - 1, d) / 60000 + minutes;
  let lo = (target - 16 * 60) * 60000;
  let hi = (target + 16 * 60) * 60000;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const c = zonedClock(new Date(mid), tz);
    if (!c) break;
    const val = Date.UTC(Number(c.dateKey.slice(0, 4)), Number(c.dateKey.slice(5, 7)) - 1, Number(c.dateKey.slice(8, 10))) / 60000 + c.minutes;
    if (val < target) lo = mid;
    else hi = mid;
  }
  let best = Math.round((lo + hi) / 2);
  // DST 落令（本地钟回拨）会让中值偏离：1 分钟步进在 ±2h 内找精确命中
  const score = (t: number) => {
    const c = zonedClock(new Date(t), tz);
    if (!c) return Infinity;
    const val = Date.UTC(Number(c.dateKey.slice(0, 4)), Number(c.dateKey.slice(5, 7)) - 1, Number(c.dateKey.slice(8, 10))) / 60000 + c.minutes;
    return Math.abs(val - target);
  };
  if (score(best) > 0.5) {
    let bestScore = score(best);
    for (let t = best - 120 * 60000; t <= best + 120 * 60000; t += 60000) {
      const s = score(t);
      if (s < bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return Math.round(best / 60000) * 60000;
  }
  // 无跳变：val(lo) < target ≤ val(hi)，取 hi 所在分钟的下缘 =
  // 「首个到达该当地分钟的 UTC 时刻」，避免 round 进位成 09:31 这类 1 分钟虚高
  return Math.floor(hi / 60000) * 60000;
}

/** 下一处灯态边界（开盘/收盘/午休）的 UTC 毫秒；14 天内无则返回 14 天后。 */
export function nextBoundaryAfter(exch: AtlasExchange, tMs: number, maxDays: number = 14): number {
  if (!exch || typeof exch !== "object" || !Number.isFinite(tMs)) return Date.now() + 14 * 86400000;
  const best: number[] = [];
  for (let day = 0; day < maxDays; day++) {
    // day 0 必须取「现在所在的当地日期」：+12h 会让已过正午的时区直接跳到明天，
    // 盘中的当日收盘边界（如 A 股 15:00）就永远算不到了
    const probe = tMs + day * 86400000;
    const clock = zonedClock(new Date(probe), exch.tz);
    if (!clock) continue;
    if (Array.isArray(exch.holidays) && exch.holidays.includes(clock.dateKey)) continue;
    const segs = effectiveSegments(exch, clock.weekday, clock.dateKey);
    if (segs.length === 0) continue;
    const y = Number(clock.dateKey.slice(0, 4));
    const m = Number(clock.dateKey.slice(5, 7));
    const d = Number(clock.dateKey.slice(8, 10));
    for (const [s, e] of segs) {
      for (const b of [s, e]) {
        const bt = utcForLocal(exch.tz, y, m, d, b);
        if (bt > tMs + 1000) best.push(bt);
      }
    }
    if (best.length > 0) return Math.min(...best);
  }
  return tMs + maxDays * 86400000;
}

/** UI 用：某时区的 "HH:mm"（formatter 缓存——updateDial 每帧三次调用，裸构造 0.3-1ms/帧）。 */
const hmCache = new Map<string, Intl.DateTimeFormat>();
export function formatLocalTime(tz: string, date: Date): string {
  try {
    let f = hmCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      hmCache.set(tz, f);
    }
    return f.format(date);
  } catch {
    return "--:--";
  }
}
