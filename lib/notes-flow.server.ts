import "server-only";

import { fetchEast, probeEast, emBanned, emBanRetryInMs, emChannel } from "./em-transport";
import { fetchMirrorDay, fetchMirrorLatest, mirrorStatus } from "./flow-mirrors";
import { UpstreamGuard, loadLastGood, persistLastGood } from "./upstream-guard";

/**
 * 手记取数 —— 分时主力资金剧场的数据侧（v4 快照差分架构，2026-09-23 定案）。
 *
 * 数据链两化（五路子代深讨 + akshare/efinance 调研归纳）：
 *   榜单+现值  clist 快照（fs=m:90 t:2 行业/t:3 概念，fid=f62 今日累计主力净流入，
 *              po=1/po=0 各取头部）——**每分钟 4 个小请求同时给出榜单与全部在榜板块
 *              的当前累计值**，本地差分即得分钟级曲线（akshare 同源做法）；
 *   全天历史   fflow/kline 仅两种情况才拉整条：当日冷启动（早上第一包）、
 *              盘中新面孔进榜（一次一条）。
 *   稳态请求量 32/min → 4/min（8 倍缩减），这是防封的第一根支柱；
 *   第二根支柱在 em-transport：Windows 原生 curl 指纹通道 + 全局令牌桶 + IP 封禁冷却。
 *
 * 纪律：整包单飞 + 最小间隔 5s + 按盘面状态定 TTL（盘中 60s/收盘 600s）；
 * 任一层失败保留上一份真实数据，绝不造模拟回退；残缺包（<70% 板块）整包作废。
 */

export interface NotesFlowPoint {
  /** "HH:MM" 交易所当地时间（东财即北京时间） */
  t: string;
  /** 累计主力净流入，亿元（3 位小数） */
  v: number;
}

export interface NotesFlowSeries {
  code: string;
  name: string;
  points: NotesFlowPoint[];
}

export interface NotesFlowBundle {
  asOf: string;
  /** 数据交易日 "YYYY-MM-DD" */
  date: string;
  state: "盘中" | "午盘" | "收盘";
  series: NotesFlowSeries[];
}

const TOP_IN = 16;
const TOP_OUT = 12;
const MIN_INTERVAL_MS = 5000;
const TTL_BY_STATE_MS: Record<NotesFlowBundle["state"], number> = {
  盘中: 60_000, // 每分钟长出新数据
  午盘: 240_000, // 午休数据静止，4 分钟内探测午后开盘
  收盘: 600_000,
};

/** 快照/fflow 共用主机（同一延迟层级，避免拼接缝跳变；封禁冷却会自动收缩梯子成本） */
const HOSTS = ["push2delay.eastmoney.com", "push2.eastmoney.com", "63.push2.eastmoney.com"];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 断言 clist 页确有数据：限流网关会回 HTTP 200 + data:null 空壳 */
function clistRows(page: unknown): Array<Record<string, unknown>> {
  const rows = (page as { data?: { diff?: unknown } })?.data?.diff;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("eastmoney 空榜单页");
  return rows as Array<Record<string, unknown>>;
}

async function fetchEastByHost(path: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (const host of HOSTS) {
    try {
      return await fetchEast(`https://${host}${path}`);
    } catch (e) {
      lastErr = e;
      if (emBanned()) break; // 封禁冷却已开：梯子立刻收缩，不再换主机补刀
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("eastmoney unreachable");
}

/**
 * 板块语义过滤：概念榜头部常混入属性/宽基伪板块（融资融券、MSCI、昨日系、
 * 破增发价股、权重股…），先剔除再选净流入/净流出头部。
 */
const ATTR_EXACT = new Set([
  "融资融券", "转融券标的", "MSCI中国", "富时罗素", "标普道琼斯", "茅指数", "宁组合", "权重股",
  "东方财富热股", "同花顺热股", "百元股", "低价股", "高价股", "破净股", "绩优股", "微盘股",
  "次新股", "注册制次新股", "近端次新股", "预盈预增", "预亏预减", "高送转", "股权激励",
  "员工持股", "举牌", "壳资源", "独角兽", "转债标的", "AB股", "AH股", "B股", "H股", "GDR", "CDR",
  "创蓝筹", "科技风格", "周期股", "白马股", "蓝筹股",
]);
const ATTR_PREFIX = [
  "昨日", "连续", "机构重仓", "基金重仓", "社保重仓", "QFII重仓", "券商重仓", "保险重仓", "信托重仓",
  "融资融券", "转融券", "沪股通", "深股通", "MSCI", "富时", "标普", "标准普尔", "HS", "上证", "沪深", "中证", "深证", "深成",
  "创业板", "科创板", "北交所", "百元", "低价", "高价", "破净", "绩优", "微盘", "ST", "*ST", "次新", "近端",
  "股权激励", "员工持", "回购", "增持", "举牌", "预盈", "预亏", "壳", "注册制", "东方财富", "同花顺", "转债",
  "百亿", "千亿", "万亿", "大盘", "中盘", "小盘", "价值", "成长", "预增", "预减", "中报", "年报", "季报",
  "高市", "低市", "近期", "近日", "百日", "历史新", "持续", "放量", "缩量", "强势", "两融", "破增",
];
const ATTR_TAIL_RE = /(?:50|100|180|300|500|800|1000)[_ ]?$/;
const ATTR_YEAR_RE = /^20\d{2}/;

function isAttrBoard(name: string): boolean {
  if (ATTR_EXACT.has(name)) return true;
  if (ATTR_PREFIX.some((p) => name.startsWith(p))) return true;
  if (ATTR_YEAR_RE.test(name)) return true;
  return ATTR_TAIL_RE.test(name);
}

interface SnapshotBoard {
  code: string;
  name: string;
  /** 今日累计主力净流入，亿元 */
  flowYi: number;
}

/** 板块快照：行业+概念 × 净流入/净流出 4 页，一次拿到榜单与全部在榜现值 */
async function fetchSnapshot(): Promise<SnapshotBoard[]> {
  const base = "/api/qt/clist/get?pn=1&pz=24&np=1&fltt=2&invt=2&fid=f62&fields=f12%2Cf14%2Cf62";
  const paths = ["m%3A90%2Bt%3A2", "m%3A90%2Bt%3A3"].flatMap((fs) => [
    `${base}&po=1&fs=${fs}`,
    `${base}&po=0&fs=${fs}`,
  ]);
  const pages = await Promise.all(paths.map((p) => fetchEastByHost(p)));
  const boards = new Map<string, SnapshotBoard>();
  for (const page of pages) {
    for (const row of clistRows(page)) {
      const code = String(row.f12 ?? "");
      const name = String(row.f14 ?? "");
      const flow = num(row.f62);
      if (!/^BK\d+$/.test(code) || !name || flow === null) continue;
      if (isAttrBoard(name)) continue;
      boards.set(code, { code, name, flowYi: Math.round((flow / 1e8) * 1000) / 1000 });
    }
  }
  const all = [...boards.values()];
  const inflow = all.filter((b) => b.flowYi > 0).sort((a, b) => b.flowYi - a.flowYi).slice(0, TOP_IN);
  const outflow = all.filter((b) => b.flowYi < 0).sort((a, b) => a.flowYi - b.flowYi).slice(0, TOP_OUT);
  return [...inflow, ...outflow].sort((a, b) => Math.abs(b.flowYi) - Math.abs(a.flowYi));
}

/** 单板块全天分钟主力净流入（累计，元）→ 亿；仅冷启动/新面孔时整条拉 */
async function fetchBoardFlowDay(code: string): Promise<{ date: string; points: NotesFlowPoint[] }> {
  // 不带 secid2：同板块再传 secid2 会被端点求和，数值翻倍（实测 2026-09）
  const path =
    `/api/qt/stock/fflow/kline/get?lmt=0&klt=1&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56` +
    `&secid=90.${code}`;
  const payload = await fetchEastByHost(path);
  const raw = payload as { klines?: unknown; data?: { klines?: unknown } };
  const klines: string[] = (raw.data?.klines as string[]) ?? (raw.klines as string[]) ?? [];
  const points: NotesFlowPoint[] = [];
  let date = "";
  for (const line of klines) {
    const [stamp, rawV] = line.split(",");
    const v = num(rawV);
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(stamp ?? "");
    if (!m || v === null) continue;
    if (!date) date = m[1];
    points.push({ t: m[2], v: Math.round((v / 1e8) * 1000) / 1000 });
  }
  return { date, points };
}

/** 北京钟面（YYYY-MM-DD / HH:MM）——盘面状态要靠墙钟区分「下午进行中」与「已收盘」 */
function cnClock(): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const h = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${h}:${p.minute}` };
}

/** 盘面状态：分钟末笔分不出「下午盘中」和「已收盘」，必须看墙钟 */
function stateOf(date: string, lastT: string): NotesFlowBundle["state"] {
  const now = cnClock();
  if (date !== now.date) return "收盘"; // 上一交易日的全录（周末/盘前同此）
  if (now.hm >= "15:01") return "收盘"; // 今日已收盘
  if (lastT <= "11:35" && now.hm >= "11:30") return "午盘"; // 上午完，午后未续
  return "盘中";
}

/** 快照差分可记账的分钟：交易时段内，或收盘后补最后一笔 */
function appendableMinute(hm: string, lastT: string): boolean {
  if (hm <= lastT) return false;
  if (hm > "09:30" && hm <= "11:30") return true;
  if (hm > "13:00" && hm <= "15:00") return true;
  if (hm > "15:00" && lastT < "15:00" && lastT >= "09:31") return true; // 收盘定稿笔
  return false;
}

/** 防封熔断（整包层）：连续 3 败退避；配合 em-transport 的 IP 封禁冷却双闸 */
const guard = new UpstreamGuard({ failureThreshold: 3, cooldownMs: 120_000, maxCooldownMs: 30 * 60_000 });

const STALE_SERVE_MS = 6 * 60 * 60 * 1000;

let cached: { at: number; bundle: NotesFlowBundle } | null = null;
let inflight: Promise<NotesFlowBundle> | null = null;
let lastAttemptAt = 0;
let booted = false;

/* ---------------- 腾讯源（2026-09-28 调研+实测定案）：东财失败时的接棒主力 ----------------
 * proxy.finance.qq.com 板块级全套（匿名、零封禁记录、收盘态三处数值自洽实测）：
 *   榜单  rank/pt/getRank?board_type=hy|gn（rank_list[].zljlr = 当日累计主力净流入，万元）
 *   曲线  fundflow/hsfundtab?code=ptXXXX&type=todayFundTrend（minList 全天分钟点，元，
 *         时间戳 YYYYMMDDHHMM 自带交易日——跨周末日期也正确）
 * 口径：主力=超大单+大单（≥20万），与东财同下限；数值不逐点相等、排名高度相关。 */

const TX_BASE = "https://proxy.finance.qq.com/cgi/cgi-bin";
const TX_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Referer: "https://gu.qq.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

async function txJson(path: string): Promise<unknown> {
  const res = await fetch(`${TX_BASE}${path}`, {
    cache: "no-store",
    headers: TX_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tencent ${res.status}`);
  return res.json();
}

interface TxBoard {
  code: string;
  name: string;
  /** 今日累计主力净流入，亿元 */
  flowYi: number;
}

let txRank: { at: number; boards: TxBoard[] } | null = null;
const TX_RANK_TTL_MS = 5 * 60_000;

/** 腾讯板块榜：行业+概念全量（5 分钟缓存），语义过滤后选头部——与东财口径同构 */
async function fetchTxRanking(): Promise<TxBoard[]> {
  if (txRank && Date.now() - txRank.at < TX_RANK_TTL_MS) return txRank.boards;
  const boards = new Map<string, TxBoard>();
  for (const bt of ["hy", "gn"]) {
    for (let offset = 0; offset <= 1000; offset += 200) {
      const p = (await txJson(
        `/rank/pt/getRank?board_type=${bt}&sort_type=priceRatio&direct=down&offset=${offset}&count=200`
      )) as { data?: { rank_list?: Array<Record<string, unknown>> } };
      const rows = p?.data?.rank_list ?? [];
      for (const r of rows) {
        const code = String(r.code ?? "");
        const name = String(r.name ?? "");
        const wan = num(r.zljlr); // 万元
        if (!code.startsWith("pt") || !name || wan === null) continue;
        if (isAttrBoard(name)) continue;
        boards.set(code, { code, name, flowYi: Math.round((wan / 1e4) * 1000) / 1000 });
      }
      if (rows.length < 200) break;
    }
  }
  const all = [...boards.values()];
  const inflow = all.filter((b) => b.flowYi > 0).sort((a, b) => b.flowYi - a.flowYi).slice(0, TOP_IN);
  const outflow = all.filter((b) => b.flowYi < 0).sort((a, b) => a.flowYi - b.flowYi).slice(0, TOP_OUT);
  const top = [...inflow, ...outflow].sort((a, b) => Math.abs(b.flowYi) - Math.abs(a.flowYi));
  if (top.length >= 6) txRank = { at: Date.now(), boards: top };
  return top;
}

/** 腾讯板块全天分钟曲线：minList 每次返回整条（无需差分/冷热分离） */
async function fetchTxBoardDay(code: string): Promise<{ date: string; points: NotesFlowPoint[] }> {
  const p = (await txJson(`/fundflow/hsfundtab?code=${code}&type=todayFundTrend`)) as {
    data?: { todayFundTrend?: { minList?: Array<Record<string, unknown>> } };
  };
  const rows = p?.data?.todayFundTrend?.minList ?? [];
  const points: NotesFlowPoint[] = [];
  let date = "";
  for (const r of rows) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(r.time ?? ""));
    const v = num(r.MainNetInflow); // 元
    if (!m || v === null) continue;
    if (!date) date = `${m[1]}-${m[2]}-${m[3]}`;
    points.push({ t: `${m[4]}:${m[5]}`, v: Math.round((v / 1e8) * 1000) / 1000 });
  }
  return { date, points };
}

/** 腾讯整包：榜单 + 全天曲线（每板一请求、8 并发批，容忍度实测极高） */
async function buildBundleTencent(): Promise<NotesFlowBundle> {
  const top = await fetchTxRanking();
  if (top.length < 6) throw new Error("腾讯板块榜不足");
  const fetched: Array<{ code: string; name: string; date: string; points: NotesFlowPoint[] }> = [];
  for (let i = 0; i < top.length; i += 8) {
    const batch = top.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map((b) => fetchTxBoardDay(b.code)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value.points.length >= 2) {
        fetched.push({ code: batch[j].code, name: batch[j].name, date: r.value.date, points: r.value.points });
      }
    });
  }
  if (fetched.length < Math.max(12, Math.floor(top.length * 0.7))) {
    throw new Error(`腾讯分钟线存活 ${fetched.length}/${top.length}`);
  }
  // 多数派交易日（minList 自带日期，跨周末正确）
  const dateCounts = new Map<string, number>();
  for (const f of fetched) dateCounts.set(f.date, (dateCounts.get(f.date) ?? 0) + 1);
  let date = "";
  let best = 0;
  for (const [d, n] of dateCounts) {
    if (n > best || (n === best && d > date)) {
      date = d;
      best = n;
    }
  }
  const series = fetched.filter((f) => f.date === date).map(({ code, name, points }) => ({ code, name, points }));
  let lastT = "00:00";
  for (const s of series) {
    const t = s.points[s.points.length - 1].t;
    if (t > lastT) lastT = t;
  }
  return { asOf: new Date().toISOString(), date, state: stateOf(date, lastT), series };
}

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const last = await loadLastGood<NotesFlowBundle>(STALE_SERVE_MS);
  if (last && !cached) cached = { at: last.at, bundle: last.payload };
  // 存粮缺席或过期时的地板：昨日的定稿档（收盘重演态，跨日洞的最后一道兜底）
  if (!cached) {
    const y = cnClock().date;
    const dayBefore = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    void fetchMirrorDay(dayBefore).then((b) => {
      if (b && !cached && b.date <= y) {
        cached = { at: Date.now() - 60_000, bundle: { ...b, state: "收盘" } };
        lastSource = "github";
      }
    });
  }
}

/** 快照差分整包：榜单即取即用；在榜老面孔差分追点，新面孔补一条全天 fflow */
async function buildBundle(prev?: NotesFlowBundle): Promise<NotesFlowBundle> {
  const snapshot = await fetchSnapshot();
  if (snapshot.length < 6) throw new Error("板块快照不足");

  const now = cnClock();
  const sameDay = prev?.date === now.date;
  const prevByCode = new Map(
    sameDay && prev ? prev.series.map((s) => [s.code, s.points] as [string, NotesFlowPoint[]]) : []
  );

  const series: NotesFlowSeries[] = [];
  for (const b of snapshot) {
    const base = prevByCode.get(b.code);
    if (base && base.length >= 2) {
      // 差分追点：快照现值即累计值，新分钟落一笔
      const points = [...base];
      if (appendableMinute(now.hm, points[points.length - 1].t)) {
        points.push({ t: now.hm, v: b.flowYi });
      }
      series.push({ code: b.code, name: b.name, points });
      continue;
    }
    // 新面孔/跨日/缓存缺失：整条全天历史（fflow）
    const day = await fetchBoardFlowDay(b.code);
    if (day.points.length >= 2) {
      series.push({ code: b.code, name: b.name, points: day.points });
      continue;
    }
    // fflow 也拿不到（停牌/新股板块）：至少把快照现值记成单点线
    series.push({ code: b.code, name: b.name, points: [{ t: now.hm, v: b.flowYi }] });
  }
  if (series.length < Math.max(12, Math.floor(snapshot.length * 0.7))) {
    throw new Error(`分钟线存活 ${series.length}/${snapshot.length}，疑被限流`);
  }

  let lastT = "00:00";
  let date = sameDay && prev ? prev.date : "";
  for (const s of series) {
    const t = s.points[s.points.length - 1].t;
    if (t > lastT) lastT = t;
    if (!date) date = now.date; // 差分包以墙钟日为准；fflow 整条日与之同日（快照为今日盘）
  }
  return { asOf: new Date().toISOString(), date, state: stateOf(date, lastT), series };
}

/** 全量手记数据：东财直连为主，镜像（GitHub 中继）兜底；失败保留上一份。
 *  双闸：em-transport 的 IP 封禁冷却（请求级）+ guard 熔断（整包级）。
 *  镜像采纳纪律：完整性校验 + asOf 比本地新 + 采纳即落盘成存粮（共生）。 */
let lastSource: "em" | "tencent" | "github" = "em";

async function adoptMirrorIfFresher(): Promise<NotesFlowBundle | null> {
  try {
    const m = await fetchMirrorLatest();
    if (!m) return null;
    const newer = !cached || new Date(m.asOf).getTime() > new Date(cached.bundle.asOf).getTime();
    if (!newer) return null;
    cached = { at: Date.now(), bundle: m };
    lastSource = "github";
    void persistLastGood(m);
    return m;
  } catch {
    return null;
  }
}

/** 东财不可用时的接棒源一：腾讯原生板块接口（同口径、独立风控域） */
async function tryTencent(): Promise<NotesFlowBundle | null> {
  try {
    const bundle = await buildBundleTencent();
    cached = { at: Date.now(), bundle };
    lastSource = "tencent";
    void persistLastGood(bundle);
    return bundle;
  } catch {
    return null;
  }
}

export async function fetchNotesFlow(): Promise<NotesFlowBundle> {
  await boot();
  const ttl = cached ? TTL_BY_STATE_MS[cached.bundle.state] : 0;
  if (cached && Date.now() - cached.at < ttl) return cached.bundle;
  if (emBanned() || guard.blocked) {
    void probeWhenCool(); // 冷却到期先探针，探针通过才放整包
    const tx = await tryTencent(); // 接棒源一：腾讯原生板块接口
    if (tx) return tx;
    const mirror = await adoptMirrorIfFresher(); // 接棒源二：GitHub 中继镜像
    if (mirror) return mirror;
    if (cached && Date.now() - cached.at < STALE_SERVE_MS) return cached.bundle;
    throw new Error(emBanned() ? "行情源 IP 封禁冷却中" : "行情源熔断退避中");
  }
  if (Date.now() - lastAttemptAt < MIN_INTERVAL_MS) {
    if (cached) return cached.bundle;
    throw new Error("行情手记尚未就绪");
  }
  if (inflight) return inflight;
  lastAttemptAt = Date.now();
  const run = (async () => {
    try {
      const bundle = await buildBundle(cached?.bundle);
      cached = { at: Date.now(), bundle };
      lastSource = "em";
      guard.recordSuccess();
      void persistLastGood(bundle);
      return bundle;
    } catch (e) {
      guard.recordFailure();
      const tx = await tryTencent(); // 东财瞬时抖动（如晚间 520）也由腾讯接棒
      if (tx) return tx;
      const mirror = await adoptMirrorIfFresher(); // 再退 GitHub 镜像
      if (mirror) return mirror;
      if (cached && Date.now() - cached.at < STALE_SERVE_MS) return cached.bundle;
      throw e;
    }
  })().finally(() => {
    inflight = null;
  });
  inflight = run;
  return run;
}

/** 冷却到期的单请求探针（与恢复流量同通道）；探针失败自动续冷却 */
let probing: Promise<void> | null = null;
let lastProbeAt = 0;
async function probeWhenCool(): Promise<void> {
  if (Date.now() < lastProbeAt + 60_000) return;
  if (probing) return probing;
  lastProbeAt = Date.now();
  probing = (async () => {
    const ok = await probeEast();
    if (!ok) return;
    // 探针通过：清两层闸，下一次请求即走整包（令牌桶仍全程限速）
    guard.recordSuccess();
    // em-transport 的封禁冷却由 fetchEast 成功时自动清零（recordHealthy）
  })().finally(() => {
    probing = null;
  });
  return probing;
}

/** 诊断快照：健康端点/响应头用 */
export function flowHealth(): {
  channel: string;
  source: "em" | "tencent" | "github";
  banned: boolean;
  banRetryInMs: number;
  breakerFailures: number;
  breakerOpen: boolean;
  cacheAgeMs: number | null;
  state: NotesFlowBundle["state"] | null;
  mirror: { sha: string; ageMs: number | null };
} {
  const st = guard.status();
  return {
    channel: emChannel,
    source: lastSource,
    banned: emBanned(),
    banRetryInMs: emBanRetryInMs(),
    breakerFailures: st.failures,
    breakerOpen: Date.now() < st.openUntil,
    cacheAgeMs: cached ? Date.now() - cached.at : null,
    state: cached?.bundle.state ?? null,
    mirror: mirrorStatus(),
  };
}
