import "server-only";

import exchangesJson from "@/data/atlas-exchanges.json";
import { stateAt, type AtlasExchange } from "@/lib/atlas-session";

/**
 * 舆图信号 —— 每盏灯的当地基准指数（现价/涨跌幅），灯色编码涨跌。
 * 本机网络实测（2026-09）：Yahoo 全线 429/403 封禁；可用源分三层——
 *   腾讯 qt.gtimg.cn：CN/HK/US 指数（一次批量，GBK，含昨收与时间戳）
 *   新浪 hq.sinajs.cn：int_ 全球指数子集（日经/富时/多伦多/巴西，需 Referer）
 *   东财 63.push2：其余世界指数（ulist 批量，f3 即涨跌幅；有频控 → 长缓存）
 * 未覆盖的交易所（欧洲小所/中东/南非等）不配信号源：灯保持时区状态语义。
 *
 * 纪律：市场感知缓存（开市 20s / 闭市 600s；东财整体 600s）+ 整包单飞；
 * 任一层失败保留上一份真实数据，绝不造模拟回退。
 */

export interface AtlasSignal {
  mic: string;
  indexName: string;
  price: number | null;
  changePct: number | null;
  timestamp: string | null;
  status: "LIVE_PUBLIC" | "DELAYED_PUBLIC" | "MARKET_CLOSED_LAST_TICK" | "ERROR";
}

interface IndexSource {
  provider: "tencent" | "sina" | "eastmoney";
  symbol: string;
  name: string;
}

const INDEX_FOR: Record<string, IndexSource> = {
  XSHG: { provider: "tencent", symbol: "sh000001", name: "上证指数" },
  XSHE: { provider: "tencent", symbol: "sz399001", name: "深证成指" },
  XBSE: { provider: "tencent", symbol: "bj899050", name: "北证 50" },
  XHKG: { provider: "tencent", symbol: "hkHSI", name: "恒生指数" },
  XNYS: { provider: "tencent", symbol: "usIXIC", name: "纳斯达克综合" },
  XJPX: { provider: "sina", symbol: "int_nikkei", name: "日经 225" },
  XLON: { provider: "sina", symbol: "int_ftse", name: "富时 100" },
  XTSE: { provider: "sina", symbol: "int_sptsx", name: "S&P/TSX 综合" },
  BVMF: { provider: "sina", symbol: "int_bovespa", name: "Ibovespa" },
  XKRX: { provider: "eastmoney", symbol: "KS11", name: "KOSPI" },
  XTAI: { provider: "eastmoney", symbol: "TWII", name: "台湾加权" },
  XSES: { provider: "eastmoney", symbol: "STI", name: "海峡时报" },
  XNSE: { provider: "eastmoney", symbol: "NIFTY", name: "Nifty 50" },
  XASX: { provider: "eastmoney", symbol: "AS51", name: "ASX 200" },
  XETR: { provider: "eastmoney", symbol: "GDAXI", name: "DAX" },
  XPAR: { provider: "eastmoney", symbol: "FCHI", name: "CAC 40" },
};

const EXCHANGES: AtlasExchange[] = Array.isArray((exchangesJson as unknown as { exchanges?: unknown }).exchanges)
  ? ((exchangesJson as unknown as { exchanges?: AtlasExchange[] }).exchanges ?? []).filter(
      (e) => e && typeof e.mic === "string" && typeof e.tz === "string"
    )
  : [];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const TTL_OPEN_MS = 20_000;
const TTL_CLOSED_MS = 600_000;
const TTL_EASTMONEY_MS = 600_000; // 东财有频控，无论开闭市都按 10 分钟节流

const cache = new Map<string, { at: number; signal: AtlasSignal }>();
const eastmoneyAt = { last: 0, map: new Map<string, AtlasSignal>() };
let bundleInflight: Promise<Record<string, AtlasSignal>> | null = null;
let bundleAt = 0;

function statusFor(mic: string, tsMs: number | null): AtlasSignal["status"] {
  const exch = EXCHANGES.find((e) => e.mic === mic);
  if (!exch) return "ERROR";
  const st = stateAt(exch, new Date());
  if (st === "CLOSED" || st === "PRE") return "MARKET_CLOSED_LAST_TICK";
  const age = tsMs !== null ? Date.now() - tsMs : Infinity;
  return age >= 0 && age < 10 * 60_000 ? "LIVE_PUBLIC" : "DELAYED_PUBLIC";
}

async function fetchTencent(mics: string[]): Promise<void> {
  if (mics.length === 0) return;
  const syms = mics.map((m) => INDEX_FOR[m].symbol);
  const res = await fetch(`https://qt.gtimg.cn/q=${syms.join(",")}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tencent ${res.status}`);
  const text = new TextDecoder("gbk").decode(await res.arrayBuffer());
  const re = /v_([^=]+)="([^"]*)"/g;
  for (const m of text.matchAll(re)) {
    const key = m[1] ?? "";
    const mic = mics.find((k) => INDEX_FOR[k].symbol === key);
    if (!mic) continue;
    const f = (m[2] ?? "").split("~");
    if (f.length < 5) continue;
    const raw = String(f[30] ?? "");
    let tsMs: number | null = null;
    if (/^\d{14}$/.test(raw)) {
      tsMs = new Date(
        `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+08:00`
      ).getTime();
    } else if (/^\d{4}[-/]\d{2}[-/]\d{2}\s/.test(raw)) {
      const d = new Date(raw.replace(/\//g, "-").replace(" ", "T"));
      tsMs = Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    put(mic, INDEX_FOR[mic], num(f[3]), num(f[4]), tsMs);
  }
}

async function fetchSina(mics: string[]): Promise<void> {
  if (mics.length === 0) return;
  const syms = mics.map((m) => INDEX_FOR[m].symbol);
  const res = await fetch(`https://hq.sinajs.cn/list=${syms.join(",")}`, {
    cache: "no-store",
    headers: { Referer: "https://finance.sina.com.cn" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sina ${res.status}`);
  const text = new TextDecoder("gb18030").decode(await res.arrayBuffer());
  const re = /var hq_str_([^=]+)="([^"]*)"/g;
  for (const m of text.matchAll(re)) {
    const mic = mics.find((k) => INDEX_FOR[k].symbol === m[1]);
    if (!mic) continue;
    const f = (m[2] ?? "").split(",");
    if (f.length < 4) continue; // 空行情 = 代码不存在
    put(mic, INDEX_FOR[mic], num(f[1]), null, null, f);
  }
}

// sina 的 int_ 指数体是「名称,现价,涨跌额,涨跌幅」——无昨收，直接给 pct
function put(mic: string, src: IndexSource, price: number | null, prev: number | null, tsMs: number | null, rawFields?: Array<string | null>) {
  if (rawFields && rawFields.length >= 4 && prev === null) {
    const pct = num(rawFields[3]);
    const signal: AtlasSignal = {
      mic,
      indexName: src.name,
      price,
      changePct: pct,
      timestamp: null,
      status: statusFor(mic, null)
    };
    cache.set(mic, { at: Date.now(), signal });
    return;
  }
  const pct = price !== null && prev ? Number((((price - prev) / prev) * 100).toFixed(4)) : null;
  const signal: AtlasSignal = {
    mic,
    indexName: src.name,
    price,
    changePct: pct,
    timestamp: tsMs !== null ? new Date(tsMs).toISOString() : null,
    status: statusFor(mic, tsMs),
  };
  cache.set(mic, { at: Date.now(), signal });
}

async function fetchEastmoneyKline(mic: string): Promise<void> {
  const src = INDEX_FOR[mic];
  const url = `https://63.push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.${encodeURIComponent(
    src.symbol
  )}&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=1`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Referer: "https://quote.eastmoney.com/",
      // 裸 undici UA 在东财部分网关吃 520（2026-09-21 线上断供）；带完整浏览器 UA
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eastmoney ${res.status}`);
  const payload = await res.json();
  const d = payload?.data;
  // data 为空 = secid 不存在：静默降级为无信号灯（不重试轰炸）
  if (!d || !Array.isArray(d.klines) || d.klines.length === 0) return;
  const parts = String(d.klines[d.klines.length - 1]).split(",");
  put(mic, src, num(parts[1]), num(d.preKPrice), null);
  eastmoneyAt.map.set(mic, cache.get(mic)!.signal);
}

/** 全量信号：三层并行，整包单飞 + 最小间隔。 */
export async function getAtlasSignals(): Promise<{ asOf: string; signals: Record<string, AtlasSignal> }> {
  if (bundleInflight) return { asOf: new Date().toISOString(), signals: await bundleInflight };
  if (Date.now() - bundleAt < 5_000) {
    return { asOf: new Date().toISOString(), signals: snapshot() };
  }
  const mics = Object.keys(INDEX_FOR);
  const by = (p: IndexSource["provider"]) => mics.filter((m) => INDEX_FOR[m].provider === p);
  const run = (async () => {
    const em = by("eastmoney");
    const jobs: Array<Promise<void>> = [
      fetchTencent(by("tencent")).catch(() => undefined),
      fetchSina(by("sina")).catch(() => undefined),
    ];
    // 东财频控节流：10 分钟窗口外才重新拉取
    if (Date.now() - eastmoneyAt.last >= TTL_EASTMONEY_MS) {
      for (const mic of em) jobs.push(fetchEastmoneyKline(mic).catch(() => undefined));
      eastmoneyAt.last = Date.now();
    }
    await Promise.all(jobs);
    bundleAt = Date.now();
    return snapshot();
  })();
  bundleInflight = run.finally(() => {
    bundleInflight = null;
  }) as Promise<Record<string, AtlasSignal>>;
  return { asOf: new Date().toISOString(), signals: await bundleInflight };
}

function snapshot(): Record<string, AtlasSignal> {
  const out: Record<string, AtlasSignal> = {};
  for (const mic of Object.keys(INDEX_FOR)) {
    const hit = cache.get(mic);
    if (hit) out[mic] = hit.signal;
  }
  return out;
}
