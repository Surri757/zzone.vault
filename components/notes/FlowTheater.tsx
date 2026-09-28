"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * 手记 · 分时资金剧场 —— 一日主力资金流向的重演。
 *
 * 数据：/api/notes/flow（东财行业板块分钟级累计主力净流入，净流入/净流出各前 6）。
 * 三幕：上午 09:30-11:30 / 下午 13:00-15:00 / 整天（午休折叠），按钮切换即重演；
 * 进度条可来回拖动，按住暂停、松手续播；空格播放暂停，←→ 步进，1/2/3 切幕。
 *
 * 光的语法（与封面/大厅/舆图同一盏灯）：每线一色、一线一激光圆点——暖族=净流入
 * （榜首仍取站点金）、凉族=净流出（榜首仍取站点玉），头部光点为加法光（lighter），
 * 全线另有同色光底衬让每条都醒目；播放即帧（RAF），暂停/收敛即停帧；reduced-motion
 * 不自动播，直接呈现收盘全景，拖动照常。崩溃纪律：接口失败→誊写失败卡（可重试，
 * 不造假数据）；单板块缺分钟→前值填充；画布不可用→只渲染 DOM 骨架。
 */

type Mode = "am" | "pm" | "day";

interface FlowPoint {
  t: string;
  v: number;
}
interface FlowSeries {
  code: string;
  name: string;
  points: FlowPoint[];
}
interface FlowBundle {
  asOf: string;
  date: string;
  state: "盘中" | "午盘" | "收盘";
  series: FlowSeries[];
}

interface StageModel {
  names: string[];
  amTimes: string[];
  pmTimes: string[];
  amIdx: Map<string, number>;
  pmIdx: Map<string, number>;
  am: Float64Array[];
  pm: Float64Array[];
}

/** 幕内线条外观：每线一色（暖族入、凉族出），终点绝对值大者更粗更亮、光点更大 */
interface LineVisual {
  si: number;
  rgb: [number, number, number];
  width: number;
  alpha: number;
  /** 0..1，按该幕终点 |值| 在全部线中的排位：光点大小、粗细都跟它走 */
  rank: number;
}

const GOLD: [number, number, number] = [245, 215, 110];
const JADE: [number, number, number] = [127, 183, 163];
const SILVER: [number, number, number] = [226, 236, 255];
const PAPER = "229, 221, 202";

const MODE_ZH: Record<Mode, string> = { am: "上午", pm: "下午", day: "整天" };
const STATE_ZH: Record<FlowBundle["state"], string> = { 盘中: "盘中实录", 午盘: "午盘暂歇", 收盘: "收盘全录" };
const MODE_TICKS: Record<Mode, string[]> = {
  am: ["09:30", "10:00", "10:30", "11:00", "11:30"],
  pm: ["13:00", "13:30", "14:00", "14:30", "15:00"],
  day: ["09:30", "10:30", "11:30", "14:00", "15:00"],
};

/** 播放节奏：每秒推进的交易分钟数（整天 240 分 ≈ 37 秒看完一日） */
const FRAMES_PER_SEC = 6.5;
const BOOT_SEC = 0.9;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${clamp(a, 0, 1).toFixed(3)})`;
const fmtYi = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}亿`;
/** 紧凑数值（窄屏）：≥10 亿取整、个位数保 1 位小数，省横向空间 */
const fmtYiC = (v: number) => `${v >= 0 ? "+" : ""}${Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10}亿`;
/** 向白提亮（标签名用线色时保夜底可读） */
const tint = (c: [number, number, number], f: number): [number, number, number] => [
  Math.round(c[0] + (255 - c[0]) * f),
  Math.round(c[1] + (255 - c[1]) * f),
  Math.round(c[2] + (255 - c[2]) * f),
];

/** HSL → RGB（夜底上取中高明度，保证每条线都醒目） */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((p[0] + m) * 255), Math.round((p[1] + m) * 255), Math.round((p[2] + m) * 255)];
}

/* 每线一色的色相表：相邻名次色相差 ≥ 34°，明度再奇偶错开，深底上个个分明。
   暖族（净流入）覆盖金/橙/朱/绯/品红弧，凉族（净流出）覆盖玉/青/蓝/黛/紫弧。 */
const WARM_HUES = [46, 12, 70, 350, 28, 84, 336, 52, 8, 62, 322, 40, 76, 356, 20, 66];
const COOL_HUES = [160, 196, 138, 224, 118, 250, 178, 286, 148, 210, 128, 268];
const familyColor = (fam: "warm" | "cool", k: number): [number, number, number] => {
  const hues = fam === "warm" ? WARM_HUES : COOL_HUES;
  const hue = hues[k % hues.length];
  const lift = Math.floor(k / hues.length) * 0.07; // 榜单超长（罕见）整体提亮避重
  return fam === "warm"
    ? hsl(hue, k % 2 === 0 ? 0.85 : 0.95, (k % 2 === 0 ? 0.7 : 0.57) + lift)
    : hsl(hue, k % 2 === 0 ? 0.55 : 0.8, (k % 2 === 0 ? 0.64 : 0.5) + lift);
};

function buildStage(bundle: FlowBundle): StageModel | null {
  const amSet = new Set<string>();
  const pmSet = new Set<string>();
  for (const s of bundle.series) {
    for (const p of s.points) {
      if (p.t < "12:00") amSet.add(p.t);
      else pmSet.add(p.t);
    }
  }
  const amTimes = [...amSet].sort();
  const pmTimes = [...pmSet].sort();
  if (amTimes.length + pmTimes.length < 4) return null;
  const amIdx = new Map(amTimes.map((t, i) => [t, i]));
  const pmIdx = new Map(pmTimes.map((t, i) => [t, i]));

  // 前值填充：单板块缺某分钟时沿用上一笔，曲线不断线
  const fill = (times: string[], series: FlowSeries) => {
    const out = new Float64Array(times.length);
    let carry = 0;
    let j = 0;
    const pts = series.points.filter((p) => (times === amTimes ? p.t < "12:00" : p.t >= "12:00"));
    for (let i = 0; i < times.length; i++) {
      while (j < pts.length && pts[j].t <= times[i]) {
        carry = pts[j].v;
        j++;
      }
      out[i] = carry;
    }
    return out;
  };
  return {
    names: bundle.series.map((s) => s.name),
    amTimes,
    pmTimes,
    amIdx,
    pmIdx,
    am: bundle.series.map((s) => fill(amTimes, s)),
    pm: bundle.series.map((s) => fill(pmTimes, s)),
  };
}

function modeLen(model: StageModel, mode: Mode): number {
  if (mode === "am") return model.amTimes.length;
  if (mode === "pm") return model.pmTimes.length;
  return model.amTimes.length + model.pmTimes.length;
}

function timeAt(model: StageModel, mode: Mode, i: number): string {
  if (mode === "am") return model.amTimes[i] ?? "--:--";
  if (mode === "pm") return model.pmTimes[i] ?? "--:--";
  return i < model.amTimes.length ? (model.amTimes[i] ?? "--:--") : (model.pmTimes[i - model.amTimes.length] ?? "--:--");
}

function valueAt(model: StageModel, mode: Mode, si: number, i: number): number {
  if (mode === "am") return model.am[si][i] ?? 0;
  if (mode === "pm") return model.pm[si][i] ?? 0;
  return i < model.amTimes.length ? (model.am[si][i] ?? 0) : (model.pm[si][i - model.amTimes.length] ?? 0);
}

/** 时刻 → 幕内帧号（整幕把下午拼接到上午之后，午休折叠）。
 *  精确时刻不存在时取「≤t 的最近一帧」：分钟线首笔常为 09:31 而非 09:30，
 *  09:30/13:00 这类边界刻度仍应落在首帧上。 */
function frameOfTime(model: StageModel, mode: Mode, t: string): number | undefined {
  const floorIdx = (times: string[], idx: Map<string, number>) => {
    const hit = idx.get(t);
    if (hit !== undefined) return hit;
    if (times.length === 0 || t < times[0]) return 0;
    return undefined; // 超出尾端（如 15:01）不显示
  };
  if (mode === "am") return floorIdx(model.amTimes, model.amIdx);
  if (mode === "pm") return floorIdx(model.pmTimes, model.pmIdx);
  if (t < "12:00") return floorIdx(model.amTimes, model.amIdx);
  const j = floorIdx(model.pmTimes, model.pmIdx);
  return j === undefined ? undefined : model.amTimes.length + j;
}

/** 幕内线条外观：每线一色——同族内名次相邻者色相/明度双错开；
 *  终点绝对值大者线更粗更亮、光点更大；画序按 |值| 升序，最大者压最上层 */
function lineVisuals(model: StageModel, mode: Mode): LineVisual[] {
  const len = modeLen(model, mode);
  const finals: Array<{ si: number; v: number }> = [];
  for (let si = 0; si < model.names.length; si++) finals.push({ si, v: valueAt(model, mode, si, len - 1) });
  const rankOf = new Map<number, number>();
  [...finals]
    .sort((a, b) => Math.abs(a.v) - Math.abs(b.v))
    .forEach((f, i) => rankOf.set(f.si, finals.length > 1 ? i / (finals.length - 1) : 1));
  const mk = (f: { si: number }, rgb: [number, number, number]): LineVisual => {
    const rank = rankOf.get(f.si) ?? 0;
    return { si: f.si, rgb, width: lerp(1.5, 2.6, rank), alpha: lerp(0.85, 1, rank), rank };
  };
  const coolAsc = finals.filter((f) => f.v < 0).sort((a, b) => a.v - b.v); // 净流出最深在前
  const warmDesc = finals.filter((f) => f.v > 0).sort((a, b) => b.v - a.v); // 榜首在前（配色序）
  const warmAsc = [...warmDesc].reverse();
  const flat = finals.filter((f) => f.v === 0);
  const out: LineVisual[] = [];
  coolAsc.forEach((f, i) => out.push(mk(f, i === 0 ? JADE : familyColor("cool", i)))); // 榜首仍取站点玉
  flat.forEach((f) => out.push(mk(f, SILVER)));
  warmAsc.forEach((f) => out.push(mk(f, familyColor("warm", warmDesc.indexOf(f))))); // 榜首（k=0）≈站点金
  return out;
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

export default function FlowTheater() {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  /** 源状态三态：live=新鲜 / 断供（stale|blocked）=数据停在真实旧刻 / dead=本地服务器无响应。
   *  四种故障可辨：东财抖动、我被封、指纹歧视（都表现为断供）与服务器死（dead） */
  const [sourceLag, setSourceLag] = useState<"live" | "stale" | "blocked" | "dead">("live");
  const netFailsRef = useRef(0);
  const baseTitleRef = useRef("");
  const [bundle, setBundle] = useState<FlowBundle | null>(null);
  const [mode, setMode] = useState<Mode>("day");
  const [playing, setPlaying] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const kickRef = useRef<() => void>(() => {});

  const modeRef = useRef<Mode>("day");
  const playingRef = useRef(false);
  const frameTRef = useRef(0);
  const draggingRef = useRef(false);
  const bootTRef = useRef(0);
  const modelRef = useRef<StageModel | null>(null);
  const visualsRef = useRef<LineVisual[]>([]);
  const structKeyRef = useRef("");
  const prevLenRef = useRef(0);
  /** 标签缓动状态（跨帧保留）：y=缓动中的行位、xk=聚簇错列偏移、side=翻侧、mg=悬停放大。
   *  缓动即恒常身份——换序是滑移让位，不再整列重排瞬跳 */
  const labelAnimRef = useRef(new Map<number, { y: number; xk: number; side: number; mg: number }>());
  /** 指针位置（舞台内坐标，null=不在场）：驱动标签悬停/触摸放大；触摸抬手即清 */
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  /** 本帧指针是否落在某标签上（点标签不触发播放暂停） */
  const hitLabelRef = useRef(false);

  const kick = useCallback(() => kickRef.current(), []);

  /* ---------------- 数据装载（失败自动续一次，再失败留人工重试） ---------------- */
  const load = useCallback(async (retry = true) => {
    setPhase("loading");
    try {
      const res = await fetch("/api/notes/flow", { cache: "no-store" });
      if (!res.ok) throw new Error(`行情源 ${res.status}`);
      const data = (await res.json()) as FlowBundle;
      if (!data || !Array.isArray(data.series) || data.series.length < 2) throw new Error("手记数据不足");
      setBundle(data);
      setPhase("ready");
    } catch (e) {
      if (retry) {
        setTimeout(() => void load(false), 4000);
        return;
      }
      setErrorMsg(e instanceof Error ? e.message : "未知错误");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  /* ---------------- 自动更新：盘中每分钟静默拉新；收盘后 10 分钟兜底跨日换卷 ----------------
     结构变（日期/盘面状态：上午收盘→午盘、午后开盘、15:00 收盘）→ 当前幕自动重演；
     盘中同态追加（每分钟新数据）→ 无缝接续，不重播不跳变，贴着边看的人自动跟到新边。 */
  const flowSig = (b: FlowBundle) => `${b.date}|${b.state}|${b.series.map((s) => `${s.code}:${s.points.length}`).join(",")}`;
  useEffect(() => {
    if (phase !== "ready" || !bundle) return;
    const ms = bundle.state === "收盘" ? 600_000 : 60_000;
    let alive = true;
    const tick = async () => {
      // 后台标签页不轰行情源——本地 dev 全天轮询把本机 IP 送进东财黑名单（2026-09-21）
      if (document.hidden) return;
      try {
        const res = await fetch("/api/notes/flow", { cache: "no-store" });
        if (!alive) return;
        netFailsRef.current = 0; // 服务器应答了，哪怕 502 也不是死
        if (!res.ok) {
          const h = res.headers.get("X-Flow-Health");
          setSourceLag(h === "stale" ? "stale" : "blocked");
          return;
        }
        const data = (await res.json()) as FlowBundle;
        if (!alive || !Array.isArray(data?.series) || data.series.length < 2) return;
        const h = res.headers.get("X-Flow-Health");
        setSourceLag(h === "stale" || h === "blocked" ? (h as "stale" | "blocked") : "live");
        setBundle((prev) => (prev && flowSig(prev) === flowSig(data) ? prev : data));
      } catch {
        // 网络级异常 = 连不上本地服务器：连续 3 次判死（dev 服务器死过两天无人知晓的教训）
        netFailsRef.current += 1;
        if (netFailsRef.current >= 3) setSourceLag("dead");
      }
    };
    const id = window.setInterval(tick, ms);
    const onVisible = () => {
      if (!document.hidden) void tick(); // 回到前台立即补一次，不等整段间隔
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bundle?.date, bundle?.state]);

  /* ---------------- 源状态三态：标题前缀，后台标签不点开即见 ---------------- */
  useEffect(() => {
    if (!baseTitleRef.current) baseTitleRef.current = document.title;
    const base = baseTitleRef.current;
    document.title =
      sourceLag === "dead" ? `[无服务] ${base}` : sourceLag !== "live" ? `[断供] ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [sourceLag]);

  const model = useMemo(() => (bundle ? buildStage(bundle) : null), [bundle]);
  const visuals = useMemo(() => (model ? lineVisuals(model, mode) : []), [model, mode]);
  const total = model ? modeLen(model, mode) : 0;
  const modeAvailable = useMemo(
    () => ({ am: !!model && model.amTimes.length >= 2, pm: !!model && model.pmTimes.length >= 2, day: !!model }),
    [model]
  );

  /* ---------------- 画布引擎（数据就绪后一次性构建，卸载全拆） ---------------- */
  useEffect(() => {
    if (phase !== "ready" || !model) return;
    modelRef.current = model;

    const stageEl = stageRef.current;
    const canvasEl = canvasRef.current;
    if (!stageEl || !canvasEl) return;
    const ctxEl = canvasEl.getContext("2d");
    if (!ctxEl) return;
    const stage = stageEl;
    const canvas = canvasEl;
    const ctx = ctxEl;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let displayFont = "";
    let monoFont = "";
    let sansFont = "";
    try {
      const cs = getComputedStyle(document.documentElement);
      displayFont = cs.getPropertyValue("--ink-font-display").trim();
      monoFont = cs.getPropertyValue("--ink-font-mono").trim();
      sansFont = cs.getPropertyValue("--ink-font-sans").trim();
    } catch {
      /* 用内建兜底字体 */
    }
    const fontOf = (kind: "display" | "mono" | "sans", px: number) => {
      const fam =
        kind === "display"
          ? displayFont || '"Noto Serif SC", "Songti SC", serif'
          : kind === "mono"
            ? monoFont || 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
            : sansFont || '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      return `${px}px ${fam}`;
    };

    let W = 0;
    let H = 0;
    let DPR = 1;
    let disposed = false;
    let raf = 0;
    let running = false;
    let last = performance.now();
    let lastFrameKey = -1;
    let labelMotion = 0; // 标签缓动未收敛量（px），>0.5 时维持排帧直到收敛

    const layout = () => {
      const compact = W < 640;
      return {
        padT: compact ? 46 : 64,
        padB: 26,
        padL: compact ? 34 : 46,
        padR: 10,
        labelFont: compact ? 10 : 12,
        bigFont: compact ? 20 : 27,
      };
    };

    /* y 轴范围：该幕全程（不随播放跳变），含 0、留 10% 呼吸 */
    const yRange = () => {
      const m = modelRef.current;
      if (!m) return { lo: -1, hi: 1 };
      const md = modeRef.current;
      const len = modeLen(m, md);
      let lo = 0;
      let hi = 0;
      for (let si = 0; si < m.names.length; si++) {
        for (let i = 0; i < len; i++) {
          const v = valueAt(m, md, si, i);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi - lo < 1e-6) {
        hi = 1;
        lo = -1;
      }
      const pad = (hi - lo) * 0.1;
      return { lo: lo - pad, hi: hi + pad };
    };

    function draw(dtSec: number) {
      const m = modelRef.current;
      const vs = visualsRef.current;
      if (!m || vs.length === 0) return;
      const md = modeRef.current;
      const len = modeLen(m, md);
      if (len < 2) return;
      const L = layout();
      const plotL = L.padL;
      const plotR = W - L.padR;
      const plotT = L.padT;
      const plotB = H - L.padB;
      const plotW = Math.max(10, plotR - plotL);
      const plotH = Math.max(10, plotB - plotT);
      const { lo, hi } = yRange();
      const xOf = (i: number) => plotL + (i / (len - 1)) * plotW;
      const yOf = (v: number) => plotT + ((hi - v) / (hi - lo)) * plotH;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* 网格与轴标 */
      const step = niceStep((hi - lo) / 4);
      ctx.font = fontOf("mono", 10);
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
        const y = yOf(v);
        const isZero = Math.abs(v) < 1e-9;
        ctx.strokeStyle = `rgba(${PAPER}, ${isZero ? 0.3 : 0.09})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
        ctx.stroke();
        if (!isZero) {
          ctx.fillStyle = `rgba(${PAPER}, 0.4)`;
          ctx.fillText(`${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}亿`, 4, y - 3);
        }
      }
      ctx.strokeStyle = `rgba(${PAPER}, 0.22)`;
      ctx.beginPath();
      ctx.moveTo(plotL, plotB + 0.5);
      ctx.lineTo(plotR, plotB + 0.5);
      ctx.stroke();

      /* x 刻度 */
      ctx.textBaseline = "top";
      for (const t of MODE_TICKS[md]) {
        const i = frameOfTime(m, md, t);
        if (i === undefined || i > len - 1) continue;
        const x = xOf(i);
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${PAPER}, 0.38)`;
        ctx.fillText(t, x, plotB + 7);
        ctx.strokeStyle = `rgba(${PAPER}, 0.14)`;
        ctx.beginPath();
        ctx.moveTo(x, plotB);
        ctx.lineTo(x, plotB + 4);
        ctx.stroke();
      }

      /* 午休分界（整天幕）：一道极淡的虚竖线 */
      if (md === "day" && m.amTimes.length > 1 && m.pmTimes.length > 0) {
        const bx = xOf(m.amTimes.length - 1);
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = `rgba(${PAPER}, 0.18)`;
        ctx.beginPath();
        ctx.moveTo(bx, plotT);
        ctx.lineTo(bx, plotB);
        ctx.stroke();
        ctx.restore();
      }

      /* 光标竖线 */
      const f = clamp(frameTRef.current, 0, len - 1);
      const cursorX = xOf(f);
      ctx.strokeStyle = rgba(GOLD, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursorX, plotT);
      ctx.lineTo(cursorX, plotB);
      ctx.stroke();

      /* 线条 + 头部（沿线生长到当前帧，帧间插值保顺滑）。
         两遍画：先加法光底衬（同色晕开，深底上每条都显眼），再画实心主线 */
      const i0 = Math.floor(f);
      const frac = f - i0;
      const heads: Array<{ x: number; y: number; vis: LineVisual; v: number }> = [];
      const bootT = reduced ? 1e9 : bootTRef.current;
      const revealOf = (vis: LineVisual) => clamp((bootT - (vis.si / Math.max(1, vs.length)) * 0.45) / 0.4, 0, 1);
      const traceLine = (vis: LineVisual): { hx: number; hy: number } | null => {
        const reveal = revealOf(vis);
        if (reveal <= 0) return null;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(valueAt(m, md, vis.si, 0)));
        for (let i = 1; i <= i0; i++) ctx.lineTo(xOf(i), yOf(valueAt(m, md, vis.si, i)));
        let hx = xOf(i0);
        let hy = yOf(valueAt(m, md, vis.si, i0));
        if (i0 < len - 1 && frac > 0) {
          hx = lerp(xOf(i0), xOf(i0 + 1), frac);
          hy = lerp(yOf(valueAt(m, md, vis.si, i0)), yOf(valueAt(m, md, vis.si, i0 + 1)), frac);
          ctx.lineTo(hx, hy);
        }
        return { hx, hy };
      };
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const vis of vs) {
        const r = revealOf(vis);
        if (r <= 0) continue;
        const tip = traceLine(vis);
        if (!tip) continue;
        ctx.strokeStyle = rgba(vis.rgb, 0.1 * r);
        ctx.lineWidth = vis.width * 2.8;
        ctx.stroke();
      }
      ctx.restore();
      for (const vis of vs) {
        const r = revealOf(vis);
        if (r <= 0) continue;
        const tip = traceLine(vis);
        if (!tip) continue;
        ctx.strokeStyle = rgba(vis.rgb, vis.alpha * r);
        ctx.lineWidth = vis.width;
        ctx.stroke();
        heads.push({
          x: tip.hx,
          y: tip.hy,
          vis,
          v: valueAt(m, md, vis.si, Math.min(i0 + (frac > 0.5 ? 1 : 0), len - 1)),
        });
      }

      /* 头部激光圆点：晕小而弱（加法光），色核+白热芯用普通合成——
         播放中所有线头同处一列，加法光大晕会叠曝成一团，小晕+实核才颗颗分明 */
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const h of heads) {
        const R = lerp(5.5, 8.5, h.vis.rank);
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, R);
        g.addColorStop(0, rgba(h.vis.rgb, 0.55 * h.vis.alpha));
        g.addColorStop(1, rgba(h.vis.rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(h.x, h.y, R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      for (const h of heads) {
        ctx.fillStyle = rgba(h.vis.rgb, 0.98);
        ctx.beginPath();
        ctx.arc(h.x, h.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 252, 240, 0.95)";
        ctx.beginPath();
        ctx.arc(h.x, h.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 标签系统：值对齐为默认——y 就取线头 y，相邻碰撞时一维推挤摊开；
         位移自适应：只给到「刚好不重叠」的量，硬顶 5×标签高，宁可短暂多让
         一点也不叠字；仍挤的聚簇水平错列借右侧空白；y 与偏移跨帧指数缓动
         （缓动即恒常身份）；引线只在被推离 >10px 时渐现；深底衬保可读；
         名字一律全称。悬停/触摸命中的标签缓动放大压顶（鼠标 hover 与手指
         按住同样生效，移开复原，点标签不触发播放暂停）。 */
      const L_H = L.labelFont + 4; // 标签高
      const PITCH = L.labelFont + (W < 640 ? 4 : 6); // 期望行距（窄屏更紧）
      const TAU = (draggingRef.current ? 60 : 120) / 1000; // 拖动跟手用快缓动
      const ease = 1 - Math.exp(-dtSec / (reduced ? 0.001 : TAU));
      const anim = labelAnimRef.current;
      const states = [...heads]
        .sort((a, b) => a.y - b.y)
        .map((h) => {
          let st = anim.get(h.vis.si);
          if (!st) {
            st = { y: h.y, xk: 0, side: 1, mg: 0 };
            anim.set(h.vis.si, st);
          }
          return { h, st, Y: h.y, k: 0 };
        });
      for (let i = 1; i < states.length; i++) states[i].Y = Math.max(states[i].Y, states[i - 1].Y + PITCH);
      for (let i = states.length - 2; i >= 0; i--) states[i].Y = Math.min(states[i].Y, states[i + 1].Y - PITCH);
      // 自适应位移上限：全摊开实际需要多少就给多少（只多 1px 余量），硬顶 5×标签高
      let need = 0;
      for (const s of states) need = Math.max(need, Math.abs(s.Y - s.h.y));
      const DMAX = Math.min(need + 1, L_H * 5);
      for (const s of states) s.Y = clamp(s.Y, s.h.y - DMAX, s.h.y + DMAX);
      for (const s of states) s.Y = clamp(s.Y, plotT + L.labelFont * 0.6, plotB);
      // 聚簇识别：推挤后仍紧挨（<1 个标签高）的连成一簇，簇内序 k 驱动水平错列
      for (let i = 1; i < states.length; i++) {
        states[i].k = states[i].Y - states[i - 1].Y < L_H ? states[i - 1].k + 1 : 0;
      }
      const tickW = 2.5;
      const padX = 6;
      const innerX = 5;
      labelMotion = 0;
      const compact = W < 640;
      const kCap = compact ? 0 : 3; // 窄屏无横向错列空间，聚簇全靠纵向摊开
      const lab = states.map((s) => {
        const shown = m.names[s.h.vis.si] ?? ""; // 全称，不截断
        const valText = compact ? fmtYiC(s.h.v) : fmtYi(s.h.v);
        ctx.font = fontOf("sans", L.labelFont);
        const nameW = ctx.measureText(shown).width;
        ctx.font = fontOf("mono", L.labelFont);
        const valW = ctx.measureText(valText).width;
        const groupW = tickW + padX + nameW + innerX + valW;
        const k = Math.min(s.k, kCap);
        const kTarget = k * (groupW + 6);
        s.st.y += (s.Y - s.st.y) * ease;
        s.st.xk += (kTarget - s.st.xk) * ease;
        // 翻侧（近右缘整组挪到线头左侧），24px 滞回防抖
        const room = W - 6 - (s.h.x + 8 + s.st.xk + groupW);
        if (s.st.side === 1) {
          if (room < 0) s.st.side = -1;
        } else if (room > 24) {
          s.st.side = 1;
        }
        labelMotion = Math.max(labelMotion, Math.abs(s.Y - s.st.y), Math.abs(kTarget - s.st.xk));
        const side = s.st.side;
        // 整组夹进画布：无论翻侧与否，绝不允许标签被屏幕边缘截断
        const x0 = clamp(s.h.x + side * (8 + s.st.xk) - (side === 1 ? 0 : groupW), 2, Math.max(2, W - 8 - groupW));
        return { h: s.h, st: s.st, shown, valText, nameW, valW, groupW, side, x0 };
      });
      /* 悬停/触摸命中：取绘制序最上层者；命中热区比标签矩形大一圈（手指好按） */
      const pp = pointerPosRef.current;
      let hoverSi = -1;
      if (pp) {
        for (let i = lab.length - 1; i >= 0; i--) {
          const p = lab[i];
          if (pp.x >= p.x0 - 10 && pp.x <= p.x0 + p.groupW + 14 && Math.abs(pp.y - p.st.y) <= L_H / 2 + 9) {
            hoverSi = p.h.vis.si;
            break;
          }
        }
      }
      hitLabelRef.current = hoverSi >= 0;
      for (const p of lab) {
        const target = p.h.vis.si === hoverSi ? 1 : 0;
        p.st.mg += (target - p.st.mg) * ease;
        labelMotion = Math.max(labelMotion, Math.abs(target - p.st.mg) * 24);
      }
      // 引线（垫在标签之下）：被推离线头（纵向 >10px）或横向脱开（>26px）时渐现——
      // 肘形（光点→横 5px→斜到标签近缘），窄屏标签被夹进画布后靠它保持归属
      for (const p of lab) {
        const d = Math.abs(p.st.y - p.h.y);
        const nearX = p.side === 1 ? p.x0 - 2 : p.x0 + p.groupW + 2;
        const dx = Math.abs(nearX - p.h.x);
        const a = Math.min(1, Math.max(d - 10, dx - 26) / 10);
        if (a <= 0) continue;
        ctx.strokeStyle = rgba(p.h.vis.rgb, 0.6 * a);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.h.x, p.h.y);
        ctx.lineTo(p.h.x + (nearX > p.h.x ? 5 : -5), p.h.y);
        ctx.lineTo(nearX, p.st.y);
        ctx.stroke();
      }
      // 标签本体：深底衬 → 色块 → 中文名（线色，全称）→ 数值（纸白）
      const anyCtx = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };
      const drawLabelBody = (p: (typeof lab)[number], chipAlpha: number) => {
        const y = p.st.y;
        ctx.fillStyle = `rgba(12, 14, 18, ${chipAlpha})`;
        if (typeof anyCtx.roundRect === "function") {
          ctx.beginPath();
          anyCtx.roundRect(p.x0 - 4, y - L_H / 2, p.groupW + 8, L_H, 4);
          ctx.fill();
        } else {
          ctx.fillRect(p.x0 - 4, y - L_H / 2, p.groupW + 8, L_H);
        }
        ctx.fillStyle = rgba(p.h.vis.rgb, 0.95);
        ctx.fillRect(p.x0, y - 3, tickW, 6);
        ctx.font = fontOf("sans", L.labelFont);
        ctx.textAlign = "left";
        ctx.fillStyle = rgba(tint(p.h.vis.rgb, 0.22), 0.95);
        ctx.fillText(p.shown, p.x0 + tickW + padX, y);
        ctx.font = fontOf("mono", L.labelFont);
        ctx.fillStyle = `rgba(${PAPER}, 0.85)`;
        ctx.fillText(p.valText, p.x0 + tickW + padX + p.nameW + innerX, y);
      };
      ctx.textBaseline = "middle";
      for (const p of lab) drawLabelBody(p, 0.85);
      // 悬停放大层：命中的标签以中心为轴缓动放大 + 同色光晕，压到最上层
      for (const p of lab) {
        if (p.st.mg <= 0.01) continue;
        const s = 1 + 0.42 * p.st.mg;
        const cx = p.x0 + (p.groupW + 8) / 2;
        ctx.save();
        ctx.translate(cx, p.st.y);
        ctx.scale(s, s);
        ctx.translate(-cx, -p.st.y);
        ctx.shadowColor = rgba(p.h.vis.rgb, 0.8 * p.st.mg);
        ctx.shadowBlur = 20 * p.st.mg;
        drawLabelBody(p, 0.96);
        ctx.restore();
      }

      /* 大字时刻 + 领头板块 + 幕内进度 */
      const iShown = Math.min(len - 1, Math.round(f));
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const topY = L.padT - (W < 640 ? 14 : 20);
      ctx.font = fontOf("display", L.bigFont);
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.fillText(timeAt(m, md, iShown), plotL + 2, topY);
      let top: { name: string; v: number } | null = null;
      for (const h of heads) {
        if (!top || Math.abs(h.v) > Math.abs(top.v)) top = { name: m.names[h.vis.si] ?? "", v: h.v };
      }
      if (top) {
        ctx.font = fontOf("sans", W < 640 ? 10 : 11.5);
        ctx.fillStyle = `rgba(${PAPER}, 0.62)`;
        ctx.fillText(`${top.name} ${fmtYi(top.v)}`, plotL + (W < 640 ? 54 : 78), topY + 1);
      }
      ctx.font = fontOf("mono", 10);
      ctx.fillStyle = `rgba(${PAPER}, 0.34)`;
      ctx.fillText(`${MODE_ZH[md]} · 第 ${iShown + 1}/${len} 笔`, plotL + 2, L.padT - 4);
    }

    /* DOM 直写：进度柄 + 读数（RAF 频率，不走 React） */
    function writeDom() {
      const m = modelRef.current;
      if (!m) return;
      const len = modeLen(m, modeRef.current);
      const f = clamp(frameTRef.current, 0, Math.max(0, len - 1));
      const handle = handleRef.current;
      if (handle) handle.style.left = `${((f / Math.max(1, len - 1)) * 100).toFixed(2)}%`;
      const read = readoutRef.current;
      if (read) {
        const i = Math.round(f);
        read.textContent = `${timeAt(m, modeRef.current, i)} · ${i + 1}/${len} 笔`;
      }
    }

    function loop(nowP: number) {
      if (disposed) return;
      const dt = Math.min(0.05, (nowP - last) / 1000);
      last = nowP;
      if (W < 50 || H < 50) {
        running = false; // 零尺寸（隐藏/未布局）：停帧，resize 会重启
        return;
      }
      const m = modelRef.current;
      if (!m) {
        running = false;
        return;
      }
      const len = modeLen(m, modeRef.current);
      let active = false;
      if (playingRef.current && !draggingRef.current) {
        frameTRef.current += dt * FRAMES_PER_SEC;
        if (frameTRef.current >= len - 1) {
          frameTRef.current = len - 1;
          playingRef.current = false;
          setPlaying(false);
        }
        active = true;
      }
      if (bootTRef.current < BOOT_SEC + 0.6) {
        bootTRef.current += dt;
        active = true;
      }
      if (draggingRef.current) active = true;
      draw(dt);
      if (labelMotion > 0.5) active = true; // 标签缓动未收敛：继续排帧直到贴稳
      writeDom();
      const key = Math.round(frameTRef.current * 2);
      if (active || key !== lastFrameKey) {
        lastFrameKey = key;
        raf = requestAnimationFrame(loop);
      } else {
        running = false; // 收敛停帧（暂停且无动画）
      }
    }
    function ensureLoop() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
    kickRef.current = ensureLoop;

    function resize() {
      const rect = stage.getBoundingClientRect();
      W = Math.max(0, rect.width);
      H = Math.max(0, rect.height);
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      ensureLoop();
    }

    resize();
    let ro: ResizeObserver | null = null;
    let resizeTimer = 0;
    const onResizeDebounced = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    };
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResizeDebounced);
      ro.observe(stage);
    } else {
      window.addEventListener("resize", onResizeDebounced);
    }
    document.fonts?.ready.then(() => {
      if (!disposed) resize();
    });

    /* 指针在场感：hover/触摸移动即更新位置并排帧（驱动标签悬停放大）；
       触摸抬手清除（复原），鼠标离场清除 */
    const setPointer = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      pointerPosRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      ensureLoop();
    };
    const clearPointer = () => {
      pointerPosRef.current = null;
      ensureLoop();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") clearPointer();
    };
    stage.addEventListener("pointermove", setPointer, { passive: true });
    stage.addEventListener("pointerdown", setPointer, { passive: true });
    stage.addEventListener("pointerup", onPointerUp, { passive: true });
    stage.addEventListener("pointercancel", onPointerUp, { passive: true });
    stage.addEventListener("pointerleave", clearPointer, { passive: true });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      ro?.disconnect();
      window.removeEventListener("resize", onResizeDebounced);
      stage.removeEventListener("pointermove", setPointer);
      stage.removeEventListener("pointerdown", setPointer);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("pointerleave", clearPointer);
      kickRef.current = () => {};
    };
  }, [phase, model]); // visuals/mode 经 refs 注入，引擎不随切幕重建

  /* visuals 注入引擎（引擎经 ref 读取，不随切幕/追加重建） */
  useEffect(() => {
    visualsRef.current = visuals;
  }, [visuals]);

  /* 切幕：从头重演当前幕（reduced-motion 则直接看结局） */
  useEffect(() => {
    modeRef.current = mode;
    labelAnimRef.current.clear(); // 换幕：标签状态重置，直接落位新幕线头
    const m = modelRef.current;
    if (!m) return;
    const len = modeLen(m, mode);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frameTRef.current = reduced ? Math.max(0, len - 1) : 0;
    playingRef.current = !reduced;
    setPlaying(!reduced);
    kick();
  }, [mode, kick]);

  /* 数据落位：结构变（日期/盘面状态）→ 当前幕自动重演；盘中同态追加 → 无缝接续 */
  const structKey = bundle ? `${bundle.date}|${bundle.state}` : "";
  useEffect(() => {
    if (!model) return;
    modelRef.current = model;
    const structural = structKeyRef.current !== structKey;
    structKeyRef.current = structKey;
    if (modeLen(model, modeRef.current) < 2 && modeRef.current !== "day") {
      setMode("day"); // 当前幕尚无数据（如午后未开），回落整天并由切幕效应重演
      return;
    }
    const len = modeLen(model, modeRef.current);
    if (structural) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      frameTRef.current = reduced ? Math.max(0, len - 1) : 0;
      playingRef.current = !reduced;
      setPlaying(!reduced);
      labelAnimRef.current.clear(); // 结构换卷（日期/盘面态变化）：标签重置落位
    } else {
      // 追加：贴着旧尾的人跟到新尾（直播边），其余位置原地保留
      const wasAtEnd = frameTRef.current >= prevLenRef.current - 1.01;
      frameTRef.current = wasAtEnd ? Math.max(0, len - 1) : clamp(frameTRef.current, 0, Math.max(0, len - 1));
    }
    prevLenRef.current = len;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, structKey, kick]);

  const togglePlay = useCallback(() => {
    const m = modelRef.current;
    if (!m) return;
    const len = modeLen(m, modeRef.current);
    if (!playingRef.current && frameTRef.current >= len - 1) frameTRef.current = 0; // 播完再按 = 重演
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
    kick();
  }, [kick]);

  const switchMode = useCallback(
    (next: Mode) => {
      if (next === modeRef.current) {
        frameTRef.current = 0; // 再点同一幕 = 从头重演
        playingRef.current = true;
        setPlaying(true);
        kick();
        return;
      }
      setMode(next);
    },
    [kick]
  );

  /* 进度条拖动：按住即暂停，松手续播（若原在播且未到末尾） */
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !model) return;
    let wasPlaying = false;
    const frameFromEvent = (e: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      const p = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const len = modeLen(model, modeRef.current);
      frameTRef.current = p * Math.max(0, len - 1);
      kick();
    };
    const onDown = (e: PointerEvent) => {
      bar.setPointerCapture?.(e.pointerId);
      wasPlaying = playingRef.current;
      playingRef.current = false;
      draggingRef.current = true;
      setPlaying(false);
      frameFromEvent(e);
    };
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) frameFromEvent(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      bar.releasePointerCapture?.(e.pointerId);
      draggingRef.current = false;
      if (wasPlaying && frameTRef.current < modeLen(model, modeRef.current) - 1) {
        playingRef.current = true;
        setPlaying(true);
      }
      kick();
    };
    bar.addEventListener("pointerdown", onDown);
    bar.addEventListener("pointermove", onMove, { passive: true });
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
    return () => {
      bar.removeEventListener("pointerdown", onDown);
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
    };
  }, [model, kick]);

  /* 键盘：空格播放/暂停，←→ 步进，1/2/3 切幕 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, a, input, textarea, [role='slider']")) return;
      const m = modelRef.current;
      if (!m) return;
      const len = modeLen(m, modeRef.current);
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        frameTRef.current = clamp(frameTRef.current + (e.key === "ArrowRight" ? 8 : -8), 0, len - 1);
        kick();
      } else if (e.key === "1" && modeAvailable.am) switchMode("am");
      else if (e.key === "2" && modeAvailable.pm) switchMode("pm");
      else if (e.key === "3") switchMode("day");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, switchMode, modeAvailable, kick]);

  /* 进度条刻度（切幕时静态渲染） */
  const barTicks = useMemo(() => {
    if (!model) return [];
    const len = modeLen(model, mode);
    const out: Array<{ t: string; pct: number }> = [];
    for (const t of MODE_TICKS[mode]) {
      const i = frameOfTime(model, mode, t);
      if (i === undefined || i > len - 1) continue;
      out.push({ t, pct: (i / Math.max(1, len - 1)) * 100 });
    }
    return out;
  }, [model, mode]);

  return (
    <div className="notes-root">
      <header className="notes-head">
        <div>
          <div className="hall-topline">
            <p className="notes-kicker">Ninglo · Vault of Ink</p>
            <Link href="/modules" className="hall-return" aria-label="返回主页面 · 模块大厅" title="返回大厅">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5m0 0 6 6m-6-6 6-6" />
              </svg>
              返回大厅
            </Link>
          </div>
          <h1 className="notes-title">手记</h1>
          <p className="notes-sub">分时资金剧场 · 一日主力流向的重演，每线一色 · 暖入凉出</p>
        </div>
        <p className="notes-clock" aria-live="off">
          {bundle ? `${bundle.date} · ${STATE_ZH[bundle.state]}` : "—"}
        </p>
      </header>

      <main
        className={`notes-stage${phase !== "ready" ? " is-idle" : ""}`}
        ref={stageRef}
        onClick={() => phase === "ready" && !hitLabelRef.current && togglePlay()}
        role="img"
        aria-label="分时主力资金流向重演：点击画布可播放或暂停，下方进度条可来回拖动"
      >
        <canvas ref={canvasRef} className="notes-canvas" />
        {phase === "loading" && (
          <div className="notes-veil">
            <p className="notes-veil-text">正在誊写今日手记 …</p>
            <p className="notes-veil-sub">行业与题材板块 · 分钟级主力净流入</p>
          </div>
        )}
        {phase === "error" && (
          <div className="notes-veil">
            <p className="notes-veil-text">今日手记暂缺</p>
            <p className="notes-veil-sub">行情源未应答（{errorMsg || "未知"}）—— 不以假数据补白</p>
            <button className="notes-retry" onClick={() => void load(true)}>
              重试
            </button>
          </div>
        )}
        {phase === "ready" && sourceLag !== "live" && (
          <div className="notes-lag" role="status">
            {sourceLag === "dead"
              ? "本地服务无响应"
              : sourceLag === "blocked"
                ? "行情源断供 · 无存粮"
                : "行情源断供"}
            {" · 数据截至 "}
            {bundle
              ? new Date(bundle.asOf).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "Asia/Shanghai",
                })
              : "—"}
          </div>
        )}
      </main>

      <footer className="notes-controls">
        <div className="notes-controls-row">
          <button
            className={`notes-play${playing ? " is-playing" : ""}`}
            onClick={togglePlay}
            aria-label={playing ? "暂停" : "播放"}
            disabled={phase !== "ready"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="notes-seg" role="group" aria-label="时段选择">
            {(["am", "pm", "day"] as Mode[]).map((m) => (
              <button
                key={m}
                className={`notes-seg-btn${mode === m ? " is-on" : ""}`}
                onClick={() => switchMode(m)}
                disabled={!modeAvailable[m]}
                aria-pressed={mode === m}
              >
                {MODE_ZH[m]}
              </button>
            ))}
          </div>
          <p className="notes-legend">
            <i className="is-in" /> 净流入
            <i className="is-out" /> 净流出
          </p>
        </div>

        <div
          className="notes-bar"
          ref={barRef}
          role="slider"
          aria-label="进度：拖动可在本时段内来回播放"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, total - 1)}
          tabIndex={0}
        >
          <div className="notes-bar-track">
            {barTicks.map((tk) => (
              <span key={tk.t} className="notes-bar-tick" style={{ left: `${tk.pct}%` }}>
                {tk.t}
              </span>
            ))}
            <div className="notes-bar-handle" ref={handleRef}>
              <i />
            </div>
          </div>
        </div>

        <p className="notes-read">
          {bundle ? (
            <>
              <span ref={readoutRef}>—</span>
              <span className="notes-read-dim">
                {` · ${MODE_ZH[mode]} · ${bundle.date} · 数据：东方财富公开行情（主力净流入，累计）`}
              </span>
            </>
          ) : (
            "—"
          )}
        </p>
      </footer>
    </div>
  );
}
