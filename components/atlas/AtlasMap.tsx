"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dotsJson from "@/data/atlas-dots.json";
import citiesJson from "@/data/atlas-cities.json";
import exchangesJson from "@/data/atlas-exchanges.json";
import {
  stateAt,
  nextBoundaryAfter,
  formatLocalTime,
  zonedClock,
  type AtlasExchange,
  type LampState,
} from "@/lib/atlas-session";
import { MIC_CC, flagImgFor, dataUri as flagUri } from "./atlas-flags";
import { createGlobeGL, type GlobeGL } from "./globe-gl";
import satsJson from "@/data/atlas-satellites.json";
import { parseTLE, propagate, stale, type SatElement } from "@/lib/atlas-sats";

/**
 * 舆图 —— 墨玉灯球（浑天仪骨架）。Canvas 2D 手写闭式正交投影：
 * 每点单位向量解码期预计算，帧内投影 = 三个点积，零三角函数。
 *
 * 语义三分（球化后的宪法）：
 *   · 空间归球 —— 拖动旋转视角（yaw 无界、pitch 钳 ±75°、北上恒定、无回正，
 *     双击空白海面才回家）；滚轮/双指缩放钳 [1×, 2.2×]
 *   · 时间归盘 —— 底部 24h 刻度盘拨动假想时刻，只翻转 27 灯开闭态，
 *     松手 0.9s 弹回现在；球与晨昏线永不随拨动转动
 *   · 光照归真 —— 城市灯光/晨昏弧/金 tick 只跟真实太阳（60s 随行星自转重画）
 *
 * 光的语法（与封面/大厅同一盏灯）：加法（lighter）、双色温（冷银=机器/预热，
 * 暖金=已点亮）、光一次性（开盘 bloom 600ms）、无运动即无帧（RAF 收敛即停，
 * 静止帧即烘焙——球时代的画布天然无需离屏缓存层）。
 *
 * 崩溃纪律：点阵解码失败→经纬网兜底成球；交易所缺字段→剔除；NaN 视角→
 * 重置回默认方位；canvas 不可用→只渲染 DOM 骨架。任何坏路径不白屏、不抛异常。
 */

const GOLD: [number, number, number] = [245, 215, 110];
const SILVER: [number, number, number] = [226, 236, 255];
const CINNABAR: [number, number, number] = [232, 115, 92]; // 朱涨（--ink-cinnabar 提亮以适夜底）
const PAPER = "229, 221, 202";
const INKPAPER = "201, 212, 228"; // 点阵冷银蓝
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${clamp(a, 0, 1).toFixed(3)})`;

const SCRUB_RANGE_MS = 36 * 3600_000; // 刻度盘拨动钳制 ±36h
const SPRING_SEC = 0.9; // 松手弹回现在
const BOOT_SEC = 1.4; // 开机 = 快进一个昼夜（画圆 → 晨昏扫掠 → 灯火就位）
const HOME_LON = 105; // 双击回家的方位（A股用户开屏见亚洲；北上 + 用户时区经线）
const HOME_LAT = 25;
const PITCH_CLAMP = 75; // 俯仰钳位（公式无奇异，纯交互手感）
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.2;
const INERTIA_TAU = 0.45; // 惯性时间常数（调研收敛：iOS 0.23-0.35 / d3 0.435，地球仪取稍重）
const RELEASE_STILL_MS = 80; // 松手静止窗：窗口内无移动则不起惯性（防「停顿后松手飞出」）
const FLAG_W_MAJOR = 24;
const FLAG_W_MINOR = 19;
const FLAG_W_NARROW = 18;
const CHIP_PAD = 5;
const STATE_TARGET: Record<LampState, number> = { OPEN: 1, BREAK: 0.45, PRE: 0.7, CLOSED: 0.12 };
const STATE_ZH: Record<LampState, string> = { OPEN: "交易中", BREAK: "午休", PRE: "盘前", CLOSED: "休市" };
const DRILL_MARKET: Record<string, "CN" | "US"> = { XSHG: "CN", XSHE: "CN", XBSE: "CN", XNYS: "US", XNAS: "US" };

/** 服务端 /api/atlas/signals 的单灯信号（客户端精简形状） */
interface SignalLite {
  indexName: string;
  price: number | null;
  changePct: number | null;
  status: string;
}

const RAD = Math.PI / 180;
/** 八大交易所：窄屏/旋转中的常显芯片基线（全球一圈的锚点城市） */
const MAJOR_MICS = ["XSHG", "XHKG", "XJPX", "XKRX", "XNSE", "XETR", "XLON", "XNYS"];
const MAJOR_SET = new Set(MAJOR_MICS);

const CITY_COLOR: [number, number, number] = [255, 204, 132]; // 城市灯暖尘
const CITY_SPRITE_N = 2000; // 头部城市暖光晕
const CITY_DEGRADE_N = 8000; // 旋转中/窄屏降级截断（数组人口降序，切片即得）
const LAT_BANDS = 24;
const LON_BINS = 360;
const CITY_LEVELS = 16; // alpha 分桶：同桶共享 fillStyle + 单 path 批量 rect
const TERRAIN_LEVELS = 6;

/* ---------------- 数据资产：解码 + 球面单位向量预计算（模块级一次） ---------------- */

interface DotField {
  n: number;
  lon: Float32Array; // boot 扫掠需要经度
  w: Float32Array;
  px: Float32Array; // 单位向量（地理系：x=0°经线赤道，y=90°E，z=北极）
  py: Float32Array;
  pz: Float32Array;
  band: Int32Array; // 太阳高度 LUT 索引（纬度带）
  bin: Int32Array; // LUT 索引（经度档）
  lv: Uint8Array; // 权重分档
  latTop: number;
  latBottom: number;
}

function decodeDots(): DotField {
  const j = dotsJson as { count?: number; data?: string; latTop?: number; latBottom?: number };
  const latTop = Number.isFinite(j.latTop) ? (j.latTop as number) : 90;
  const latBottom = Number.isFinite(j.latBottom) ? (j.latBottom as number) : -90;
  const empty: DotField = {
    n: 0,
    lon: new Float32Array(0),
    w: new Float32Array(0),
    px: new Float32Array(0),
    py: new Float32Array(0),
    pz: new Float32Array(0),
    band: new Int32Array(0),
    bin: new Int32Array(0),
    lv: new Uint8Array(0),
    latTop,
    latBottom,
  };
  try {
    const bin = atob(String(j.data || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const count = Number(j.count) || 0;
    if (count <= 0 || bytes.length !== count * 5) throw new Error("长度不符");
    const dv = new DataView(bytes.buffer);
    const lons: number[] = [];
    const lats: number[] = [];
    const ws: number[] = [];
    for (let i = 0; i < count; i++) {
      const o = i * 5;
      const lon = dv.getUint16(o, true) / 10 - 180;
      const lat = dv.getUint16(o + 2, true) / 10 - 90;
      const w = bytes[o + 4] / 255;
      if (Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(w)) {
        lons.push(lon);
        lats.push(lat);
        ws.push(w);
      }
    }
    const n = lons.length;
    if (n < 100) throw new Error("点阵过少");
    const f: DotField = {
      n,
      lon: new Float32Array(n),
      w: new Float32Array(n),
      px: new Float32Array(n),
      py: new Float32Array(n),
      pz: new Float32Array(n),
      band: new Int32Array(n),
      bin: new Int32Array(n),
      lv: new Uint8Array(n),
      latTop,
      latBottom,
    };
    const latSpan = Math.max(1, latTop - latBottom);
    for (let i = 0; i < n; i++) {
      const lon = lons[i];
      const lat = lats[i];
      const w = ws[i];
      f.lon[i] = lon;
      f.w[i] = w;
      f.lv[i] = Math.min(TERRAIN_LEVELS - 1, (w * TERRAIN_LEVELS) | 0);
      const λ = lon * RAD;
      const φ = lat * RAD;
      const cφ = Math.cos(φ);
      f.px[i] = cφ * Math.cos(λ);
      f.py[i] = cφ * Math.sin(λ);
      f.pz[i] = Math.sin(φ);
      f.band[i] = clamp(Math.floor(((latTop - lat) / latSpan) * LAT_BANDS), 0, LAT_BANDS - 1);
      f.bin[i] = clamp(Math.floor(((lon + 180) / 360) * LON_BINS), 0, LON_BINS - 1);
    }
    return f;
  } catch {
    return empty;
  }
}

function loadExchanges(): AtlasExchange[] {
  const arr = (exchangesJson as { exchanges?: unknown }).exchanges;
  if (!Array.isArray(arr)) return [];
  return (arr as AtlasExchange[]).filter(
    (e) =>
      e &&
      typeof e.mic === "string" &&
      typeof e.tz === "string" &&
      Number.isFinite(e.lat) &&
      Number.isFinite(e.lon) &&
      e.sessions &&
      typeof e.sessions === "object",
  );
}

/** 太阳直射经度（忽略均时差 ±4°，美学精度足够） */
function subsolarLon(ms: number): number {
  const d = new Date(ms);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return (((12 - h) * 15 + 540) % 360) - 180;
}

/** 太阳赤纬（度，含季节漂移；美学精度足够） */
function solarDeclination(ms: number): number {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const day = Math.max(1, Math.floor((ms - start) / 86_400_000));
  return 23.44 * Math.sin((2 * Math.PI * (day + 284)) / 365);
}

interface CityField {
  n: number;
  lon: Float32Array;
  pl: Float32Array; // 人口权重 0..1（数组按人口降序）
  band: Int32Array;
  bin: Int32Array;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
}

function decodeCities(): CityField {
  const empty: CityField = {
    n: 0,
    lon: new Float32Array(0),
    pl: new Float32Array(0),
    band: new Int32Array(0),
    bin: new Int32Array(0),
    px: new Float32Array(0),
    py: new Float32Array(0),
    pz: new Float32Array(0),
  };
  try {
    const j = citiesJson as { count?: number; data?: string };
    const bin = atob(String(j.data || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const count = Number(j.count) || 0;
    if (count <= 0 || bytes.length !== count * 5) throw new Error("长度不符");
    const dv = new DataView(bytes.buffer);
    const rows: Array<[number, number, number]> = [];
    for (let i = 0; i < count; i++) {
      const o = i * 5;
      const lon = dv.getUint16(o, true) / 10 - 180;
      const lat = dv.getUint16(o + 2, true) / 10 - 58;
      const pl = bytes[o + 4] / 255;
      if (Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(pl)) rows.push([lon, lat, pl]);
    }
    rows.sort((a, b) => b[2] - a[2]);
    const n = rows.length;
    if (n < 500) throw new Error("城市过少");
    const f: CityField = {
      n,
      lon: new Float32Array(n),
      pl: new Float32Array(n),
      band: new Int32Array(n),
      bin: new Int32Array(n),
      px: new Float32Array(n),
      py: new Float32Array(n),
      pz: new Float32Array(n),
    };
    const latTop = 90;
    const latSpan = 180;
    for (let i = 0; i < n; i++) {
      const [lon, lat, pl] = rows[i];
      f.lon[i] = lon;
      // 数据侧权重是 log10(pop) 档（中位数仅 0.098）——γ=0.4 幂曲线重新铺开：
      // 小城 0.19 / 中城 0.40 / p1 0.80 / 巨城 0.95，亮度与光晕不再挤在地板上
      f.pl[i] = Math.pow(pl, 0.4);
      const λ = lon * RAD;
      const φ = lat * RAD;
      const cφ = Math.cos(φ);
      f.px[i] = cφ * Math.cos(λ);
      f.py[i] = cφ * Math.sin(λ);
      f.pz[i] = Math.sin(φ);
      f.band[i] = clamp(Math.floor(((latTop - lat) / latSpan) * LAT_BANDS), 0, LAT_BANDS - 1);
      f.bin[i] = clamp(Math.floor(((lon + 180) / 360) * LON_BINS), 0, LON_BINS - 1);
    }
    return f;
  } catch {
    return empty;
  }
}

/* 模块级常量：SSR 侧为空（引擎只在客户端运行），客户端解码/校验各做一次 */
const DOTS = typeof window === "undefined" ? null : decodeDots();
const CITIES = typeof window === "undefined" ? null : decodeCities();
const EXCHANGES = typeof window === "undefined" ? [] : loadExchanges();

/* 精选实名卫星（真实 TLE → 根数；数据缺席/解析失败 → 空数组，卫星层整体不画——宁可缺席不可造假） */
interface SatItem {
  el: SatElement;
  name: string;
  x: number;
  y: number;
  zc: number;
  rho: number;
  vis: boolean;
  hidden: boolean; // 球后被遮（坐标已补算——透视网笼用，实体不透视）
  ux: number; // ECEF 单位向量（链路层互见/过顶判定用）
  uy: number;
  uz: number;
  ph: number; // 呼吸相位（去同步）
  boost: number; // 三壳潮汐亮度（呼吸律：1.0-1.7，随壳节律）
  glintP: number; // 板面掠光周期（s）
  glintOff: number; // 掠光相位偏移（s）
  lit: number; // 当前日照符号（+1 阳 / -1 影，0 未初始化）
  flashUntil: number; // 晨昏穿越闪亮截止时刻
}
const SAT_ITEMS: SatItem[] =
  typeof window === "undefined"
    ? []
    : (() => {
        try {
          const arr = (satsJson as { sats?: Array<{ name?: string; zh?: string; norad?: number; tier?: string; tle1?: string; tle2?: string }> }).sats;
          if (!Array.isArray(arr)) return [];
          const out: SatItem[] = [];
          let si = 0;
          for (const s of arr) {
            if (!s || !s.tle1 || !s.tle2) continue;
            const el = parseTLE(s.tle1, s.tle2, String(s.tier || "leo"), { norad: Number(s.norad) || 0, zh: String(s.zh || "") });
            if (el)
              out.push({
                el, name: String(s.name || ""), x: 0, y: 0, zc: 0, rho: 1, vis: false,
                ux: 0, uy: 0, uz: 0, hidden: false, boost: 1,
                ph: si * 2.399963, glintP: 8 + (si % 5), glintOff: si * 1.7, lit: 0, flashUntil: 0,
              });
            si++;
          }
          return out;
        } catch {
          return [];
        }
      })();

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---- 示意模型（符号层判例：只断言类别共性——桁架站/核心舱/镜筒/导航箱/气象盒，
 * 不断言个体构型；判则「量可随真、名不可指认」：连续量（比例/部件间隙/圆柱语言）可参照
 * 真实典型，离散指纹（等距部件计数恰好拼出真星构型、独有件如机械臂）禁——ISS 翼位
 * 非等距三对即此律的落点。来源=仓内手写低模，许可最干净。开源外源路径备档：Quaternius CC0 /
 * NASA 3D Resources 公有领域，keeptrack AGPL 不碰）。姿态：体轴沿航向（真实速度方向差分），
 * 翼轴对日（太阳矢量是场景真值）；气象星扫描仪绕体法向慢转（类别真行为）。 ---- */
interface ModelPartDef {
  x: number; y: number; z: number; sx: number; sy: number; kind: 0 | 1 | 2 | 3; scan?: boolean;
  /** box：sx/sy/sz=三向半长×2。cyl：sx=轴长、sy=直径、sz 不用（seg 棱柱近似圆柱）。taper：sx=轴长、sy=起端径、sz=末端径（锥台）。axis=柱轴方向 */
  shape?: "box" | "cyl" | "taper"; seg?: number; axis?: "x" | "z"; sz?: number;
}
interface ModelFace { v: Array<[number, number, number]>; n: [number, number, number]; k: 0 | 1 | 2 | 3; scan?: boolean } // v：局部面顶点（任意边数）；n：局部面法向
const MODEL_BASE: Array<[number, number, number]> = [
  [206, 218, 236], // kind0 本体银
  [140, 164, 204], // kind1 太阳翼深蓝
  [170, 182, 198], // kind2 桁架/天线暗银
  [232, 236, 240], // kind3 散热板暖白
];
const MODEL_FILL_CACHE: string[] = []; // 材质×亮度档 32 串 rgb 预缓存（4 材质×8 档，α 走 globalAlpha）
const SAT_MODELS: Record<string, { size: number; extent: number; parts: ModelPartDef[]; faces: ModelFace[] }> = (() => {
  const v3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const mk = (size: number, parts: ModelPartDef[]) => {
    let extent = 1;
    for (const p of parts) {
      const rad = Math.max(p.sy, p.sz ?? 0) / 2;
      const ex = p.shape && p.axis === "z" ? Math.abs(p.x) + rad : Math.abs(p.x) + p.sx / 2;
      const ey = Math.abs(p.y) + (p.shape ? rad : p.sy / 2);
      const ez = p.shape && p.axis === "z" ? Math.abs(p.z) + p.sx / 2 : Math.abs(p.z) + (p.shape ? rad : (p.sz ?? 0) / 2);
      extent = Math.max(extent, ex, ey, ez);
    }
    const faces: ModelFace[] = [];
    for (const p of parts) {
      if (!p.shape || p.shape === "box") {
        const x0 = p.x - p.sx / 2, x1 = p.x + p.sx / 2, y0 = p.y - p.sy / 2, y1 = p.y + p.sy / 2, z0 = p.z - (p.sz ?? 0) / 2, z1 = p.z + (p.sz ?? 0) / 2;
        faces.push({ v: [v3(x1, y0, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x1, y0, z1)], n: [1, 0, 0], k: p.kind, scan: p.scan });
        faces.push({ v: [v3(x0, y0, z0), v3(x0, y0, z1), v3(x0, y1, z1), v3(x0, y1, z0)], n: [-1, 0, 0], k: p.kind, scan: p.scan });
        faces.push({ v: [v3(x0, y1, z0), v3(x0, y1, z1), v3(x1, y1, z1), v3(x1, y1, z0)], n: [0, 1, 0], k: p.kind, scan: p.scan });
        faces.push({ v: [v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y0, z1), v3(x0, y0, z1)], n: [0, -1, 0], k: p.kind, scan: p.scan });
        faces.push({ v: [v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1)], n: [0, 0, 1], k: p.kind, scan: p.scan });
        faces.push({ v: [v3(x0, y0, z0), v3(x0, y1, z0), v3(x1, y1, z0), v3(x1, y0, z0)], n: [0, 0, -1], k: p.kind, scan: p.scan });
        continue;
      }
      // 棱柱/锥台：沿局部 x 生成，axis=z 时坐标 x↔z 互换（旋转对称体，镜像即旋转）
      const seg = p.seg ?? 8;
      const L = p.sx;
      const rA = p.sy / 2; // 起端半径（cyl 两端同径）
      const rB = p.shape === "cyl" ? p.sy / 2 : (p.sz ?? 0) / 2; // 末端半径（taper 收放）
      const a0 = p.x - L / 2, a1 = p.x + L / 2;
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        const s0 = Math.sin(t0), c0 = Math.cos(t0), s1 = Math.sin(t1), c1 = Math.cos(t1);
        const sm = (s0 + s1) / 2, cm = (c0 + c1) / 2;
        const nl = Math.hypot(rA - rB, L * sm, L * cm) || 1; // 弦中点非单位向量——按真模长归一
        const n: [number, number, number] = [(rA - rB) / nl, (L * sm) / nl, (L * cm) / nl];
        faces.push({
          v: [v3(a0, rA * s0, rA * c0), v3(a0, rA * s1, rA * c1), v3(a1, rB * s1, rB * c1), v3(a1, rB * s0, rB * c0)],
          n, k: p.kind, scan: p.scan,
        });
      }
      const capF: Array<[number, number, number]> = [];
      const capB: Array<[number, number, number]> = [];
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        capF.push(v3(a1, rB * Math.sin(t), rB * Math.cos(t)));
        capB.push(v3(a0, rA * Math.sin(t), rA * Math.cos(t)));
      }
      faces.push({ v: capF, n: [1, 0, 0], k: p.kind, scan: p.scan });
      faces.push({ v: capB, n: [-1, 0, 0], k: p.kind, scan: p.scan });
      if (p.axis === "z") {
        // 生成期坐标置换 x↔z（含法向）——不引入运行时分支
        for (let fi = faces.length - (seg + 2); fi < faces.length; fi++) {
          const f = faces[fi];
          f.v = f.v.map((w) => v3(w[2], w[1], w[0]));
          f.n = [f.n[2], f.n[1], f.n[0]];
        }
      }
    }
    return { size, extent, parts, faces };
  };
  // 国际空间站（类别桁架站）：主桁架（X 向长梁）+ 垂向六棱舱段串（Z 向堆叠，端头节点舱）
  // + 白色散热板 + 非等距三对太阳翼（去指纹判则：不取四对等距=真星实测构型）
  const issParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 26, sy: 1.1, sz: 1.1, kind: 2 },
    { x: 0, y: 0, z: 0.6, sx: 5.5, sy: 2.4, kind: 0, shape: "cyl", seg: 6, axis: "z" },
    { x: 0, y: 0, z: 5.3, sx: 4.5, sy: 2.2, kind: 0, shape: "cyl", seg: 6, axis: "z" },
    { x: 0, y: 0, z: 8.4, sx: 2.2, sy: 2.7, kind: 0, shape: "cyl", seg: 6, axis: "z" },
    { x: 3.6, y: 0, z: -2.6, sx: 7, sy: 2.2, sz: 0.5, kind: 3 },
  ];
  for (const wx of [-12, -4, 9]) for (const wy of [-5.2, 5.2]) issParts.push({ x: wx, y: wy, z: 0, sx: 0.7, sy: 6.2, sz: 2.3, kind: 1 });
  // 天和核心舱（类别核心舱）：六棱舱身 + 尾部收细锥台 + 前端节点舱/对接段 + 单侧双翼（留缝不贴身）
  const cssParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 10, sy: 2.6, kind: 0, shape: "cyl", seg: 6 },
    { x: -5.8, y: 0, z: 0, sx: 1.6, sy: 2.6, sz: 1.9, kind: 0, shape: "taper", seg: 6 },
    { x: 5.9, y: 0, z: 0, sx: 2.2, sy: 2.9, kind: 0, shape: "cyl", seg: 6 },
    { x: 7.6, y: 0, z: 0, sx: 1.2, sy: 1.5, sz: 1.5, kind: 2 },
    { x: 4.2, y: 5.2, z: 0, sx: 0.7, sy: 7.2, sz: 2.4, kind: 1 },
    { x: 4.2, y: -5.2, z: 0, sx: 0.7, sy: 7.2, sz: 2.4, kind: 1 },
  ];
  // 哈勃（类别镜筒望远镜）：八棱镜筒 + 外张遮光口锥台 + 尾部设备环 + 薄翼（±Z，留缝）
  const hstParts: ModelPartDef[] = [
    { x: -0.4, y: 0, z: 0, sx: 8.4, sy: 2.2, kind: 0, shape: "cyl", seg: 8 },
    { x: 4.9, y: 0, z: 0, sx: 1.7, sy: 2.2, sz: 3.1, kind: 2, shape: "taper", seg: 8 },
    { x: -5.4, y: 0, z: 0, sx: 1.8, sy: 2.7, kind: 2, shape: "cyl", seg: 6 },
    { x: -2.8, y: 0, z: 2.5, sx: 3.2, sy: 1.0, sz: 2.4, kind: 1 },
    { x: -2.8, y: 0, z: -2.5, sx: 3.2, sy: 1.0, sz: 2.4, kind: 1 },
  ];
  // 导航星座（北斗/GPS/伽利略/GLONASS）：箱体 + 双翼（±Y 留缝）+ 对地天线杆（类别身份件）
  const navParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 3.4, sy: 2.1, sz: 2.1, kind: 0 },
    { x: 0, y: 5.1, z: 0, sx: 1.0, sy: 7.4, sz: 2.3, kind: 1 },
    { x: 0, y: -5.1, z: 0, sx: 1.0, sy: 7.4, sz: 2.3, kind: 1 },
    { x: 0, y: 0, z: -1.7, sx: 0.8, sy: 0.8, sz: 1.2, kind: 2 },
  ];
  // 气象星（风云/GOES/NOAA）：方箱 + 单翼（留缝）+ 顶置八棱扫描碟（慢转）
  const wxParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 2.9, sy: 2.9, sz: 2.2, kind: 0 },
    { x: 0, y: 5.2, z: 0, sx: 1.0, sy: 7.2, sz: 2.4, kind: 1 },
    { x: 0, y: 0, z: 2.0, sx: 0.55, sy: 3.3, kind: 2, shape: "cyl", seg: 8, axis: "z", scan: true },
  ];
  // 中继星（TDRS/天链）：箱体 + 桁塔 + 双天线碟（一碟对地慢转；副碟银色拉开明度分离）+ 双大翼（留缝）
  const relayParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 3.2, sy: 2.6, sz: 2.6, kind: 0 },
    { x: 0, y: 6.1, z: 0, sx: 0.8, sy: 9.2, sz: 2.6, kind: 1 },
    { x: 0, y: -6.1, z: 0, sx: 0.8, sy: 9.2, sz: 2.6, kind: 1 },
    { x: 0, y: 0, z: 1.7, sx: 1.0, sy: 1.0, sz: 2.4, kind: 2 },
    { x: 1.4, y: 0, z: 3.4, sx: 0.45, sy: 2.5, kind: 2, shape: "cyl", seg: 8, axis: "z", scan: true },
    { x: -1.4, y: 0, z: 3.4, sx: 0.4, sy: 1.9, kind: 0, shape: "cyl", seg: 8, axis: "z" },
  ];
  // 星链：扁平平板体 + 偏置薄板单翼（类别真特征；14px 不加面，只修比例）
  const slParts: ModelPartDef[] = [
    { x: 0, y: 0, z: 0, sx: 4.4, sy: 1.2, sz: 2.6, kind: 0 },
    { x: 2.7, y: 0, z: 0.9, sx: 3.0, sy: 0.7, sz: 1.5, kind: 1 },
  ];
  return {
    iss: mk(52, issParts),
    css: mk(38, cssParts),
    hst: mk(31, hstParts),
    nav: mk(20, navParts),
    wx: mk(24, wxParts),
    relay: mk(26, relayParts),
    sl: mk(14, slParts),
  };
})();
function modelOf(el: SatElement): { size: number; extent: number; parts: ModelPartDef[]; faces: ModelFace[] } | null {
  if (el.norad === 25544) return SAT_MODELS.iss;
  if (el.norad === 48274) return SAT_MODELS.css;
  if (el.norad === 20580) return SAT_MODELS.hst;
  if (el.norad === 42915 || el.norad === 49011 || el.norad === 40882 || el.norad === 41380) return SAT_MODELS.relay; // 中继/通信 GEO 同类
  if (el.norad === 44714 || el.norad === 44718 || (el.norad >= 44057 && el.norad <= 44059)) return SAT_MODELS.sl; // 平板宽带批产类（星链/OneWeb）
  if (el.norad === 42803 || el.norad === 42811 || el.norad === 41917 || el.norad === 41924 || el.norad === 43928) return SAT_MODELS.nav; // 铱星：通信箱+双翼（按类别建档，不新开式样）
  if (el.tier === "meo") return SAT_MODELS.nav;
  if (el.tier === "geo") return SAT_MODELS.wx;
  return SAT_MODELS.wx; // LEO 气象/遥感族（NOAA-19）
}

export default function AtlasMap() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const dialFlagRef = useRef<HTMLImageElement>(null);
  const dialNameRef = useRef<HTMLSpanElement>(null);
  const tickerTrackRef = useRef<HTMLDivElement>(null);
  const selectedMicRef = useRef<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [selectedMic, setSelectedMicState] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [clockText, setClockText] = useState("—");
  const [signals, setSignals] = useState<Record<string, SignalLite>>({});
  const [counts, setCounts] = useState<Array<{ label: string; verb: string; t: string; open: boolean }>>([]);
  const signalsRef = useRef<Record<string, SignalLite>>({});
  const openCountRef = useRef(0);

  const setSelectedMic = (mic: string | null) => {
    selectedMicRef.current = mic;
    setSelectedMicState(mic);
  };

  const selected = mounted ? EXCHANGES.find((e) => e.mic === selectedMic) ?? null : null;

  /* ---------------- 画布引擎（挂载后一次性构建，卸载全拆） ---------------- */
  useEffect(() => {
    setMounted(true);
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = reduceMq.matches;
    const finePtr = window.matchMedia("(pointer: fine)").matches;

    const stageEl = stageRef.current;
    const canvasEl = canvasRef.current;
    if (!stageEl || !canvasEl) return;
    const ctxEl = canvasEl.getContext("2d");
    if (!ctxEl) return;
    // 窄化后的再绑定：嵌套函数拿到的类型即非空，无需散落 ctx! 断言
    const stage = stageEl;
    const canvas = canvasEl;
    const ctx = ctxEl;

    /* 卫星球：WebGL 光线投射纹理球（日面卫星图 + 夜灯图，真实太阳混合）；
     * 任一环节失败 → glOn 恒 false → 回退点阵水墨球（下方 2D 路径永不删） */
    const glr: GlobeGL | null = glCanvasRef.current
      ? createGlobeGL(glCanvasRef.current, "/atlas/earth-day-4096.jpg", "/atlas/earth-night-4096.jpg")
      : null;
    const glOn = () => !!(glr && glr.ok && glr.ready());

    const dotF = DOTS;
    const cityF = CITIES;
    const lamps = EXCHANGES.map((exch) => {
      const cc = MIC_CC[exch.mic] ?? null;
      const λ = exch.lon * RAD;
      const φ = exch.lat * RAD;
      const cφ = Math.cos(φ);
      return {
        exch,
        cc,
        flag: cc ? flagImgFor(cc) : null,
        vx: cφ * Math.cos(λ),
        vy: cφ * Math.sin(λ),
        vz: Math.sin(φ),
        x: 0,
        y: 0,
        z: 0,
        cur: 0,
        target: STATE_TARGET.CLOSED,
        state: "CLOSED" as LampState,
        bloomT: 0,
        collapseT: 0,
        breathT: 0,
        breathK: 0,
        faceT: 0,
        faceDelay: 0,
        prevZ: NaN,
        chipA: 0,
        bootLit: false,
        activeAt: 0.5 + ((exch.lon + 180) / 360) * 0.45, // boot 沿扫掠带按经度错峰点火
        chipBmp: null as HTMLCanvasElement | null,
        chipW: 64,
        chipH: 22,
        chipX: 0,
        chipY: 0,
        chipSide: 1,
        elbowX: 0,
        chipOn: false,
      };
    });

    let W = 0;
    let H = 0;
    let DPR = 1;
    let disposed = false;
    let raf = 0;
    let running = false;
    let repaint = true; // 一次性重画请求（60s 晨昏 tick / 信号到达 / resize 后）
    let monoFamily = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

    /* 视角状态：yaw 无界（每帧 wrap）、pitch 钳位、zoom 钳位；北上恒定 */
    let yaw = HOME_LON;
    let pitch = HOME_LAT;
    let zoom = 1;
    let velYaw = 0; // deg/s
    let inertiaT = 0;
    let R = 0; // 基础半径（zoom=1）
    let cx = 0;
    let cy = 0;

    /* 帧基向量（每帧 4 次三角）：E=视中心方向 N=屏幕上方 Rt=屏幕右方 */
    let Ex = 1, Ey = 0, Ez = 0, Nx = 0, Ny = 0, Nz = 1, Rx = 0, Ry = 1, Rz = 0;
    /* ---- 行星在转：地轴 23.44° 倾角 + 持续自转（用户修正案：不要静止的球） ----
     * 自转折叠进投影基向量（B_eff = R_z(spin)ᵀ·R_x(tilt)ᵀ·B_cam）：晨昏图案地理锚定不动、
     * 地表在下面转——与「加速的地球自转」在屏上不可区分，且城市灯/太阳几何全部真值不变。
     * 转速取仪表慢速 1 圈/5min（真实 24h 不可感知）；交互即停、静置 2.5s 缓入恢复；
     * 灯卡打开/拨盘中暂停；reduced-motion 用户保持静止（仍可手转）。 */
    const TILT_DEG = 23.44;
    const SPIN_PERIOD_S = 300;
    const SPIN_RESUME_MS = 2500;
    /* 视角复原：任何主动操作刷新阈值，只有静默时倒计时累积；到点 1.15s 飞回家
     * （北上 + 用户时区中央经线 + 默认视距）。飞行可被任意输入即刻打断。 */
    const VIEW_RESTORE_MS = 8000;
    const FLIGHT_SEC = 1.15;
    const HOME_TZ_LON = Math.round((-new Date().getTimezoneOffset() / 60) * 15); // 用户时区中央经线
    let restoreAt = 0; // 复原触发时刻（0 = 未武装）
    let flight: { t: number; yaw0: number; yaw1: number; pitch0: number; pitch1: number; zoom0: number; zoom1: number } | null = null;
    function bumpIdle() {
      restoreAt = performance.now() + VIEW_RESTORE_MS;
    }
    function cancelFlight() {
      flight = null;
    }
    let spinAngle = 0; // deg，绕倾斜后地轴的自转角
    let spinRate = 0; // deg/s（缓入缓出）
    let spinResumeAt = 0;
    let simMs = Date.now(); // 单钟律：卫星传播与自转同一仪表时钟（挂自转积分同门，交互即停同停）
    let narrowModelsOff = false; // FPS 安全阀：持续掉帧一次性降档（非英雄模型退符号点，永不回升）
    let fpsEmaMs = 16;
    let fpsBadSince = 0;
    function spinActive() {
      return (
        !reduced &&
        bootDone &&
        !rotDrag &&
        !dialDragging &&
        pointers.size < 2 &&
        selectedMicRef.current === null &&
        performance.now() >= spinResumeAt
      );
    }

    function frameBasis() {
      yaw = ((yaw + 540) % 360) - 180;
      if (!Number.isFinite(yaw)) yaw = HOME_LON;
      if (!Number.isFinite(pitch)) pitch = HOME_LAT;
      // 调试/验收钩子（仅 dev）：暴露当前视角与自转速率（只读）
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__atlasView = {
          yaw,
          pitch,
          zoom,
          spinRate,
          mets: meteorCount(),
          fx: fxCount(),
          beams: beams.length,
          mesh: meshEdges.size,
          meshGrid: (() => { // 覆盖均匀探针：网边中点 3×3 屏格（前侧+幽灵分计）
            const g = new Array(18).fill(0);
            for (const e of meshEdges.values()) {
              const A = e.a, B = e.b;
              if (!(A.vis || A.hidden) || !(B.vis || B.hidden)) continue;
              const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
              const cx9 = mx < W / 3 ? 0 : mx < (2 * W) / 3 ? 1 : 2;
              const cy9 = my < H / 3 ? 0 : my < (2 * H) / 3 ? 1 : 2;
              const ghost = A.zc <= 0 || B.zc <= 0;
              g[cy9 * 3 + cx9 + (ghost ? 9 : 0)]++;
            }
            return g;
          })(),
          satsVis: SAT_ITEMS.reduce((n, s) => n + (s.vis ? 1 : 0), 0),
          satsAll: SAT_ITEMS.length,
          sat0: (() => {
            const s = SAT_ITEMS.find((q) => q.vis);
            return s ? { x: Math.round(s.x), y: Math.round(s.y), tier: s.el.tier, b: Math.round(s.boost * 100) / 100 } : null;
          })(),
        };
      }
      const l0 = yaw * RAD;
      const p0 = pitch * RAD;
      const c0 = Math.cos(l0), s0 = Math.sin(l0), c1 = Math.cos(p0), s1 = Math.sin(p0);
      // 相机基 → 先俯仰偏航，再折叠地轴倾斜与自转（M = R_x(tilt)·R_z(spin)，基向量取 Mᵀ·B）
      const τ = TILT_DEG * RAD;
      const σ = spinAngle * RAD;
      const ct = Math.cos(τ), st = Math.sin(τ);
      const cs = Math.cos(σ), ss = Math.sin(σ);
      const fold = (x: number, y: number, z: number): [number, number, number] => {
        const y1 = ct * y + st * z; // R_x(-tilt)
        const z1 = -st * y + ct * z;
        const x2 = cs * x + ss * y1; // R_z(-spin)
        const y2 = -ss * x + cs * y1;
        return [x2, y2, z1];
      };
      const fe = fold(c1 * c0, c1 * s0, s1);
      Ex = fe[0]; Ey = fe[1]; Ez = fe[2];
      const fn = fold(-s1 * c0, -s1 * s0, c1);
      Nx = fn[0]; Ny = fn[1]; Nz = fn[2];
      const fr = fold(-s0, c0, 0);
      Rx = fr[0]; Ry = fr[1]; Rz = fr[2];
    }

    /* 城市灯光：太阳高度 LUT（纬度带×经度档，与投影正交）+ 16 档计数排序 */
    let cityN = 0; // 实际绘制数（降级截断后）
    let citySpriteN = 0;
    let citySprite: HTMLCanvasElement | null = null;
    const cityLUT = new Float32Array(LAT_BANDS * LON_BINS);
    const terrLUT = new Float32Array(LAT_BANDS * LON_BINS); // 地形受光：更宽的日照渐变（-18°→+10°，白天看地夜里看灯）
    const cityLevelArr = new Uint8Array(cityF ? cityF.n : 0);
    const cityOrder = new Int32Array(cityF ? cityF.n : 0);
    const cityLevelCount = new Int32Array(CITY_LEVELS);
    const cityLevelStart = new Int32Array(CITY_LEVELS);
    const cityCursor = new Int32Array(CITY_LEVELS);
    const cityX = new Float32Array(cityF ? cityF.n : 0);
    const cityY = new Float32Array(cityF ? cityF.n : 0);
    const citySize = new Float32Array(cityF ? cityF.n : 0);

    /* 地形点阵：6 档权重分桶 */
    const terrOrder = new Int32Array(dotF ? dotF.n : 0);
    const terrLevelArr = new Uint8Array(dotF ? dotF.n : 0);
    const terrLevelCount = new Int32Array(TERRAIN_LEVELS);
    const terrLevelStart = new Int32Array(TERRAIN_LEVELS);
    const terrCursor = new Int32Array(TERRAIN_LEVELS);
    const terrX = new Float32Array(dotF ? dotF.n : 0);
    const terrY = new Float32Array(dotF ? dotF.n : 0);
    const terrSize = new Float32Array(dotF ? dotF.n : 0);

    let nowMs = Date.now();
    let displayMs = nowMs; // 刻度盘假想时刻（只驱动灯态）
    let live = true;
    let glMode = false; // 当前帧是否卫星纹理模式（墨衬/清退分支用）
    let dialDragging = false;
    let springT = -1;
    let springFrom = 0;
    let bootT = reduced ? 1e9 : 0;
    let bootDone = reduced;
    let hoverLamp: (typeof lamps)[number] | null = null;
    let hoverSat: SatItem | null = null; // 悬停卫星（全弧展开的钥匙——选中才画轨道线）
    let tapDownSat: { x: number; y: number; t: number; sat: SatItem | null } | null = null; // 触屏 tap 候选
    let selectedSatUntil = 0; // 触屏选中驻留期（期内 tip 不被 !finePtr 分支隐藏）
    let px = 0;
    let py = 0;
    let lastMoveAt = -1e9;
    let sweepLamp: (typeof lamps)[number] | null = null; // 刻度盘指针正在扫过的交易所
    let dragAnchorX = 0;
    let dragAnchorMs = 0;

    /* 旋转拖拽与惯性 */
    let rotDrag = false;
    let rotLastX = 0;
    let rotLastY = 0;
    let rotSamples: Array<{ t: number; yaw: number }> = [];
    /* 双指捏合 */
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist0 = 0;
    let zoom0 = 1;
    /* 长按浮签（触屏） */
    let longPressTimer = 0;
    let longPressLamp: (typeof lamps)[number] | null = null;
    let longPressX = 0;
    let longPressY = 0;

    /* 状态求值：分钟级缓存（拨动时 60fps × 27 灯不重算 Intl） */
    const stateCache = new Map<string, LampState>();
    function stateOf(l: (typeof lamps)[number], ms: number): LampState {
      const key = `${l.exch.mic}|${Math.floor(ms / 60000)}`;
      const hit = stateCache.get(key);
      if (hit) return hit;
      const st = stateAt(l.exch, new Date(ms));
      if (stateCache.size > 3000) stateCache.clear(); // 36h 弹簧扫过 ~2160 分钟桶，600 会在中途整表清空
      stateCache.set(key, st);
      return st;
    }

    function reevaluate(ms: number, initial = false) {
      let open = 0;
      for (const l of lamps) {
        const st = stateOf(l, ms);
        if (st !== l.state) {
          const wasOpen = l.state === "OPEN";
          l.state = st;
          if (!initial && st === "OPEN" && !reduced) {
            l.bloomT = 0.6; // 开盘一次性灌光（扩散环 600ms）
          } else if (!initial && wasOpen && st !== "OPEN" && !reduced) {
            l.collapseT = 0.3; // 收灯（不对称：开 600ms / 收 300ms，MD3 惯例）
          }
        }
        l.target = STATE_TARGET[st];
        if (st === "OPEN") open++;
      }
      openCountRef.current = open;
    }

    /* ---- 精灵预烘 ---- */

    /** 大气盘：外辉光（包浆）+ 球底色 + 界圆一笔 + 24 格刻度环（皆屏幕空间静止，可整张烘焙） */
    let sphereSprite: HTMLCanvasElement | null = null;
    function bakeSphere() {
      const glow = 1.12;
      const size = Math.max(2, Math.ceil(2 * R * glow * DPR));
      sphereSprite = document.createElement("canvas");
      sphereSprite.width = size;
      sphereSprite.height = size;
      const g = sphereSprite.getContext("2d");
      if (!g) return;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      const s = size / DPR / 2; // 精灵中心
      // 外辉光：R → 1.12R 加法银晕（包浆）
      const og = g.createRadialGradient(s, s, R * 0.98, s, s, R * glow);
      og.addColorStop(0, `rgba(${INKPAPER}, 0.13)`);
      og.addColorStop(0.35, `rgba(${INKPAPER}, 0.05)`);
      og.addColorStop(1, `rgba(${INKPAPER}, 0)`);
      g.fillStyle = og;
      g.fillRect(0, 0, size / DPR, size / DPR);
      // 球底：墨玉从暗中浮出
      const bg = g.createRadialGradient(s, s, 0, s, s, R);
      bg.addColorStop(0, "rgba(20, 27, 38, 0.55)");
      bg.addColorStop(0.9, "rgba(13, 18, 27, 0.7)");
      bg.addColorStop(1, "rgba(10, 14, 21, 0.75)");
      g.fillStyle = bg;
      g.beginPath();
      g.arc(s, s, R, 0, Math.PI * 2);
      g.fill();
      // 内缘玉光 + 界圆（圆规蘸墨一笔）
      g.strokeStyle = `rgba(${INKPAPER}, 0.10)`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(s, s, R - 1.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgba(${INKPAPER}, 0.16)`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(s, s, R, 0, Math.PI * 2);
      g.stroke();
      drawTickRing((x0, y0, x1, y1, major) => {
        g.strokeStyle = `rgba(${INKPAPER}, ${major ? 0.5 : 0.26})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x0 + s, y0 + s);
        g.lineTo(x1 + s, y1 + s);
        g.stroke();
      });
    }

    /** 24 格刻度环（15° = 1 小时；环即钟面）；每 90° 一根大格衬线。
     *  坐标以球心为原点产出，调用方自行平移到球心/精灵中心——GL 模式下用 2D 补画
     *  （sphereSprite 只在回退分支绘制，不补则金 tick 悬空指向空环，钟面隐喻断链） */
    function drawTickRing(stroke: (x0: number, y0: number, x1: number, y1: number, major: boolean) => void, scale = 1) {
      for (let i = 0; i < 24; i++) {
        const major = i % 6 === 0;
        const a = i * 15 * RAD;
        const c = Math.cos(a), sn = Math.sin(a);
        const r0 = (major ? R + 3 : R + 4) * scale;
        const r1 = (major ? R + 13 : R + 10) * scale;
        stroke(r0 * c, r0 * sn, r1 * c, r1 * sn, major);
      }
    }

    /** 灯辉三色精灵（金/银/朱，避免每帧 createRadialGradient） */
    const glowSprites = new Map<string, HTMLCanvasElement>();
    function glowSprite(color: [number, number, number]) {
      const key = color.join(",");
      const hit = glowSprites.get(key);
      if (hit) return hit;
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      if (g) {
        const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        rg.addColorStop(0, rgba(color, 0.85));
        rg.addColorStop(0.45, rgba(color, 0.22));
        rg.addColorStop(1, rgba(color, 0));
        g.fillStyle = rg;
        g.fillRect(0, 0, 64, 64);
      }
      glowSprites.set(key, c);
      return c;
    }

    function makeCitySprite() {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const g = c.getContext("2d");
      if (!g) return c;
      const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      rg.addColorStop(0, rgba(CITY_COLOR, 0.9));
      rg.addColorStop(0.4, rgba(CITY_COLOR, 0.26));
      rg.addColorStop(1, rgba(CITY_COLOR, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, 32, 32);
      return c;
    }

    /** 芯片位图：旗 + 描边 + 带阴影城市名一次烘好，运行期 drawImage（fillText/shadowBlur 归零） */
    function bakeChips() {
      const narrow = W < 640;
      for (const l of lamps) {
        const isMajor = MAJOR_SET.has(l.exch.mic);
        const fw = narrow ? FLAG_W_NARROW : isMajor ? FLAG_W_MAJOR : FLAG_W_MINOR;
        const fh = (fw * 2) / 3;
        ctx.font = narrow || !isMajor ? `10px ${monoFamily}` : `11px ${monoFamily}`;
        const name = l.exch.zh || l.exch.city || l.exch.mic;
        const nameW = ctx.measureText(name).width;
        l.chipW = Math.ceil(CHIP_PAD + fw + 4 + nameW + CHIP_PAD);
        l.chipH = Math.ceil(Math.max(fh, 14) + 6);
        const c = document.createElement("canvas");
        c.width = Math.ceil(l.chipW * DPR);
        c.height = Math.ceil(l.chipH * DPR);
        const g = c.getContext("2d");
        if (!g) {
          l.chipBmp = null;
          continue;
        }
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        const fx = CHIP_PAD;
        const fy = (l.chipH - fh) / 2;
        const img = l.flag;
        if (img && img.complete && img.naturalWidth > 0) g.drawImage(img, fx, fy, fw, fh);
        else {
          g.fillStyle = "rgba(226, 236, 255, 0.1)";
          g.fillRect(fx, fy, fw, fh);
          g.fillStyle = "rgba(226, 236, 255, 0.6)";
          g.font = `8px ${monoFamily}`;
          g.textAlign = "center";
          g.fillText((l.cc || "??").toUpperCase(), fx + fw / 2, fy + fh / 2 + 3);
        }
        g.strokeStyle = `rgba(${INKPAPER}, 0.32)`;
        g.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
        g.font = narrow || !isMajor ? `10px ${monoFamily}` : `11px ${monoFamily}`;
        g.shadowColor = "rgba(7, 9, 6, 0.9)";
        g.shadowBlur = 3;
        g.fillStyle = `rgba(198, 210, 228, ${isMajor ? 0.88 : 0.58})`;
        g.fillText(name, fx + fw + 4, l.chipH / 2 + 4);
        l.chipBmp = c;
      }
    }

    /* ---- 太阳几何 ---- */

    function computeCityLUT(ms: number) {
      const subsolar = subsolarLon(ms);
      const declR = solarDeclination(ms) * RAD;
      const sinD = Math.sin(declR);
      const cosD = Math.cos(declR);
      for (let b = 0; b < LAT_BANDS; b++) {
        const latC = 90 - ((b + 0.5) / LAT_BANDS) * 180;
        const a = Math.sin(latC * RAD) * sinD;
        const cc = Math.cos(latC * RAD) * cosD;
        for (let ln = 0; ln < LON_BINS; ln++) {
          const lon = -180 + (ln + 0.5) * (360 / LON_BINS);
          const sinh = a + cc * Math.cos((subsolar - lon) * RAD);
          const h = Math.asin(clamp(sinh, -1, 1)) / RAD;
          let br = 1 - smoothstep(-18, -6, h); // 天文暮光→民用暮光渐亮
          if (h < -30) br = Math.min(1, br + 0.15); // 深夜提亮
          cityLUT[b * LON_BINS + ln] = br;
          terrLUT[b * LON_BINS + ln] = smoothstep(-18, 10, h); // 地形日照因子（昼侧渐亮，晨昏带 28° 渐染）
        }
      }
    }

    /* ---- boot：快进一个昼夜（画圆 → 晨昏扫掠 → 灯火就位；终帧=稳态零跳变） ---- */
    function bootFactors() {
      if (reduced) return { circleP: 1, sweepP: 1, settleP: 1, startLon: subsolarLon(Date.now()) + 90 };
      const circleP = easeInOut(clamp(bootT / 0.46, 0, 1));
      const sweepP = easeInOut(clamp((bootT - 0.25) / 0.9, 0, 1));
      const settleP = clamp((bootT - 0.9) / 0.5, 0, 1);
      return { circleP, sweepP, settleP, startLon: subsolarLon(Date.now()) + 90 };
    }
    /** 某经度是否已被扫掠带点亮（boot 期 0..1，稳态恒 1） */
    function revealOf(lon: number, sweepP: number, startLon: number) {
      if (sweepP >= 1) return 1;
      const frac = (((lon - startLon) % 360) + 360) % 360 / 360;
      return clamp((sweepP * 1.06 - frac) / 0.06, 0, 1);
    }

    /* ---- 绘制 ---- */

    /** 经纬网：采样折线，z 剔除断笔（正交下可见段为连续弧） */
    function drawGraticule(alphaK: number) {
      ctx.strokeStyle = `rgba(${INKPAPER}, ${(0.055 * alphaK).toFixed(3)})`;
      ctx.lineWidth = 1;
      // 经线每 30°
      for (let lon = -180; lon < 180; lon += 30) {
        const λ = lon * RAD;
        const cλ = Math.cos(λ), sλ = Math.sin(λ);
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 48; k++) {
          const φ = (k / 48 - 0.5) * Math.PI;
          const cφ = Math.cos(φ);
          const X = cφ * cλ, Y = cφ * sλ, Z = Math.sin(φ);
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z <= 0.02) {
            started = false;
            continue;
          }
          const x = cx + R * zoom * (X * Rx + Y * Ry + Z * Rz);
          const y = cy - R * zoom * (X * Nx + Y * Ny + Z * Nz);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // 纬线每 30°（赤道略亮）
      for (let lat = -60; lat <= 60; lat += 30) {
        const φ = lat * RAD;
        const sφ = Math.sin(φ), cφ = Math.cos(φ);
        ctx.strokeStyle = `rgba(${INKPAPER}, ${((lat === 0 ? 0.085 : 0.055) * alphaK).toFixed(3)})`;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 96; k++) {
          const λ = (k / 96) * Math.PI * 2 - Math.PI;
          const X = cφ * Math.cos(λ), Y = cφ * Math.sin(λ), Z = sφ;
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z <= 0.02) {
            started = false;
            continue;
          }
          const x = cx + R * zoom * (X * Rx + Y * Ry + Z * Rz);
          const y = cy - R * zoom * (X * Nx + Y * Ny + Z * Nz);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    /** 地形点阵：投影 → z/雾化 → 6 桶批量；昼侧微亮夜侧沉（LUT 调制） */
    function paintTerrain(alphaK: number, sweepP: number, startLon: number) {
      if (!dotF || dotF.n === 0) return;
      const Rz2 = R * zoom;
      terrLevelCount.fill(0);
      let m = 0;
      for (let i = 0; i < dotF.n; i++) {
        const X = dotF.px[i], Y = dotF.py[i], Z = dotF.pz[i];
        const z = X * Ex + Y * Ey + Z * Ez;
        if (z <= 0.03) continue;
        const fog = smoothstep(0.02, 0.18, z);
        const dayMod = 0.7 + 0.55 * terrLUT[dotF.band[i] * LON_BINS + dotF.bin[i]]; // 昼 1.25× / 夜 0.70×——受光方向与城市灯相反（白天看地，夜里看灯）
        const rv = bootDone ? 1 : revealOf(dotF.lon[i], sweepP, startLon);
        const a = (0.13 + (dotF.lv[i] / (TERRAIN_LEVELS - 1)) * 0.17) * dayMod * fog * rv;
        const lv = a <= 0 ? 0 : clamp((a * TERRAIN_LEVELS * 2.6) | 0, 1, TERRAIN_LEVELS - 1);
        terrX[m] = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
        terrY[m] = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
        terrSize[m] = 1.3 * (0.55 + 0.45 * z);
        terrLevelArr[m] = lv;
        terrLevelCount[lv]++;
        m++;
      }
      let acc = 0;
      for (let L = 0; L < TERRAIN_LEVELS; L++) {
        terrLevelStart[L] = acc;
        acc += terrLevelCount[L];
      }
      terrCursor.set(terrLevelStart);
      for (let i = 0; i < m; i++) terrOrder[terrCursor[terrLevelArr[i]]++] = i;
      for (let L = 1; L < TERRAIN_LEVELS; L++) {
        const alpha = ((L + 0.5) / TERRAIN_LEVELS) * 0.42 * alphaK;
        if (alpha < 0.015) continue;
        ctx.fillStyle = `rgba(${INKPAPER}, ${alpha.toFixed(3)})`;
        const st = terrLevelStart[L];
        const en = st + terrLevelCount[L];
        ctx.beginPath();
        for (let j = st; j < en; j++) {
          const i = terrOrder[j];
          const s = terrSize[i];
          ctx.rect(terrX[i] - s / 2, terrY[i] - s / 2, s, s);
        }
        ctx.fill();
      }
    }

    /** 城市暖尘：LUT 亮度 × 雾化 → 16 桶单 path 批量 + 头部光晕 sprite */
    function paintCities(kBoot: number, rotFast: boolean, sweepP: number, startLon: number) {
      if (!cityF || cityN === 0) return;
      const Rz2 = R * zoom;
      cityLevelCount.fill(0);
      let m = 0;
      for (let i = 0; i < cityN; i++) {
        const X = cityF.px[i], Y = cityF.py[i], Z = cityF.pz[i];
        const z = X * Ex + Y * Ey + Z * Ez;
        if (z <= 0.045) continue;
        const b = cityLUT[cityF.band[i] * LON_BINS + cityF.bin[i]];
        if (b <= 0.02) continue;
        const fog = smoothstep(0.05, 0.3, z);
        const rv = bootDone ? 1 : revealOf(cityF.lon[i], sweepP, startLon);
        const v = b * (0.35 + 0.65 * cityF.pl[i]) * fog * rv;
        const lv = v <= 0 ? 0 : Math.min(CITY_LEVELS - 1, (v * CITY_LEVELS) | 0);
        if (lv === 0) continue;
        cityX[m] = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
        cityY[m] = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
        citySize[m] = (1.5 + lv * 0.13) * (0.55 + 0.45 * z); // 点径随亮度/深度：lv15≈3.4px、中档≈2.6px——小于此在亮地形上不可辨
        cityLevelArr[m] = lv;
        cityLevelCount[lv]++;
        m++;
      }
      let acc = 0;
      for (let L = 0; L < CITY_LEVELS; L++) {
        cityLevelStart[L] = acc;
        acc += cityLevelCount[L];
      }
      cityCursor.set(cityLevelStart);
      for (let i = 0; i < m; i++) cityOrder[cityCursor[cityLevelArr[i]]++] = i;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let L = 1; L < CITY_LEVELS; L++) {
        const alpha = ((L + 0.5) / CITY_LEVELS) * 0.55 * kBoot; // 顶桶 0.53：夜幕压暗后需要更高峰値才成「文明弧」
        if (alpha < 0.015) continue;
        ctx.fillStyle = rgba(CITY_COLOR, alpha);
        const st = cityLevelStart[L];
        const en = st + cityLevelCount[L];
        ctx.beginPath();
        for (let j = st; j < en; j++) {
          const i = cityOrder[j];
          const s = citySize[i];
          ctx.rect(cityX[i] - s / 2, cityY[i] - s / 2, s, s);
        }
        ctx.fill();
      }
      if (citySprite && citySpriteN > 0) {
        for (let i = 0; i < citySpriteN; i++) {
          const X = cityF.px[i], Y = cityF.py[i], Z = cityF.pz[i];
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z <= 0.05) continue;
          const b = cityLUT[cityF.band[i] * LON_BINS + cityF.bin[i]];
          if (b <= 0.03) continue;
          const rv = bootDone ? 1 : revealOf(cityF.lon[i], sweepP, startLon);
          const sx = cx + R * zoom * (X * Rx + Y * Ry + Z * Rz);
          const sy = cy - R * zoom * (X * Nx + Y * Ny + Z * Nz);
          // top-60 巨城：一圈大晕（东京/上海/纽约夜侧一眼可辨）
          if (i < 60) {
            ctx.globalAlpha = (0.10 * b) * kBoot * rv * z;
            const big = 34 * (0.55 + 0.45 * z);
            ctx.drawImage(citySprite, sx - big / 2, sy - big / 2, big, big);
          }
          ctx.globalAlpha = (0.06 + 0.22 * cityF.pl[i] * b) * kBoot * rv * z;
          const sz = (10 + 14 * cityF.pl[i]) * (0.55 + 0.45 * z);
          ctx.drawImage(citySprite, sx - sz / 2, sy - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    function subsolarVecOf(ms: number) {
      const λs = subsolarLon(ms) * RAD;
      const δ = solarDeclination(ms) * RAD;
      return { Sx: Math.cos(δ) * Math.cos(λs), Sy: Math.cos(δ) * Math.sin(λs), Sz: Math.sin(δ) };
    }

    /* ---- 流星（天上的一次性光）：双频泊松 + 夜半球门控 + 球后裁切 ---- */
    interface Meteor {
      x: number; y: number; vx: number; vy: number;
      life: number; life0: number; len: number;
      big: boolean;
      f: number; ph: number; prevCyc: number; // 脉冲频率/相位/上一拍周期号（相位卷绕检测，低帧率不漏峰）
      flares: number[]; // 碎裂时刻表（age 秒，升序；大流星 1-3 次是文献常态）
      flareT: number; // 当前碎裂耀斑剩余（头辉增强计时）
    }
    interface Fx {
      kind: 0 | 1 | 2 | 3; // 0=余烬结 1=焚毁冲击环 2=点爆闪光 3=火花
      x: number; y: number; born: number; dur: number;
      len: number; dx: number; dy: number; rmax: number; a0: number;
      cr: number; cg: number; cb: number; lineWidth: number;
    }
    const meteorPool: Array<Meteor | null> = new Array(16).fill(null);
    const fxPool: Array<Fx | null> = new Array(160).fill(null);
    const FIRE1: [number, number, number] = [255, 170, 80]; // 火橙烧蚀色（2200-3500K；与金/朱、构造银蓝都留距离）
    let meteorTimer = 0;
    let meteorBigAt = 0; // 大流星让位窗（期间只出微流星）
    let lastMeteorAt = 0; // 上次成功生成时刻（空屏补发用）
    const zoneLastAt: number[] = []; // 覆盖均匀：六区（3×2）轮转——最久未服务区优先
    function meteorCount() {
      let n = 0;
      for (const m of meteorPool) if (m) n++;
      return n;
    }
    function fxCount() {
      let n = 0;
      for (const f of fxPool) if (f) n++;
      return n;
    }
    function clearMeteors() {
      for (let k = 0; k < meteorPool.length; k++) meteorPool[k] = null;
      for (let k = 0; k < fxPool.length; k++) fxPool[k] = null;
    }
    function pushFx(fx: Fx) {
      for (let k = 0; k < fxPool.length; k++) {
        if (!fxPool[k]) {
          fxPool[k] = fx;
          return;
        }
      }
    }
    /** 热史色：冷银 → 暖橙 → 炽橙（接近大气层才暖化——烧蚀谱） */
    function heatColor(heat: number): [number, number, number] {
      if (heat < 0.5) {
        const t = heat / 0.5;
        return [232 + 23 * t, 240 - 60 * t, 255 - 165 * t];
      }
      const t = (heat - 0.5) / 0.5;
      return [255, 180 - 58 * t, 90 - 21 * t];
    }
    /** 夜半球门控：流星只认太阳（spawn 中点须在背日半屏——昼面物理上看不见流星） */
    function inNightHalf(x: number, y: number, sunV: { Sx: number; Sy: number; Sz: number }) {
      const ssx = cx + R * zoom * (sunV.Sx * Rx + sunV.Sy * Ry + sunV.Sz * Rz);
      const ssy = cy - R * zoom * (sunV.Sx * Nx + sunV.Sy * Ny + sunV.Sz * Nz);
      return (x - cx) * (cx - ssx) + (y - cy) * (cy - ssy) > 0;
    }
    function spawnMeteor(sunV: { Sx: number; Sy: number; Sz: number }): boolean {
      const narrowScreen = W < 640;
      const cap = narrowScreen ? 8 : 12; // 密度为展示节律不指示天文事件（纯美三律）；用户三轮要求加密
      if (meteorCount() >= cap) return false;
      const nowP = performance.now();
      const big = nowP >= meteorBigAt && Math.random() < 0.32;
      if (big) meteorBigAt = nowP + 5000; // 大流星后 5s 让位（盖满整场演出：点火→碎→碎→终爆）
      const diag = Math.hypot(W, H);
      const speed = diag * (big ? 0.8 + Math.random() * 0.35 : 0.55 + Math.random() * 0.4);
      const life0 = big ? 1.8 + Math.random() * 0.8 : 0.9 + Math.random() * 0.5;
      // 全员屏幕空间自由路径（高空焚毁律：烧蚀事件空中发生，禁锚球缘/地表）：
      // 对角扇区两族随机（禁辐射点汇聚）；**六区轮转保证覆盖均匀**（3×2 网格最久未服务区优先，
      // 区内随机取点过夜半门控，全败退避 2s 让位别区，末两次尝试放开全域）
      const fan = Math.random() < 0.5;
      const ang = (fan ? 20 + Math.random() * 50 : 110 + Math.random() * 50) * (Math.PI / 180);
      if (zoneLastAt.length === 0) for (let zk = 0; zk < 6; zk++) zoneLastAt.push(0);
      let zi = 0;
      for (let zk = 1; zk < 6; zk++) if (zoneLastAt[zk] < zoneLastAt[zi]) zi = zk;
      const zw = W / 3;
      const zh = (H * 0.45) / 2;
      let sx0 = 0;
      let sy0 = 0;
      let placed = false;
      let viaZone = false;
      for (let k = 0; k < 4; k++) {
        viaZone = k < 2;
        if (viaZone) {
          sx0 = (zi % 3) * zw + Math.random() * zw;
          sy0 = Math.floor(zi / 3) * zh + Math.random() * zh;
        } else {
          sx0 = Math.random() * W;
          sy0 = Math.random() * H * 0.45;
        }
        const mx = sx0 + Math.cos(ang) * speed * life0 * 0.5;
        const my = sy0 + Math.sin(ang) * speed * life0 * 0.5;
        if (inNightHalf(mx, my, sunV)) {
          placed = true;
          break;
        }
      }
      if (!placed) return false;
      zoneLastAt[zi] = viaZone ? nowP : nowP + 2000; // 区内全败：退避 2s 让别区先走
      // 入场点火（渲染层淡入闪，不做「进入大气」隐喻）：大款必出、微款五成
      if (big || Math.random() < 0.5)
        pushFx({ kind: 2, x: sx0, y: sy0, born: nowP, dur: 0.15, len: big ? 16 : 12, dx: 0, dy: 0, rmax: 0, a0: 0.45, cr: 255, cg: 170, cb: 80, lineWidth: 0 });
      // 碎裂时刻表：大款 1-2 次（窄屏 ≤1）、微款 35% 一次——时机不规则（防恒定节拍）
      const flares: number[] = [];
      if (big) {
        const n = narrowScreen ? 1 : Math.random() < 0.55 ? 2 : 1;
        for (let k = 0; k < n; k++) flares.push(life0 * (0.25 + Math.random() * 0.5));
      } else if (Math.random() < 0.35) flares.push(life0 * (0.3 + Math.random() * 0.4));
      flares.sort((a, b) => a - b);
      for (let k = 0; k < meteorPool.length; k++) {
        if (meteorPool[k]) continue;
        meteorPool[k] = {
          x: sx0, y: sy0,
          vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          life: life0, life0,
          len: diag * (big ? 0.46 + Math.random() * 0.14 : 0.16 + Math.random() * 0.08),
          big, f: big ? 2.6 + Math.random() * 0.8 : 3.0 + Math.random() * 1.4, ph: Math.random() * Math.PI * 2,
          prevCyc: -99, flares, flareT: 0,
        };
        return true;
      }
      return false;
    }
    /** 空中焚毁 boom（寿命尽处原位）：火橙点爆 + 多环错峰 easeOut + 大款火花雨。
     * 环的落点护栏：爆点落球缘环带（0.92-1.3R）则只闪不环——boom 永不贴 rim 爆（高空焚毁律）。
     * 扩张环专形按色温分域：流星=火橙烧蚀环，链路收讫=构造银蓝环。 */
    function burnUp(m: Meteor, nowP: number) {
      const Rz2 = R * zoom;
      const rr = Math.hypot(m.x - cx, m.y - cy) / (Rz2 || 1);
      const ringsOk = rr < 0.92 || rr > 1.3;
      pushFx({ kind: 2, x: m.x, y: m.y, born: nowP, dur: 0.2, len: m.big ? 36 : 16, dx: 0, dy: 0, rmax: 0, a0: 0.95, cr: 255, cg: 170, cb: 80, lineWidth: 0 });
      if (ringsOk) {
        if (m.big) {
          const rings = W < 640 ? 3 : 4;
          for (let k = 0; k < rings; k++)
            pushFx({ kind: 1, x: m.x, y: m.y, born: nowP + k * 40, dur: 0.5, len: 0, dx: 0, dy: 0, rmax: 160, a0: [0.78, 0.6, 0.45, 0.3][k] ?? 0.3, cr: 255, cg: 170, cb: 80, lineWidth: 2.5 });
          const sparks = W < 640 ? 8 : 11;
          for (let k = 0; k < sparks; k++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 40 + Math.random() * 100;
            pushFx({ kind: 3, x: m.x, y: m.y, born: nowP, dur: 0.4 + Math.random() * 0.25, len: 0, dx: Math.cos(a) * sp, dy: Math.sin(a) * sp, rmax: 0, a0: 0.7, cr: 255, cg: 200, cb: 130, lineWidth: 0 });
          }
        } else {
          pushFx({ kind: 1, x: m.x, y: m.y, born: nowP, dur: 0.4, len: 0, dx: 0, dy: 0, rmax: 42, a0: 0.5, cr: 255, cg: 170, cb: 80, lineWidth: 1.8 });
        }
      }
    }
    /** 碎裂闪爆（bolide fragmentation，空中、时机不规则）：头耀斑 + 小环 + 火花 + 子碎片流星（带微尾前抛） */
    function flareUp(m: Meteor, nowP: number) {
      m.flareT = 0.3;
      const mag = Math.hypot(m.vx, m.vy) || 1;
      pushFx({ kind: 2, x: m.x, y: m.y, born: nowP, dur: 0.15, len: m.big ? 20 : 12, dx: 0, dy: 0, rmax: 0, a0: 0.8, cr: 255, cg: 190, cb: 100, lineWidth: 0 });
      pushFx({ kind: 1, x: m.x, y: m.y, born: nowP, dur: 0.42, len: 0, dx: 0, dy: 0, rmax: m.big ? 55 : 30, a0: 0.45, cr: 255, cg: 170, cb: 80, lineWidth: 1.8 });
      if (m.big) {
        const sparks = W < 640 ? 4 : 5;
        for (let k = 0; k < sparks; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 30 + Math.random() * 70;
          pushFx({ kind: 3, x: m.x, y: m.y, born: nowP, dur: 0.35 + Math.random() * 0.2, len: 0, dx: Math.cos(a) * sp, dy: Math.sin(a) * sp, rmax: 0, a0: 0.65, cr: 255, cg: 200, cb: 130, lineWidth: 0 });
        }
        // 子碎片流星：微尾短命，沿原向 ±20° 偏折前抛（碎裂后多亮块继续飞——物理正确；窄屏 2 粒）
        {
          const n = W < 640 ? 2 : 2 + (Math.random() < 0.5 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const dv = (Math.random() - 0.5) * 0.7; // ±20°
            const ca = Math.cos(dv), sa = Math.sin(dv);
            const nvx = ((m.vx / mag) * ca - (m.vy / mag) * sa) * mag * (0.6 + Math.random() * 0.2);
            const nvy = ((m.vx / mag) * sa + (m.vy / mag) * ca) * mag * (0.6 + Math.random() * 0.2);
            pushFx({ kind: 3, x: m.x, y: m.y, born: nowP, dur: 0.3 + Math.random() * 0.2, len: 14 + Math.random() * 8, dx: nvx, dy: nvy, rmax: 0, a0: 0.75, cr: 255, cg: 210, cb: 140, lineWidth: 2 });
          }
        }
      }
    }
    /** FX 池一遍扫描：余烬结 / 焚毁环（easeOut 扩张变细变淡）/ 点爆闪光 / 火花 */
    function drawFx(nowP: number, dt: number) {
      if (fxCount() === 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(cx, cy, R * zoom, 0, Math.PI * 2);
      ctx.clip("evenodd"); // 焚毁环只剩球外半环＝「从球后冲出、在球缘烧毁」的正确遮挡
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < fxPool.length; k++) {
        const fx = fxPool[k];
        if (!fx) continue;
        const age = (nowP - fx.born) / 1000;
        if (age < 0) continue; // 错峰环未到点
        const u = age / fx.dur;
        if (u >= 1) {
          fxPool[k] = null;
          continue;
        }
        const fade = 1 - u;
        if (fx.kind === 0) {
          // 余烬结：原地驻留渐隐收缩（喷流 knot；冻结生成时热色＝热史）
          const bx = fx.x - fx.dx * fx.len * (0.4 + 0.6 * fade);
          const by = fx.y - fx.dy * fx.len * (0.4 + 0.6 * fade);
          ctx.strokeStyle = `rgba(${fx.cr}, ${fx.cg}, ${fx.cb}, ${(fx.a0 * fade).toFixed(3)})`;
          ctx.lineWidth = Math.max(0.6, fx.lineWidth * (0.5 + 0.5 * fade));
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(fx.x + fx.dx * 2, fx.y + fx.dy * 2);
          ctx.stroke();
        } else if (fx.kind === 1) {
          // 焚毁冲击环：easeOut 扩张、变细变淡（boom 一圈圈）
          const eo = 1 - Math.pow(1 - u, 2.2);
          ctx.strokeStyle = `rgba(${fx.cr}, ${fx.cg}, ${fx.cb}, ${(fx.a0 * fade).toFixed(3)})`;
          ctx.lineWidth = Math.max(0.4, fx.lineWidth * fade);
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, 5 + (fx.rmax - 5) * eo, 0, Math.PI * 2);
          ctx.stroke();
        } else if (fx.kind === 2) {
          // 点爆闪光：暖 glow + 白芯快闪
          const s = fx.len * (0.6 + 0.6 * (1 - fade));
          ctx.globalAlpha = clamp(fx.a0 * fade, 0, 1);
          ctx.drawImage(glowSprite([fx.cr, fx.cg, fx.cb]), fx.x - s, fx.y - s, s * 2, s * 2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(255, 250, 240, ${(fx.a0 * fade * 0.9).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, 2 + fx.len * 0.08 * fade, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 火花/子碎片：外抛阻尼渐隐；len>0 的变体带微尾（碎裂后多亮块继续飞）
          fx.x += fx.dx * dt;
          fx.y += fx.dy * dt;
          if (fx.len > 0) {
            const damp = Math.max(0, 1 - 1.0 * dt); // 碎片阻尼小（保前抛感）
            fx.dx *= damp;
            fx.dy *= damp;
            const vm = Math.hypot(fx.dx, fx.dy) || 1;
            ctx.strokeStyle = `rgba(${fx.cr}, ${fx.cg}, ${fx.cb}, ${(fx.a0 * fade).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.6, fx.lineWidth * fade);
            ctx.beginPath();
            ctx.moveTo(fx.x - (fx.dx / vm) * fx.len, fx.y - (fx.dy / vm) * fx.len);
            ctx.lineTo(fx.x, fx.y);
            ctx.stroke();
          } else {
            fx.dx *= 1 - 1.6 * dt;
            fx.dy *= 1 - 1.6 * dt;
          }
          ctx.fillStyle = `rgba(${fx.cr}, ${fx.cg}, ${fx.cb}, ${(fx.a0 * fade).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.len > 0 ? 1.8 : 1.3 * fade + 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    function drawMeteors(dt: number, sunV: { Sx: number; Sy: number; Sz: number }) {
      if (reduced || !bootDone) return; // boot 演出独角戏；reduced 无流星（冻结的流星是划痕不是画）
      const nowP = performance.now();
      meteorTimer -= dt;
      if (meteorTimer <= 0) {
        if (spawnMeteor(sunV)) lastMeteorAt = nowP;
        if (Math.random() < 0.3) spawnMeteor(sunV); // 30% 双发（天象感）
        const mean = W < 640 ? 0.6 : 0.35;
        meteorTimer = Math.max(0.15, -Math.log(Math.max(1e-6, Math.random())) * mean);
      }
      // 常驻补发：空屏超 1s 强制一颗；夜半门控全败 0.5s 后再试
      if (meteorCount() === 0 && nowP - lastMeteorAt > 1000) {
        if (spawnMeteor(sunV)) lastMeteorAt = nowP + Math.random() * 300;
        else lastMeteorAt = nowP - 500;
      }
      drawFx(nowP, dt); // 余烬/环/火花（流星死后余辉仍在走）
      if (meteorCount() === 0) return;
      const narrow = W < 640;
      ctx.save();
      // 球后裁切：evenodd 挖去球盘——流星从球后掠过、焚毁 boom 只剩球外半环
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(cx, cy, R * zoom, 0, Math.PI * 2);
      ctx.clip("evenodd");
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < meteorPool.length; k++) {
        const m = meteorPool[k];
        if (!m) continue;
        m.life -= dt;
        if (m.life <= 0) {
          // 空中焚毁（寿命尽处原位）——高空焚毁律：不锚球缘不触地，FX 余辉接管「笔断意连」
          burnUp(m, nowP);
          meteorPool[k] = null;
          continue;
        }
        // 脉冲推进：速度包络 0.18+0.82·sin⁵（谷段蓄力近停滞、峰窄爆发——峰谷速比 5.5:1）
        const age = m.life0 - m.life;
        const φ = m.f * Math.PI * 2 * age + m.ph;
        const sp3 = Math.max(0, Math.sin(φ));
        const env = 0.18 + 0.82 * Math.pow(sp3, 5);
        m.x += m.vx * env * dt;
        m.y += m.vy * env * dt;
        // 碎裂时刻表：age 越过即爆（时机不规则——防恒定节拍）
        while (m.flares.length && age >= m.flares[0]) {
          m.flares.shift();
          flareUp(m, nowP);
        }
        if (m.flareT > 0) m.flareT -= dt;
        const p = m.life / m.life0;
        // 热史：沿余寿渐热（烧蚀谱）
        const heat = smoothstep(0.45, 1, 1 - clamp(p, 0, 1));
        // 过峰检测（相位卷绕，低帧率鲁棒）：一拍 = knot 余烬结 + 节拍能量环 + 头闪三同步
        const cyc = Math.floor((φ - Math.PI / 2) / (Math.PI * 2));
        if (cyc > m.prevCyc) {
          m.prevCyc = cyc;
          const mag0 = Math.hypot(m.vx, m.vy) || 1;
          if (Math.random() < 0.88) {
            // 余烬结（12% 跳拍——个体不成节拍器，整体频率随颗随机）
            const hc = heatColor(heat);
            pushFx({
              kind: 0, x: m.x, y: m.y, born: nowP, dur: 0.5 + Math.random() * 0.3,
              len: (m.big ? 16 + Math.random() * 10 : 8 + Math.random() * 6) * (narrow ? 0.7 : 1),
              dx: m.vx / mag0, dy: m.vy / mag0, rmax: 0,
              a0: narrow ? (m.big ? 0.5 : 0.35) : m.big ? 0.7 : 0.45,
              cr: hc[0], cg: hc[1], cb: hc[2], lineWidth: m.big ? 2.6 : 1.8,
            });
          }
          // 节拍能量环（指定观感律·v4.13 解禁）：头后 4px 尾喷位、火橙发丝环、≪碎裂环≪终爆环。
          // 四道闸：池余量 / 同屏节拍环≤6 / 碎裂耀斑后 0.3s 不落环 / 微款 50% 隔拍跳环（窄屏仅大款）
          if (m.flareT <= 0 && fxCount() < 96 && (m.big || Math.random() < 0.5)) {
            let beatRings = 0;
            for (const fx of fxPool) if (fx && fx.kind === 1 && fx.rmax <= 28) beatRings++;
            if (beatRings < 6) {
              const rr0 = m.big ? (narrow ? 18 : 20 + Math.random() * 6) : narrow ? 13 : 15;
              pushFx({ kind: 1, x: m.x - (m.vx / mag0) * 4, y: m.y - (m.vy / mag0) * 4, born: nowP, dur: 0.25, len: 0, dx: 0, dy: 0, rmax: rr0, a0: m.big ? 0.6 : 0.45, cr: 255, cg: 170, cb: 80, lineWidth: 1.2 });
            }
          }
        }
        // 生命周期包络：入 10% 淡入（头端先亮的点火感）
        const envL = p > 0.9 ? (1 - p) / 0.1 : 1;
        const flareK = m.flareT > 0 ? 1 + 0.7 * Math.sin((1 - m.flareT / 0.3) * Math.PI) : 1; // 碎裂耀斑
        const beatK = 0.55 + 0.45 * Math.pow(sp3, 3); // 头部节拍闪（亮度频闪是「突突突」主载波）
        const a = Math.min(1, (m.big ? 0.75 : 0.5) * clamp(envL, 0, 1) * flareK * beatK); // 稳态不压灯、瞬态可越
        if (a <= 0.01) continue;
        const mag = Math.hypot(m.vx, m.vy) || 1;
        const dx = m.vx / mag, dy = m.vy / mag;
        const tx2 = m.x - dx * m.len;
        const ty2 = m.y - dy * m.len;
        const hc = heatColor(heat);
        // 基线尾（笔断意连）：冷银 → 头端暖化（烧蚀谱）
        const g = ctx.createLinearGradient(tx2, ty2, m.x, m.y);
        g.addColorStop(0, "rgba(226, 236, 255, 0)");
        g.addColorStop(0.6, `rgba(226, 236, 255, ${(a * 0.6).toFixed(3)})`);
        g.addColorStop(1, `rgba(${hc[0] | 0}, ${hc[1] | 0}, ${hc[2] | 0}, ${a.toFixed(3)})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = (m.big ? 3.4 : 1.6) * (narrow ? 1.15 : 1); // 小屏观距近：线要加粗不是减细
        ctx.beginPath();
        ctx.moveTo(tx2, ty2);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        // 头部三层：火晕（节拍闪 ×碎裂耀斑）+ 白热芯（沿运动向微拉长＝运动 smear）
        const hg = 13 * flareK * (0.7 + 0.5 * Math.pow(sp3, 3)) * (m.big ? 1 : 0.7);
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.drawImage(glowSprite(FIRE1), m.x - hg, m.y - hg, hg * 2, hg * 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(255, 248, 235, ${Math.min(1, a * 1.6).toFixed(3)})`;
        ctx.beginPath();
        const ck = (0.85 + 0.15 * Math.pow(sp3, 3)) * flareK;
        ctx.ellipse(m.x, m.y, (3.2 + Math.abs(dx) * 1.6) * ck, (3.2 + Math.abs(dy) * 1.6) * ck, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* ---- 星野（正交投影无穷远：相机惯性静止，星野屏幕静止是物理正确而非将就） ---- */
    let starsX: Float32Array | null = null;
    let starsY: Float32Array | null = null;
    let starsS: Float32Array | null = null;
    let starsA: Float32Array | null = null;
    function bakeStars() {
      const n = W < 640 ? 90 : 170; // 纯随机散点——不得拼出星座/银河/黄道等可解读方向
      starsX = new Float32Array(n);
      starsY = new Float32Array(n);
      starsS = new Float32Array(n);
      starsA = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        starsX[k] = Math.random() * W;
        starsY[k] = Math.random() * H;
        const bucket = Math.random();
        if (bucket < 0.7) {
          starsS[k] = 0.7 + Math.random() * 0.4;
          starsA[k] = 0.16 + Math.random() * 0.14;
        } else if (bucket < 0.95) {
          starsS[k] = 1.1 + Math.random() * 0.4;
          starsA[k] = 0.26 + Math.random() * 0.16;
        } else {
          starsS[k] = 1.7;
          starsA[k] = 0.42 + Math.random() * 0.13;
        }
      }
    }
    function drawStars(nowP: number) {
      if (!starsX || !starsY || !starsS || !starsA || !bootDone) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(cx, cy, R * zoom, 0, Math.PI * 2);
      ctx.clip("evenodd"); // 星在球外：球盘遮星，衬托「球在转」
      for (let k = 0; k < starsX.length; k++) {
        let a = starsA[k];
        if (!reduced && k % 27 === 5) a *= 0.55 + 0.45 * Math.sin(nowP * 0.00045 * (1 + (k % 5) * 0.31) + k); // ≤5 颗慢闪
        ctx.fillStyle = `rgba(215, 225, 245, ${a.toFixed(3)})`;
        ctx.fillRect(starsX[k], starsY[k], starsS[k], starsS[k]);
      }
      ctx.restore();
    }

    /* ---- 真实卫星层：TLE 平均根数传播（真名/真轨道面/真速率）→ 地固投影 ----
     * 「轨道归真、呈现仪表化」：位置来自真实根数；高度按层压缩（真实 1.06/4.2/6.6R
     * → 显示 1.10/1.32/1.52R）。遮挡精确式（r≥1）：z<0 ∧ ρ<1 → 球后不画。 */
    /** 轨道弧：同一根数在 [t+ms0, t+ms1] 的预测折线（悬停全弧/未来段虚线消歧共用） */
    function drawSatArc(s: SatItem, t: number, ms0: number, ms1: number, style: string, width: number, dash?: number[]) {
      const rd = s.el.rDisp;
      const Rz2 = R * zoom;
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let k = 0; k <= 48; k++) {
        const q = propagate(s.el, t + ms0 + ((ms1 - ms0) * k) / 48);
        if (!q) {
          started = false;
          continue;
        }
        const qf = Math.cos(q.lat);
        const X = qf * Math.cos(q.lon), Y = qf * Math.sin(q.lon), Z = Math.sin(q.lat);
        const zc = (X * Ex + Y * Ey + Z * Ez) * rd;
        const rho = Math.sqrt(Math.max(0, rd * rd - zc * zc));
        if (zc < 0 && rho < 1) {
          started = false;
          continue;
        }
        const x = cx + Rz2 * rd * (X * Rx + Y * Ry);
        const y = cy - Rz2 * rd * (X * Nx + Y * Ny + Z * Nz);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
      ctx.restore();
    }
    /** 示意模型：画家算法低模——顶点过同一投影基，面 Lambert 吃真实太阳，
     * 背面剔除（法向·视轴），深度排序后按（材质×亮度档）合批填充。零 GL 改动。 */
    function drawSatModel(
      s: SatItem,
      sunV: { Sx: number; Sy: number; Sz: number },
      pu: { X: number; Y: number; Z: number },
      vd: { X: number; Y: number; Z: number },
      depth: number,
      alphaK: number,
      nowWall: number,
    ): boolean {
      const mdl = modelOf(s.el);
      if (!mdl) return false;
      // 模型基（ECEF）：体轴 T=航向；翼轴 W=太阳的垂轴分量（对日跟踪）；U=T×W
      const Tx = vd.X, Ty = vd.Y, Tz = vd.Z;
      const sd = sunV.Sx * Tx + sunV.Sy * Ty + sunV.Sz * Tz;
      let Wx = sunV.Sx - sd * Tx, Wy = sunV.Sy - sd * Ty, Wz = sunV.Sz - sd * Tz;
      let wl = Math.hypot(Wx, Wy, Wz);
      if (wl < 0.05) {
        const rd2 = pu.X * Tx + pu.Y * Ty + pu.Z * Tz;
        Wx = pu.X - rd2 * Tx;
        Wy = pu.Y - rd2 * Ty;
        Wz = pu.Z - rd2 * Tz;
        wl = Math.hypot(Wx, Wy, Wz) || 1;
      }
      Wx /= wl;
      Wy /= wl;
      Wz /= wl;
      const Ux = Ty * Wz - Tz * Wy, Uy = Tz * Wx - Tx * Wz, Uz = Tx * Wy - Ty * Wx;
      const rd = s.el.rDisp;
      const fleetK = SAT_ITEMS.length > 22 ? 0.85 : 1; // 星队大了船身整体微缩（船多则小）
      const scale = ((mdl.size * fleetK * (W < 640 ? 0.75 : 1)) / mdl.extent) * zoom * (0.8 + 0.4 * depth);
      const m = scale / (R * zoom); // 模型半尺寸（球半径单位）
      const Rz2 = R * zoom;
      const scanA = reduced ? 0.7 : (nowWall * 0.0006283); // 扫描碟 ~10s/圈（类别真行为）
      const cs = Math.cos(scanA), sn = Math.sin(scanA);
      const ox = rd * pu.X, oy = rd * pu.Y, oz = rd * pu.Z; // 轨道位置（显示半径）
      interface Fq { pts: Array<[number, number]>; z: number; k: number; b: number }
      const out: Fq[] = [];
      for (const f of mdl.faces) {
        // 世界面法向（基正交，直接组合）
        const nx = f.n[0] * Tx + f.n[1] * Wx + f.n[2] * Ux;
        const ny = f.n[0] * Ty + f.n[1] * Wy + f.n[2] * Uy;
        const nz = f.n[0] * Tz + f.n[1] * Wz + f.n[2] * Uz;
        if (nx * Ex + ny * Ey + nz * Ez <= 0.02) continue; // 背面剔除
        const lit = Math.max(0, nx * sunV.Sx + ny * sunV.Sy + nz * sunV.Sz);
        // 面顶点（局部，任意边数——棱柱端盖/盒面同路）；扫描部件绕体法向预旋
        const pts: Array<[number, number]> = [];
        let zSum = 0;
        let ok = true;
        for (const v of f.v) {
          let lx = v[0], ly = v[1], lz = v[2];
          if (f.scan) {
            // 扫描碟绕局部 Z（体法向）慢转
            const rx = lx * cs - ly * sn;
            ly = lx * sn + ly * cs;
            lx = rx;
          }
          const wx = ox + m * (lx * Tx + ly * Wx + lz * Ux);
          const wy = oy + m * (lx * Ty + ly * Wy + lz * Uy);
          const wz = oz + m * (lx * Tz + ly * Wz + lz * Uz);
          const px = cx + Rz2 * (wx * Rx + wy * Ry);
          const py = cy - Rz2 * (wx * Nx + wy * Ny + wz * Nz);
          if (px < -60 || px > W + 60 || py < -60 || py > H + 60) ok = false;
          pts.push([px, py]);
          zSum += wx * Ex + wy * Ey + wz * Ez;
        }
        if (!ok) continue;
        // 8 档亮度（棱柱柱面成立的前提——4 档相邻柱面同档糊成平板）；翼面对日亮一档=廉价镜面
        const b = Math.min(7, Math.round(lit * 7) + (f.k === 1 && lit > 0.8 ? 1 : 0));
        out.push({ pts, z: zSum / pts.length, k: f.k, b });
      }
      out.sort((a, b2) => b2.z - a.z); // 远面先画
      const wide = W >= 640;
      const mpx = mdl.extent * scale; // 模型屏显尺寸（px）——细节层门控
      ctx.save();
      ctx.lineWidth = 0.75;
      ctx.globalAlpha = clamp(alphaK, 0, 1);
      const grid: number[] = []; // 电池串栅格线段（缓存到填充后画，不打断 stroke 状态）
      for (let i = 0; i < out.length; i++) {
        const q = out[i];
        const base = MODEL_BASE[q.k];
        const f2 = 0.24 + 0.76 * (q.b / 7); // ambient 0.24：背阳面留轮廓不真黑
        // fillStyle 32 串预缓存（材质×亮度档）——α 走 globalAlpha，34 颗全画不产模板串
        const ckey = q.k * 8 + q.b;
        let fillC = MODEL_FILL_CACHE[ckey];
        if (!fillC) {
          fillC = MODEL_FILL_CACHE[ckey] = `rgb(${Math.round(base[0] * f2)}, ${Math.round(base[1] * f2)}, ${Math.round(base[2] * f2)})`;
        }
        ctx.fillStyle = fillC;
        ctx.beginPath();
        ctx.moveTo(q.pts[0][0], q.pts[0][1]);
        for (let j = 1; j < q.pts.length; j++) ctx.lineTo(q.pts[j][0], q.pts[j][1]);
        ctx.closePath();
        ctx.fill();
        // 窄屏去棱线 stroke 省绘制，但大模型保本体棱线（工程图精致感的下限）
        if (wide || (q.k === 0 && mpx > 13)) ctx.stroke();
        // 太阳翼电池串栅格：两分线（类别共性构造语言，程序化泛型不指向个体）
        if (q.k === 1 && wide && q.pts.length === 4 && mpx > 16) {
          const [c0, c1, c2, c3] = q.pts;
          const e1x = c1[0] - c0[0], e1y = c1[1] - c0[1], e2x = c3[0] - c0[0], e2y = c3[1] - c0[1];
          const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
          if (Math.max(l1, l2) > 14 && Math.min(l1, l2) > 4.2) {
            for (const t of [1 / 3, 2 / 3]) {
              if (l2 <= l1) grid.push(c0[0] + e2x * t, c0[1] + e2y * t, c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t);
              else grid.push(c0[0] + e1x * t, c0[1] + e1y * t, c3[0] + (c2[0] - c3[0]) * t, c3[1] + (c2[1] - c3[1]) * t);
            }
          }
        }
      }
      if (grid.length) {
        ctx.strokeStyle = "rgba(18, 36, 70, 0.4)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let gi = 0; gi < grid.length; gi += 4) {
          ctx.moveTo(grid[gi], grid[gi + 1]);
          ctx.lineTo(grid[gi + 2], grid[gi + 3]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return true;
    }
    function drawSats(sunV: { Sx: number; Sy: number; Sz: number }, tPos: number) {
      if (SAT_ITEMS.length === 0) return;
      const t = Date.now();
      const Rz2 = R * zoom;
      // 静止轨道环带（图例层）：真实世界要素的标注虚环 + 文字标注——非卫星分布暗示
      {
        const rd = 1.52;
        const pts: Array<{ x: number; y: number; ok: boolean }> = [];
        for (let k = 0; k < 64; k++) {
          const a = (k / 64) * Math.PI * 2;
          const X = Math.cos(a), Y = Math.sin(a); // 赤道面（ECEF 静止）
          const dot = X * Ex + Y * Ey;
          const zc = rd * dot;
          const rho = rd * Math.sqrt(Math.max(0, 1 - dot * dot));
          pts.push({
            x: cx + Rz2 * rd * (X * Rx + Y * Ry),
            y: cy - Rz2 * rd * (X * Nx + Y * Ny),
            ok: zc >= 0 || rho >= 1,
          });
        }
        ctx.save();
        const geoTide = 0.2 + 0.22 * Math.max(0, Math.sin((t / 20000) * Math.PI * 2)); // GEO 壳潮（外箍呼吸 rim）
        ctx.strokeStyle = `rgba(85, 175, 255, ${geoTide.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 64; k += 2) {
          const p1 = pts[k], p2 = pts[(k + 1) % 64];
          if (p1.ok && p2.ok) {
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          }
        }
        ctx.stroke();
        // 幽灵外箍：穿盘段（球后）降 α 补全整圈——笼的最大半径一笔，眼睛拿它定壳（透视律）
        ctx.strokeStyle = `rgba(60, 135, 225, ${(0.35 * geoTide).toFixed(3)})`;
        ctx.beginPath();
        for (let k = 0; k < 64; k += 2) {
          const p1 = pts[k], p2 = pts[(k + 1) % 64];
          if (p1.ok || p2.ok) continue; // 前侧段已在上面画过
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
        let bx: { x: number; y: number } | null = null;
        for (const p of pts) if (p.ok && (!bx || p.x > bx.x)) bx = p;
        if (W < 640) {
          // 窄屏：GEO 环右端常出屏（W<537 时永不满足 bx.x<W-58）——改挂环顶可见点上方
          let tp: { x: number; y: number } | null = null;
          for (const p of pts) if (p.ok && (!tp || p.y < tp.y)) tp = p;
          if (tp && tp.y > 16) {
            ctx.fillStyle = "rgba(201, 212, 228, 0.52)";
            ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
            ctx.fillText("静止轨道", clamp(tp.x - 24, 4, W - 52), tp.y - 5);
          }
        } else if (bx && bx.x < W - 58) {
          ctx.fillStyle = "rgba(201, 212, 228, 0.52)";
          ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
          ctx.fillText("静止轨道", bx.x + 5, clamp(bx.y, 12, H - 12));
        }
        ctx.restore();
      }
      for (const s of SAT_ITEMS) {
        if (stale(s.el, t)) {
          s.vis = false;
          s.hidden = false; // 防陈旧坐标混入透视候选池
          continue; // 历元超龄：宁可缺席不可造假（弧随星同灭）
        }
        const p = propagate(s.el, tPos);
        if (!p) {
          s.vis = false;
          continue;
        }
        const cf = Math.cos(p.lat);
        const X = cf * Math.cos(p.lon);
        const Y = cf * Math.sin(p.lon);
        const Z = Math.sin(p.lat);
        // 晨昏穿越闪亮：入阳/入影一瞬增辉（物理真实事件，非装饰）
        const litNow = X * sunV.Sx + Y * sunV.Sy + Z * sunV.Sz;
        const litSign = litNow >= 0 ? 1 : -1;
        if (s.lit !== 0 && litSign !== s.lit && Math.abs(litNow) < 0.25) s.flashUntil = t + 500;
        s.lit = litSign;
        const flashK = t < s.flashUntil ? 1.9 : 1;
        const rd = s.el.rDisp;
        const zc = (X * Ex + Y * Ey + Z * Ez) * rd;
        const rho = Math.sqrt(Math.max(0, rd * rd - zc * zc)); // 屏面偏移（球半径单位）
        const limbK = zc < 0 ? clamp((rho - 0.96) / 0.04, 0, 1) : 1;
        if (zc < 0 && limbK <= 0.02) {
          // 球后补算坐标（透视律：结构层要用真实球后位置；实体不透视——vis 仍 false，satAt 天然排除）
          s.zc = zc;
          s.rho = rho;
          s.x = cx + Rz2 * rd * (X * Rx + Y * Ry);
          s.y = cy - Rz2 * rd * (X * Nx + Y * Ny + Z * Nz);
          s.ux = X;
          s.uy = Y;
          s.uz = Z;
          s.hidden = true;
          s.vis = false;
          continue;
        }
        s.hidden = false;
        s.zc = zc;
        s.rho = rho;
        s.x = cx + Rz2 * rd * (X * Rx + Y * Ry);
        s.y = cy - Rz2 * rd * (X * Nx + Y * Ny + Z * Nz);
        s.ux = X;
        s.uy = Y;
        s.uz = Z;
        s.vis = true;
        const depth = 0.55 + 0.45 * clamp(zc / rd, -1, 1); // 深度下限 0.55：背面近临边不熄
        const a = clamp(depth * limbK, 0, 1);
        const breath = 0.9 + 0.1 * Math.sin(t * 0.0006 + s.ph); // 微呼吸底
        // 三壳潮汐（呼吸律）：LEO 12s/MEO 18s/GEO 26s 内快外慢，半波 sin³（吸-呼），壳内去同步；峰值×1.7
        const tideP = s.el.tier === "leo" ? 10000 : s.el.tier === "meo" ? 14000 : 20000; // LEO=0.1Hz 共振呼吸频率
        s.boost = reduced ? 1 : 1 + (s.el.tier === "leo" ? 0.7 : s.el.tier === "meo" ? 0.6 : 0.5) * Math.pow(Math.max(0, Math.sin((t / tideP) * Math.PI * 2 + s.ph * 0.35)), 1.5); // 宽包络：任意时刻更多星在吸气
        const isGeo = s.el.tier === "geo";
        const blink = isGeo ? 0.4 + 0.35 * (0.5 + 0.5 * Math.sin((t / 3000) * Math.PI * 2)) : 1;
        const coreA = clamp(a * (isGeo ? blink : 0.95) * flashK, 0, 1);
        const halo = isGeo ? 18 : s.el.tier === "meo" ? 11 : 10;
        const haloA = clamp(a * (isGeo ? blink * 0.75 : 0.55) * breath * flashK * s.boost, 0, 1); // 潮汐入辉光（白芯不动防糊点）
        // 回看轨迹：真实传播的过去时间窗（sim 钟下按轨道弧取份——LEO 8%/MEO 7%；GEO 无尾是信息）。
        // 单 gradient 连续 α（幂律衰减）+ 宽度渐细 + 12 采样圆滑弧——连续感是真实感，阶跃是「粘上」
        if (s.el.tier !== "geo" && a > 0.25) {
          const lookMs = ((Math.PI * 2) / s.el.n) * 60000 * (s.el.tier === "leo" ? 0.08 : 0.07);
          const pts: Array<[number, number, boolean]> = [[s.x, s.y, true]];
          for (let k = 1; k <= 12; k++) {
            const q = propagate(s.el, tPos - (lookMs * k) / 12);
            if (!q) break;
            const qf = Math.cos(q.lat);
            const qX = qf * Math.cos(q.lon), qY = qf * Math.sin(q.lon), qZ = Math.sin(q.lat);
            const qzc = (qX * Ex + qY * Ey + qZ * Ez) * rd;
            const qrho = Math.sqrt(Math.max(0, rd * rd - qzc * qzc));
            pts.push([cx + Rz2 * rd * (qX * Rx + qY * Ry), cy - Rz2 * rd * (qX * Nx + qY * Ny + qZ * Nz), qzc >= 0 || qrho >= 1]);
          }
          if (pts.length > 2) {
            const tail = pts[pts.length - 1];
            const grad = ctx.createLinearGradient(s.x, s.y, tail[0], tail[1]);
            const ta = a * 0.5;
            grad.addColorStop(0, `rgba(201, 212, 228, ${ta.toFixed(3)})`);
            grad.addColorStop(0.3, `rgba(201, 212, 228, ${(ta * 0.35).toFixed(3)})`);
            grad.addColorStop(0.6, `rgba(201, 212, 228, ${(ta * 0.12).toFixed(3)})`);
            grad.addColorStop(1, "rgba(201, 212, 228, 0)");
            ctx.strokeStyle = grad;
            for (let k = 1; k < pts.length; k++) {
              if (!pts[k - 1][2] || !pts[k][2]) continue; // 遮挡断笔
              ctx.lineWidth = 1.8 - (1.4 * k) / pts.length; // 头粗尾细
              ctx.beginPath();
              ctx.moveTo(pts[k - 1][0], pts[k - 1][1]);
              ctx.lineTo(pts[k][0], pts[k][1]);
              ctx.stroke();
            }
          }
        }
        // 悬停全弧（选中才画轨道线）：过去半弧实线、未来半弧虚线消歧「将行」
        if (s === hoverSat) {
          const perMs = ((Math.PI * 2) / s.el.n) * 60000;
          drawSatArc(s, tPos, -perMs / 2, 0, "rgba(201, 212, 228, 0.24)", 1);
          drawSatArc(s, tPos, 0, perMs / 2, "rgba(201, 212, 228, 0.1)", 1, [3, 4]);
        }
        // 墨晕垫底（satvis 1px 暗描边惯例——任何底色上保持可读，全模式）
        ctx.fillStyle = "rgba(5, 8, 14, 0.4)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.fill();
        // 辉光精灵（径向立方衰减家族）——潮汐 swell：尺寸呼吸（比纯 α 显眼，总增幅仍 ≤×1.8）
        const swell = 1 + (s.boost - 1) * 0.85;
        ctx.globalAlpha = haloA;
        ctx.drawImage(glowSprite(SILVER), s.x - halo * swell, s.y - halo * swell, halo * 2 * swell, halo * 2 * swell);
        ctx.globalAlpha = 1;
        // 示意模型（zoom≥0.92 淡入；远看符号点、近看形体——画家算法零 GL 改动）
        const modelK = smoothstep(0.92, 1.06, zoom);
        // 移动端全量模型（v4.14：空间账可行，绘制预算靠 12 串 fill 缓存+窄屏去棱线+FPS 阀兜底）
        const modelOff = narrowModelsOff && !HERO_NORADS.includes(s.el.norad);
        let modelDrawn = false;
        if (modelK > 0.02 && !modelOff) {
          const q2 = propagate(s.el, tPos + 20000); // 航向差分（20 sim 秒弧）
          if (q2) {
            const qf2 = Math.cos(q2.lat);
            const vX = qf2 * Math.cos(q2.lon) - X, vY = qf2 * Math.sin(q2.lon) - Y, vZ = Math.sin(q2.lat) - Z;
            const vl = Math.hypot(vX, vY, vZ);
            if (vl > 1e-6)
              modelDrawn = drawSatModel(
                s, sunV, { X, Y, Z }, { X: vX / vl, Y: vY / vl, Z: vZ / vl },
                clamp(zc / rd, -1, 1), clamp(a * modelK * flashK * (1 + (s.boost - 1) * 0.5), 0, 1), t,
              );
          }
        }
        if (!modelDrawn) {
          const col = `rgba(206, 218, 236, ${(coreA * (1 - modelK)).toFixed(3)})`; // 构造银蓝（金/朱/SILVER 语义色归灯）
          if (s.el.tier === "meo") {
            // 点 + 太阳能板两笔（「—·—」横担）；板面掠光：周期性反照增亮（物理真实）
            const gph = (((t / 1000 + s.glintOff) % s.glintP) / s.glintP + 1) % 1;
            const glint = gph < 0.12 ? Math.sin((gph / 0.12) * Math.PI) * 0.15 : 0;
            const pcol = `rgba(206, 218, 236, ${(clamp(coreA + glint, 0, 1) * (1 - modelK)).toFixed(3)})`;
            ctx.strokeStyle = pcol;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(s.x - 4.5, s.y);
            ctx.lineTo(s.x - 2, s.y);
            ctx.moveTo(s.x + 2, s.y);
            ctx.lineTo(s.x + 4.5, s.y);
            ctx.stroke();
            ctx.fillStyle = pcol;
            ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
          } else {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(s.x, s.y, isGeo ? 3.5 : 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    function satAt(x: number, y: number, r = 16): SatItem | null {
      for (const s of SAT_ITEMS) {
        if (s.vis && Math.hypot(s.x - x, s.y - y) < r) return s; // 命中半径随视觉足印放大（触屏 22）
      }
      return null;
    }
    /** 最近邻真距离（网骨架律条件④：悬停把唯一真值亮出）——单位向量大圆距 km */
    function nearestNeighborKm(s: SatItem): number {
      let best = Infinity;
      for (const o of SAT_ITEMS) {
        if (o === s || !o.vis) continue;
        const d = Math.hypot(s.ux - o.ux, s.uy - o.uy, s.uz - o.uz);
        const km = 2 * Math.asin(Math.min(1, d / 2)) * 6371;
        if (km < best) best = km;
      }
      return best;
    }

    /* ---- 链路层（几何真值连线律）----
     * 两类触发：真实中继链（公开架构事实：ISS/哈勃经 TDRS、天和经天链、北斗星间链——双真无需降格）
     * 与过顶示意链（真实几何量触发：最近过顶 + 互见；无真实数据关系，形制更低调）。
     * 渲染统一 Beam：底弦 + 正弦行波（仅中继链）+ 行进脉冲 + 若隐若现包络 + 逐点 z 遮挡。 */
    interface Beam {
      kind: 0 | 1 | 2; // 0=星间链 1=过顶示意（LEO/MEO 最近过顶）2=GEO 区域波束（通信星锥内轮发，波束为真端点为示意）
      real: boolean; // 真实公开中继架构（强形态：正弦波+3 粒脉冲）vs 几何示意互见链（形制稍敛）
      a: SatItem;
      b: SatItem | null;
      lamp: (typeof lamps)[number] | null;
      t0: number;
      dur: number; // s
      seed: number;
      arrived?: number; // 已抵达信号计数（每信号爆一次）
      lastBurstAt?: number; // 最近一次抵达爆闪时刻（离散爆闪：一球一爆，快收再爆）
    }
    const beams: Beam[] = [];
    const beamCooldown = new Map<string, number>();
    const passState = new Map<number, { mic: string; dot: number; armed: boolean }>();
    const lampNextAt = new Map<string, number>(); // 公平轮转：每所独立错峰（时机策展律——只挑时机不降几何门槛）
    const geoNextAt = new Map<number, number>(); // GEO 通信星波束节拍
    const GEO_COMM = [42915, 49011, 40882, 41380]; // TDRS 13/天链/Inmarsat 5-F3/SES-9（通信 GEO）
    const HERO_NORADS = [25544, 48274, 20580];
    const RELAY_PAIRS: Array<[number, number]> = [
      [25544, 42915], // ISS → TDRS 13
      [20580, 42915], // 哈勃 → TDRS 13
      [48274, 49011], // 天和 → 天链二号 01
      [43581, 44204], // 北斗 M5 ↔ 北斗 IGSO（星间链）
    ];
    let relayNextAt = 0;
    function satByNorad(n: number): SatItem | null {
      for (const s of SAT_ITEMS) if (s.el.norad === n) return s;
      return null;
    }
    /** 互见判定（STK 惯例：直线 + 地心遮挡）——线段到球心最近距 > 单位球半径即通视 */
    function losClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const t = clamp(-(ax * dx + ay * dy + az * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      return px * px + py * py + pz * pz > 1.0;
    }
    /* ---- 巨网骨架（网骨架律）：真 3D 距离 k 近邻 + 互见才连 + 常驻发丝线 ----
     * 近邻为真实几何量、互连为呈现示意（README 双向披露）；不带脉冲/爆闪——事件语义专属 Beam 层。
     * 工程红利：losClear 通过的弦在正交投影下=纯直线，零逐点遮挡成本。 */
    interface MeshEdge { a: SatItem; b: SatItem; k: number; ph: number; pe: number; gl: number; gt: number; gp: number } // gl/gt/gp=glint 下一闪时刻/计时/线上位置
    const meshEdges = new Map<string, MeshEdge>();
    let meshDegrade = false; // FPS 阀二级降档：k→1
    function updateMesh(dtMs: number) {
      const nowM = performance.now();
      const cand = SAT_ITEMS.filter((s) => s.vis || s.hidden); // 全池（含球后）——拓扑稳定，透视网笼的后半张
      const kN = meshDegrade ? 1 : W < 640 ? 2 : 3;
      const want = new Set<string>();
      for (const s of cand) {
        const ds: Array<{ o: SatItem; d: number }> = [];
        for (const o of cand) {
          if (o === s) continue;
          const dx = s.el.rDisp * s.ux - o.el.rDisp * o.ux;
          const dy = s.el.rDisp * s.uy - o.el.rDisp * o.uy;
          const dz = s.el.rDisp * s.uz - o.el.rDisp * o.uz;
          ds.push({ o, d: dx * dx + dy * dy + dz * dz });
        }
        ds.sort((a, b) => a.d - b.d);
        for (let i = 0; i < kN && i < ds.length; i++) {
          const o = ds[i].o;
          const key = s.el.norad < o.el.norad ? `${s.el.norad}-${o.el.norad}` : `${o.el.norad}-${s.el.norad}`;
          want.add(key);
          if (!meshEdges.has(key)) {
            const hv = ((s.el.norad * 31 + o.el.norad * 17) % 997) / 997;
            meshEdges.set(key, { a: s.el.norad < o.el.norad ? s : o, b: s.el.norad < o.el.norad ? o : s, k: 0, ph: hv * Math.PI * 2, pe: 2.8 + (((s.el.norad + o.el.norad) % 13) / 13) * 1.7, gl: 0, gt: 0, gp: 0.5 });
          }
        }
      }
      for (const [key, e] of meshEdges) {
        const target = want.has(key) ? 1 : 0;
        e.k += (target - e.k) * Math.min(1, dtMs / 400); // 生灭 0.4s 淡入出（呼吸感，无 pop）
        if (target === 0 && e.k < 0.03) {
          meshEdges.delete(key);
          continue;
        }
        // 亮闪闪 glint：每条线不定时急闪一次（快攻稍慢收），线上随机点一粒白蓝闪点
        if (reduced) continue;
        if (e.gt > 0) e.gt -= dtMs / 1000;
        else if (nowM >= e.gl) {
          e.gt = 0.5;
          e.gp = 0.15 + Math.random() * 0.7;
          e.gl = nowM + 6000 + Math.random() * 10000;
        }
      }
    }
    function drawMesh() {
      if (!meshEdges.size) return;
      const nowP = performance.now();
      const dimK = (W < 640 ? 0.5 : 1) * (meshDegrade ? 0.6 : 1);
      const aScale = Math.min(1, 55 / meshEdges.size); // 密度保险丝（放宽：亮度诉求优先）
      const alive = (q: SatItem) => q.vis || q.hidden;
      ctx.save();
      ctx.lineWidth = 0.85; // 发丝线（闪烁亮段另加粗）
      // pass 1：幽灵（球后段——透视律：位置真值、前亮后暗为硬性深度线索、更冷色）
      if (!meshDegrade) {
        const gk = dimK * (W < 640 ? 0.3 : 1);
        for (const e of meshEdges.values()) {
          const A = e.a, B = e.b;
          if (!alive(A) || !alive(B)) continue;
          const front = A.zc > 0 && B.zc > 0;
          if (front && losClear(A.el.rDisp * A.ux, A.el.rDisp * A.uy, A.el.rDisp * A.uz, B.el.rDisp * B.ux, B.el.rDisp * B.uy, B.el.rDisp * B.uz)) continue; // 前侧互见边走 pass 2
          const d3 = Math.hypot(A.el.rDisp * A.ux - B.el.rDisp * B.ux, A.el.rDisp * A.uy - B.el.rDisp * B.uy, A.el.rDisp * A.uz - B.el.rDisp * B.uz);
          const twk = reduced ? 0 : Math.max(0, Math.sin((nowP / 1000 / e.pe) * Math.PI * 2 + e.ph)); // 呼吸节奏（若隐若现：暗谷 0.15 近无）
          const gk0 = e.gt > 0 ? Math.sin((1 - e.gt / 0.5) * Math.PI) : 0; // glint 包络（快攻慢收的近似半波）
          const a0 = Math.max(0.03, (d3 < 0.6 ? 0.3 : d3 < 1.1 ? 0.19 : 0.1) * 0.35 * (0.15 + 1.45 * Math.pow(twk, 1.6) + gk0 * 2.2)) * e.k * gk * aScale * (1 + 1.0 * ((A.boost + B.boost) / 2 - 1));
          ctx.strokeStyle = `rgba(60, 135, 225, ${a0.toFixed(3)})`; // 深海蓝（幽灵档）
          ctx.lineWidth = 0.85 + twk * twk * 0.55;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
        // 球后幽灵节点微点（网要收口——环不能穿「空」；实体不透视故只此微点无辉光）
        ctx.fillStyle = `rgba(60, 135, 225, ${(0.32 * gk).toFixed(3)})`;
        for (const q of SAT_ITEMS) {
          if (!q.hidden) continue;
          let linked = false;
          for (const e of meshEdges.values()) if (e.a === q || e.b === q) { linked = true; break; }
          if (!linked) continue;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // pass 2：前侧（现款）
      for (const e of meshEdges.values()) {
        const A = e.a, B = e.b;
        if (!A.vis || !B.vis || A.zc <= 0 || B.zc <= 0) continue;
        if (!losClear(A.el.rDisp * A.ux, A.el.rDisp * A.uy, A.el.rDisp * A.uz, B.el.rDisp * B.ux, B.el.rDisp * B.uy, B.el.rDisp * B.uz)) continue;
        const d3 = Math.hypot(A.el.rDisp * A.ux - B.el.rDisp * B.ux, A.el.rDisp * A.uy - B.el.rDisp * B.uy, A.el.rDisp * A.uz - B.el.rDisp * B.uz);
        const twk = reduced ? 0 : Math.max(0, Math.sin((nowP / 1000 / e.pe) * Math.PI * 2 + e.ph));
        const gk0 = e.gt > 0 ? Math.sin((1 - e.gt / 0.5) * Math.PI) : 0;
        const a0 = (d3 < 0.6 ? 0.3 : d3 < 1.1 ? 0.19 : 0.1) * (0.15 + 1.45 * Math.pow(twk, 1.6) + gk0 * 2.2) * e.k * dimK * aScale * (1 + 1.0 * ((A.boost + B.boost) / 2 - 1));
        if (a0 <= 0.01) continue;
        ctx.strokeStyle = `rgba(85, 175, 255, ${a0.toFixed(3)})`; // 电光海洋蓝（网的身份色）
        ctx.lineWidth = 0.85 + twk * twk * 0.55 + gk0 * gk0 * 2.2;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
        if (gk0 > 0.05) {
          // 亮闪闪闪点：glint 时线上随机处一粒白蓝星芒
          const gx = A.x + (B.x - A.x) * e.gp;
          const gy = A.y + (B.y - A.y) * e.gp;
          ctx.globalAlpha = clamp(gk0 * 0.95, 0, 1);
          ctx.drawImage(glowSprite([160, 205, 255]), gx - 7, gy - 7, 14, 14);
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(225, 240, 255, ${clamp(gk0, 0, 1).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(gx, gy, 1.2 + gk0 * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    /* ---- 轨道弧常驻（真值织笼，常驻升档条款：纯真值结构免注）----
     * 四条异构真弧：ISS 51.6° / 北斗 IGSO（8 字地迹）/ NOAA-19 极轨 / GPS MEO。
     * 49 点 ECEF 单位向量缓存 2s 刷新（自然错峰），帧间只做点积投影；实线——虚线是悬停「将行」专属语义。 */
    const ORBIT_BONES = [25544, 44204, 33591, 40534, 44714, 42803, 40128]; // +星链 53°/铱星极轨/伽利略 MEO
    const orbitCache = new Map<number, { pts: Float32Array; at: number }>();
    function drawOrbitBones(tPos: number) {
      const arcAlpha = W < 640 ? 0.13 : 0.085;
      const ghostAlpha = W < 640 ? 0.05 : 0.038; // 透视律：球后段降 α 连续（前亮后暗=深度线索）
      const bones = W < 640 ? ORBIT_BONES.slice(0, 2) : ORBIT_BONES;
      ctx.save();
      ctx.lineWidth = 1;
      const Rz2 = R * zoom;
      for (const gn of bones) {
        const s0 = satByNorad(gn);
        if (!s0 || stale(s0.el, Date.now())) continue;
        let c = orbitCache.get(gn);
        if (!c || tPos - c.at > 2000) {
          const perMs = ((Math.PI * 2) / s0.el.n) * 60000;
          const pts = new Float32Array(49 * 3);
          for (let i = 0; i <= 48; i++) {
            const q = propagate(s0.el, tPos - perMs / 2 + (perMs * i) / 48);
            if (q) {
              const qf = Math.cos(q.lat);
              pts[i * 3] = qf * Math.cos(q.lon);
              pts[i * 3 + 1] = qf * Math.sin(q.lon);
              pts[i * 3 + 2] = Math.sin(q.lat);
            }
          }
          c = { pts, at: tPos };
          orbitCache.set(gn, c);
        }
        const rd = s0.el.rDisp;
        // 双 pass：前段常 α + 球后段幽灵 α（断笔改降亮——笼的后半张）
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = `rgba(85, 175, 255, ${(pass === 0 ? arcAlpha : ghostAlpha).toFixed(3)})`;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i <= 48; i++) {
            const X = c.pts[i * 3], Y = c.pts[i * 3 + 1], Z = c.pts[i * 3 + 2];
            const zc = (X * Ex + Y * Ey + Z * Ez) * rd;
            const rho = Math.sqrt(Math.max(0, rd * rd - zc * zc));
            const behind = zc < 0 && rho < 1;
            if ((pass === 0) === behind) {
              started = false;
              continue;
            }
            const x = cx + Rz2 * rd * (X * Rx + Y * Ry);
            const y = cy - Rz2 * rd * (X * Nx + Y * Ny + Z * Nz);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    function updateBeams(nowP: number) {
      for (let k = beams.length - 1; k >= 0; k--) if (nowP > beams[k].t0 + beams[k].dur * 1000) beams.splice(k, 1);
      if (reduced || !bootDone) return;
      // 星间链：先试真实中继对（公开架构，强形态），八成概率再泛化到任意互见对（几何示意：互见即通）
      if (nowP > relayNextAt && beams.length < (W < 640 ? 8 : 12)) {
        relayNextAt = nowP + 1800 + Math.random() * 2200; // 密一些（原 10-18s）
        let picked: Beam | null = null;
        const tries = RELAY_PAIRS.slice().sort(() => Math.random() - 0.5);
        for (const [na, nb] of tries) {
          const A = satByNorad(na), B = satByNorad(nb);
          if (!A || !B || !A.vis || !B.vis) continue;
          if (beams.some((b) => (b.a === A && b.b === B) || (b.a === B && b.b === A))) continue;
          if (!losClear(A.el.rDisp * A.ux, A.el.rDisp * A.uy, A.el.rDisp * A.uz, B.el.rDisp * B.ux, B.el.rDisp * B.uy, B.el.rDisp * B.uz)) continue;
          picked = { kind: 0, real: true, a: A, b: B, lamp: null, t0: nowP, dur: 5 + Math.random() * 3, seed: Math.random() };
          break;
        }
        if (!picked && Math.random() < 0.8) {
          for (let t2 = 0; t2 < 8 && !picked; t2++) {
            const A = SAT_ITEMS[(Math.random() * SAT_ITEMS.length) | 0];
            const B = SAT_ITEMS[(Math.random() * SAT_ITEMS.length) | 0];
            if (!A || !B || A === B || !A.vis || !B.vis) continue;
            if (Math.hypot(A.x - B.x, A.y - B.y) < 70) continue; // 太近的两星连线读不出「传输」
            if (Math.random() > 0.7 + ((A.boost + B.boost) / 2 - 1) * 0.43) continue; // 编排共振：潮峰优先（时机策展，门槛不降）
            const pk = A.el.norad < B.el.norad ? `${A.el.norad}-${B.el.norad}` : `${B.el.norad}-${A.el.norad}`;
            if ((beamCooldown.get("g:" + pk) ?? 0) > nowP) continue; // 配对冷却：轮换搭档
            if (beams.some((b) => (b.a === A && b.b === B) || (b.a === B && b.b === A))) continue;
            if (!losClear(A.el.rDisp * A.ux, A.el.rDisp * A.uy, A.el.rDisp * A.uz, B.el.rDisp * B.ux, B.el.rDisp * B.uy, B.el.rDisp * B.uz)) continue;
            picked = { kind: 0, real: false, a: A, b: B, lamp: null, t0: nowP, dur: 4 + Math.random() * 2, seed: Math.random() };
            beamCooldown.set("g:" + pk, nowP + 9000 + Math.random() * 6000);
          }
        }
        if (picked) {
          beams.push(picked);
          picked.a.flashUntil = nowP + 500;
          if (picked.b) picked.b.flashUntil = nowP + 500;
        }
      }
      // 过顶示意链（被动层）：最近点（星-灯点积局部极大）触发 + 冷却 30s/对 + 滞回重武装（<0.88 才再武装）
      for (const s of SAT_ITEMS) {
        if (!s.vis || s.el.tier === "geo") continue;
        let best: (typeof lamps)[number] | null = null;
        let bd = -1;
        for (const l of lamps) {
          if (l.z < 0.15) continue; // 灯须在前侧
          const d = s.ux * l.vx + s.uy * l.vy + s.uz * l.vz;
          if (d > bd) {
            bd = d;
            best = l;
          }
        }
        if (!best) continue;
        const st = passState.get(s.el.norad);
        if (!st || st.mic !== best.exch.mic) {
          passState.set(s.el.norad, { mic: best.exch.mic, dot: bd, armed: true });
          continue;
        }
        if (bd < 0.88) st.armed = true;
        if (st.armed && st.dot > 0.92 && bd < st.dot && beams.length < (W < 640 ? 8 : 12) && (beamCooldown.get(`${s.el.norad}:${best.exch.mic}`) ?? 0) < nowP) {
          beams.push({ kind: 1, real: false, a: s, b: null, lamp: best, t0: nowP, dur: 3.2, seed: Math.random() });
          beamCooldown.set(`${s.el.norad}:${best.exch.mic}`, nowP + 30000);
          s.flashUntil = nowP + 500;
          st.armed = false;
        }
        st.dot = bd;
      }
      // 公平轮转层（时机策展律）：每所错峰 25-45s 到点，在「当刻真实达标过顶」（dot>0.92 不降）的卫星里挑最优——
      // 26 颗 LEO/MEO 单钟 19s/圈下自然覆盖全球，轮转只分配时机保证雨露均沾
      if (lampNextAt.size === 0) lamps.forEach((l, i) => lampNextAt.set(l.exch.mic, nowP + 2000 + i * 1600 + Math.random() * 4000));
      for (const l of lamps) {
        const due = lampNextAt.get(l.exch.mic) ?? 0;
        if (nowP < due) continue;
        if (l.z < 0.15 || beams.length >= (W < 640 ? 8 : 12)) {
          lampNextAt.set(l.exch.mic, nowP + 3000);
          continue;
        }
        let pick: SatItem | null = null;
        let pd = 0.92; // 几何门槛不降（判官条件①）
        for (const s of SAT_ITEMS) {
          if (!s.vis || s.el.tier === "geo") continue;
          if ((beamCooldown.get(`${s.el.norad}:${l.exch.mic}`) ?? 0) > nowP) continue;
          const dTrue = s.ux * l.vx + s.uy * l.vy + s.uz * l.vz;
          if (dTrue < 0.92) continue; // 几何门槛以真 dot 判（密度形制律：门槛不降）
          const d = dTrue + (s.boost - 1) * 0.05; // 潮峰微偏置只参与排序
          if (d > pd) {
            pd = d;
            pick = s;
          }
        }
        if (pick) {
          beams.push({ kind: 1, real: false, a: pick, b: null, lamp: l, t0: nowP, dur: 3.2, seed: Math.random() });
          beamCooldown.set(`${pick.el.norad}:${l.exch.mic}`, nowP + 30000);
          pick.flashUntil = nowP + 500;
          lampNextAt.set(l.exch.mic, nowP + 25000 + Math.random() * 20000);
        } else {
          lampNextAt.set(l.exch.mic, nowP + 5000); // 本轮无达标星：5s 后再试
        }
      }
      // GEO 区域波束层（常驻链条款：波束为真端点为示意）：通信 GEO 对可视锥内（星下点-灯夹角<72°）
      // 灯位轮发 45-90s，软形态脉动防读作专线；每灯同时至多一条 GEO 波束
      for (const gn of GEO_COMM) {
        const g = satByNorad(gn);
        if (!g || !g.vis) continue;
        const due = geoNextAt.get(gn) ?? nowP + 5000 + Math.random() * 20000;
        if (nowP < due) continue;
        geoNextAt.set(gn, nowP + 45000 + Math.random() * 45000);
        if (beams.length >= (W < 640 ? 8 : 12)) continue;
        const covered = lamps.filter((l) => l.z > 0.15 && g.ux * l.vx + g.uy * l.vy + g.uz * l.vz > 0.31 && !beams.some((b) => b.kind === 2 && b.lamp === l));
        if (!covered.length) continue;
        const l = covered[(Math.random() * covered.length) | 0];
        beams.push({ kind: 2, real: false, a: g, b: null, lamp: l, t0: nowP, dur: 4, seed: Math.random() });
        g.flashUntil = nowP + 500;
      }
    }
    function drawBeams(nowP: number) {
      if (!beams.length) return;
      const sigK = W < 640 ? 1.25 : 1; // 小屏信号球放大（小屏事件要更大才可读）
      ctx.save();
      for (const bm of beams) {
        const sat = bm.a;
        if (!sat.vis) continue;
        const rda = sat.el.rDisp;
        const ax3 = rda * sat.ux, ay3 = rda * sat.uy, az3 = rda * sat.uz;
        let bx3 = 0, by3 = 0, bz3 = 0;
        if (bm.kind === 0 && bm.b && bm.b.vis) {
          const rdb = bm.b.el.rDisp;
          bx3 = rdb * bm.b.ux;
          by3 = rdb * bm.b.uy;
          bz3 = rdb * bm.b.uz;
        } else if (bm.kind !== 0 && bm.lamp) {
          bx3 = bm.lamp.vx; // 地表点（单位球面）
          by3 = bm.lamp.vy;
          bz3 = bm.lamp.vz;
        } else continue;
        const el = (nowP - bm.t0) / 1000;
        const env = el < 0.3 ? el / 0.3 : el > bm.dur - 0.5 ? Math.max(0, (bm.dur - el) / 0.5) : 1; // 若隐若现包络
        if (env <= 0) continue;
        // 3D 弦采样 + 逐点遮挡（弦两端球外、中段可能穿球后）
        const NP = 32;
        const pts: Array<[number, number, boolean]> = [];
        for (let k = 0; k <= NP; k++) {
          const u = k / NP;
          const wx = ax3 + (bx3 - ax3) * u, wy = ay3 + (by3 - ay3) * u, wz = az3 + (bz3 - az3) * u;
          const zc = wx * Ex + wy * Ey + wz * Ez;
          const rho2 = wx * wx + wy * wy + wz * wz - zc * zc;
          pts.push([cx + R * zoom * (wx * Rx + wy * Ry), cy - R * zoom * (wx * Nx + wy * Ny + wz * Nz), zc >= 0 || rho2 >= 1]);
        }
        const lowK = bm.kind === 1 ? 0.7 : 1; // 过顶示意整体更低调（判例条件 b）
        // 底弦（波导；GEO 波束更宽更淡——区域覆盖的「驻留」读感）
        ctx.strokeStyle = `rgba(206, 218, 236, ${((bm.kind === 2 ? 0.12 : 0.18) * env * (bm.kind === 1 ? 0.7 : 1)).toFixed(3)})`;
        ctx.lineWidth = bm.kind === 2 ? 1.5 : 1;
        ctx.beginPath();
        let started = false;
        for (const p of pts) {
          if (!p[2]) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p[0], p[1]);
            started = true;
          } else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
        // 正弦行波（星间链皆有——3 波包端点归零，相位流动；真实中继稍强）
        if (bm.kind === 0) {
          const dxp = pts[pts.length - 1][0] - pts[0][0], dyp = pts[pts.length - 1][1] - pts[0][1];
          const dl = Math.hypot(dxp, dyp) || 1;
          const nx = -dyp / dl, ny = dxp / dl;
          ctx.strokeStyle = `rgba(206, 218, 236, ${((bm.real ? 0.22 : 0.15) * env).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          started = false;
          for (let k = 0; k <= NP; k++) {
            const p = pts[k];
            if (!p[2]) {
              started = false;
              continue;
            }
            const su = k / NP;
            const off = Math.sin(su * Math.PI * 6 - nowP * 0.012 + bm.seed) * 1.8 * Math.sin(Math.PI * su);
            if (!started) {
              ctx.moveTo(p[0] + nx * off, p[1] + ny * off);
              started = true;
            } else ctx.lineTo(p[0] + nx * off, p[1] + ny * off);
          }
          ctx.stroke();
        }
        // 信号流：一束链路承载一串信号（~0.3s 一发），每个信号走完各自抵达——
        // 抵达爆一次（过顶→灯爆 bloom 连环；星间→两端掠光连环），不是一束只爆一次
        const trav = bm.kind === 1 ? 0.85 : bm.kind === 2 ? 1.2 : 0.7; // GEO 波束信号慢走（驻留节拍）
        const sigInt = bm.kind === 1 ? 0.28 : bm.kind === 2 ? 0.5 : bm.real ? 0.35 : 0.42;
        const elapsed = (nowP - bm.t0) / 1000;
        let arrived = 0;
        for (let k = 0; k * sigInt < bm.dur; k++) {
          const ph = (elapsed - k * sigInt) / trav;
          if (ph < 0 || ph > 1) continue;
          if (k * sigInt + trav <= elapsed) arrived++;
          const p = pts[Math.round(ph * NP)];
          if (!p || !p[2]) continue;
          const fade = Math.sin(Math.PI * ph);
          ctx.globalAlpha = clamp(0.75 * env * fade, 0, 1);
          ctx.drawImage(glowSprite(SILVER), p[0] - 5 * sigK, p[1] - 5 * sigK, 10 * sigK, 10 * sigK);
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(235, 242, 252, ${clamp(0.9 * env * fade, 0, 1).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1.6 * sigK, 0, Math.PI * 2);
          ctx.fill();
        }
        if (arrived > (bm.arrived ?? 0)) {
          bm.arrived = arrived;
          bm.lastBurstAt = nowP; // 一球一爆：每个信号抵达独立爆闪（快收再爆，离散可数）
          if ((bm.kind === 1 || bm.kind === 2) && bm.lamp) bm.lamp.bloomT = Math.max(bm.lamp.bloomT, bm.kind === 1 ? 0.3 : 0.25); // 灯底衬微亮（爆闪为主；GEO 波束仅底辉呼吸）
          else if (bm.kind === 0) {
            bm.a.flashUntil = nowP + 300;
            if (bm.b) bm.b.flashUntil = nowP + 300;
          }
        }
        // 抵达爆闪演出（过顶链）：扩张环 + 辉斑 0.35s 快收——球到爆一次，多球连环爆
        if (bm.kind === 1 && bm.lamp && bm.lastBurstAt !== undefined) {
          const age = (nowP - bm.lastBurstAt) / 1000;
          const bw0 = W < 640 ? 0.46 : 0.35; // 小屏爆闪 +30% 时长（更大更慢才被看见）
          if (age >= 0 && age < bw0) {
            const k = age / bw0;
            ctx.strokeStyle = `rgba(235, 242, 252, ${(0.8 * (1 - k) * env).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(bm.lamp.x, bm.lamp.y, 5 + k * 27, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = clamp(0.7 * (1 - k) * env, 0, 1);
            ctx.drawImage(glowSprite(SILVER), bm.lamp.x - 10, bm.lamp.y - 10, 20, 20);
            ctx.globalAlpha = 1;
            ctx.fillStyle = `rgba(255, 250, 240, ${clamp(0.9 * (1 - k) * env, 0, 1).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(bm.lamp.x, bm.lamp.y, 2.4 * (1 - k * 0.6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // 发端微辉（中继链）
        if (bm.kind === 0) {
          ctx.globalAlpha = 0.3 * env;
          ctx.drawImage(glowSprite(SILVER), sat.x - 7, sat.y - 7, 14, 14);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    /** 大圆（法向 S）可见段折线：z 剔除断笔（晨昏弧/幽灵弧共用几何） */
    function strokeGreatCircle(Sx: number, Sy: number, Sz: number, style: string, width: number, dash?: number[]) {
      const cl = Math.sqrt(Sx * Sx + Sy * Sy) || 1;
      const Ux = Sy / cl, Uy = -Sx / cl, Uz = 0; // normalize(S×ẑ)
      const Vx = Sy * Uz - Sz * Uy, Vy = Sz * Ux - Sx * Uz, Vz = Sx * Uy - Sy * Ux;
      const Rz2 = R * zoom;
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let k = 0; k <= 128; k++) {
        const t = (k / 128) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        const X = Ux * c + Vx * s, Y = Uy * c + Vy * s, Z = Uz * c + Vz * s;
        const z = X * Ex + Y * Ey + Z * Ez;
        if (z <= 0.02) {
          started = false;
          continue;
        }
        const x = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
        const y = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
      ctx.restore();
    }

    /** 晨昏弧（常驻主角）：带 + 线双层；拨盘/旋转时增强；boot 期用快进太阳；
     *  卫星模式下先铺墨衬（casing）——亮面墨衬、暗面银线，一盏灯照两边 */
    function drawTerminator(strong: number, sunOverride?: { Sx: number; Sy: number; Sz: number }) {
      const v = sunOverride ?? subsolarVecOf(Date.now());
      ctx.save();
      ctx.globalCompositeOperation = "screen"; // 大气族用 screen——lighter 会把冷银推成脏白
      if (glMode) {
        strokeGreatCircle(v.Sx, v.Sy, v.Sz, "rgba(7, 9, 14, 0.4)", 5.5);
        strokeGreatCircle(v.Sx, v.Sy, v.Sz, "rgba(7, 9, 14, 0.35)", 2.5);
      }
      strokeGreatCircle(v.Sx, v.Sy, v.Sz, rgba(SILVER, 0.06 + 0.06 * strong), 4);
      strokeGreatCircle(v.Sx, v.Sy, v.Sz, rgba(SILVER, 0.22 + 0.28 * strong), strong > 0 ? 1.25 : 1);
      ctx.restore();
    }

    /** 幽灵晨昏弧：假想时刻（displayMs）的虚线弧——表盘刻度的球面延伸，非光照，松手随弹簧合拢 */
    function drawGhostTerminator(dialStrong: number) {
      const awayMin = Math.abs(displayMs - nowMs) / 60000;
      if (dialStrong <= 0 || awayMin < 20) return; // 近「现在」两线重合，不出现防闪
      const fadeK = clamp((awayMin - 20) / 20, 0, 1);
      const v = subsolarVecOf(displayMs);
      if (glMode) strokeGreatCircle(v.Sx, v.Sy, v.Sz, "rgba(7, 9, 14, 0.4)", 2.75);
      strokeGreatCircle(v.Sx, v.Sy, v.Sz, `rgba(${PAPER}, ${(0.2 * dialStrong * fadeK).toFixed(3)})`, 1.25, [5, 4]);
      // 幽灵直射方位：一枚空心金圈（对照真金 tick）
      const Rz2 = R * zoom;
      const gx = cx + Rz2 * (v.Sx * Rx + v.Sy * Ry + v.Sz * Rz);
      const gy = cy - Rz2 * (v.Sx * Nx + v.Sy * Ny + v.Sz * Nz);
      const a = Math.atan2(gy - cy, gx - cx);
      const c = Math.cos(a), s = Math.sin(a);
      ctx.strokeStyle = rgba(GOLD, 0.45 * dialStrong * fadeK);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx + (R * zoom + 6.5) * c, cy + (R * zoom + 6.5) * s, 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    /** 经线可见段折线（正午日带 / 扫经读针 / boot 扫掠带共用）；front=true 只画正面，back=true 以虚线穿球 */
    function strokeMeridian(lonDeg: number, style: string, width: number, opts?: { dash?: number[]; back?: boolean; gate?: number }) {
      const λ = lonDeg * RAD;
      const cλ = Math.cos(λ), sλ = Math.sin(λ);
      const gate = opts?.gate ?? 0.05;
      const Rz2 = R * zoom;
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      if (opts?.dash) ctx.setLineDash(opts.dash);
      // 正面段
      if (!opts?.back) {
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 48; k++) {
          const φ = (k / 48 - 0.5) * Math.PI;
          const cφ = Math.cos(φ);
          const X = cφ * cλ, Y = cφ * sλ, Z = Math.sin(φ);
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z <= gate) {
            started = false;
            continue;
          }
          const x = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
          const y = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // 背面段：虚线穿墨球（读针的「针穿」语言）
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 48; k++) {
          const φ = (k / 48 - 0.5) * Math.PI;
          const cφ = Math.cos(φ);
          const X = cφ * cλ, Y = cφ * sλ, Z = Math.sin(φ);
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z > -gate) {
            started = false;
            continue;
          }
          const x = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
          const y = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (opts?.dash) ctx.setLineDash([]);
      ctx.restore();
    }

    /** 正午经线日带（直射经线，screen 两笔；z 门控防地平线加法爆白） */
    function drawNoonMeridian(strong: number) {
      const lon = subsolarLon(Date.now());
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      strokeMeridian(lon, rgba(SILVER, 0.05 + 0.03 * strong), Math.max(6, R * zoom * 0.12), { gate: 0.12 });
      strokeMeridian(lon, rgba(SILVER, 0.11 + 0.07 * strong), 1.25, { gate: 0.05 });
      ctx.restore();
    }

    /** 扫经读针：刻度盘指针所在经度贯穿球体——前实后虚，针穿墨球 */
    function drawSweepNeedle(dialStrong: number) {
      if (dialStrong <= 0 || !sweepLamp) return;
      const d = new Date(displayMs);
      const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
      const lonPtr = (utcMin / 1440) * 360 - 180;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      if (glMode) {
        strokeMeridian(lonPtr, "rgba(7, 9, 14, 0.4)", Math.max(6.5, R * zoom * 0.1 + 1.5), { gate: 0.12 });
        strokeMeridian(lonPtr, "rgba(7, 9, 14, 0.35)", 2.5, { gate: 0.05 });
      }
      strokeMeridian(lonPtr, rgba(SILVER, 0.045 * dialStrong), Math.max(5, R * zoom * 0.1), { gate: 0.12 });
      strokeMeridian(lonPtr, rgba(SILVER, 0.14 * dialStrong), 1, { gate: 0.04 });
      strokeMeridian(lonPtr, rgba(SILVER, 0.05 * dialStrong), 1, { dash: [3, 4], back: true, gate: 0.04 });
      ctx.restore();
    }

    /** 夜半球压暗：直射点→对日点线性渐变（半球域，画在地形后、城市灯前——暖尘坐上暗地） */
    function drawNightShade(v: { Sx: number; Sy: number; Sz: number }, settleK: number) {
      const Rz2 = R * zoom;
      const sx = cx + Rz2 * (v.Sx * Rx + v.Sy * Ry + v.Sz * Rz);
      const sy = cy - Rz2 * (v.Sx * Nx + v.Sy * Ny + v.Sz * Nz);
      const ax = 2 * cx - sx;
      const ay = 2 * cy - sy;
      const g = ctx.createLinearGradient(sx, sy, ax, ay);
      g.addColorStop(0, "rgba(3, 5, 9, 0)");
      g.addColorStop(0.55, "rgba(3, 5, 9, 0.08)");
      g.addColorStop(1, `rgba(3, 5, 9, ${(0.3 * settleK).toFixed(3)})`);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Rz2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    /** 日照侧 rim 光 + 冲日环（screen；(P·S)⁷ 只亮受光边，夜半球朝人时无 rim——夜让给灯） */
    function drawRim(v: { Sx: number; Sy: number; Sz: number }) {
      const Rz2 = R * zoom;
      const opp = Math.max(0, v.Sx * Ex + v.Sy * Ey + v.Sz * Ez); // 直射点与视中心夹角余弦
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      // rim：轮廓 128 段，每段 alpha = 0.28·max(0,P·S)⁷
      ctx.lineWidth = 2;
      let ppx = 0, ppy = 0, pvalid = false;
      for (let k = 0; k <= 128; k++) {
        const t = (k / 128) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        const X = c * Rx + s * Nx, Y = c * Ry + s * Ny, Z = c * Rz + s * Nz; // 轮廓点 = Rt/N 平面上的单位圆（Rz 为基向量）
        const x = cx + Rz2 * c;
        const y = cy - Rz2 * s;
        const a = 0.28 * Math.pow(Math.max(0, X * v.Sx + Y * v.Sy + Z * v.Sz), 7);
        if (pvalid && a > 0.004) {
          ctx.strokeStyle = rgba(SILVER, a);
          ctx.beginPath();
          ctx.moveTo(ppx, ppy);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ppx = x;
        ppy = y;
        pvalid = true;
      }
      // 冲日环：直射点对准视中心时整圈细亮边
      if (opp > 0.55) {
        const a2 = 0.1 * Math.pow(opp, 3);
        ctx.strokeStyle = rgba(SILVER, a2);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, Rz2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 赤道海光环（世界空间中低纬微亮带，screen；「大陆浮起」的海面衬层） */
    function drawEquatorBand() {
      const Rz2 = R * zoom;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const [w, a] of [
        [Rz2 * 0.95, 0.02],
        [Rz2 * 0.55, 0.03],
      ] as Array<[number, number]>) {
        ctx.strokeStyle = `rgba(${INKPAPER}, ${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 96; k++) {
          const λ = (k / 96) * Math.PI * 2 - Math.PI;
          const X = Math.cos(λ), Y = Math.sin(λ), Z = 0;
          const z = X * Ex + Y * Ey + Z * Ez;
          if (z <= 0.05) {
            started = false;
            continue;
          }
          const x = cx + Rz2 * (X * Rx + Y * Ry);
          const y = cy - Rz2 * (X * Nx + Y * Ny);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 昼半球宣纸高光（点阵模式）+ 界圆金 tick（环即钟面：直射方位角，两种模式都画） */
    function drawSunAccent(subsolarVec: { Sx: number; Sy: number; Sz: number }, strong: number, glOnFlag?: boolean) {
      const { Sx, Sy, Sz } = subsolarVec;
      const Rz2 = R * zoom;
      const z = Sx * Ex + Sy * Ey + Sz * Ez;
      const x = cx + Rz2 * (Sx * Rx + Sy * Ry + Sz * Rz);
      const y = cy - Rz2 * (Sx * Nx + Sy * Ny + Sz * Nz);
      // 卫星模式下 shader 已真实受光——宣纸高光会给照片浇乳白雾，跳过（只留金 tick）
      if (z > 0.02 && !glOnFlag) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Rz2, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalCompositeOperation = "screen";
        const rad = Rz2 * 0.9;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${PAPER}, ${(0.14 + 0.06 * strong).toFixed(3)})`); // 宣纸受光的暖白（昼半球的内容本身）
        g.addColorStop(0.55, `rgba(${PAPER}, ${(0.05 + 0.025 * strong).toFixed(3)})`);
        g.addColorStop(1, `rgba(${PAPER}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        ctx.restore();
      }
      // 金 tick：指向直射方位（即使直射点在背面，方位仍成立）；随 zoom 外扩贴住球缘
      const a = Math.atan2(y - cy, x - cx);
      const c = Math.cos(a), s = Math.sin(a);
      const gR = R * zoom;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(GOLD, 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + (gR + 3) * c, cy + (gR + 3) * s);
      ctx.lineTo(cx + (gR + 10) * c, cy + (gR + 10) * s);
      ctx.stroke();
      ctx.fillStyle = rgba(GOLD, 0.25);
      ctx.beginPath();
      ctx.arc(cx + (gR + 6.5) * c, cy + (gR + 6.5) * s, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /** 灯：投影 + 三色辉光精灵（透视衰减）+ 芯点 + 焦点环 */
    function drawLamp(l: (typeof lamps)[number], bootK: number) {
      const X = l.vx, Y = l.vy, Z = l.vz;
      const z = X * Ex + Y * Ey + Z * Ez;
      l.z = z;
      if (z <= 0.02) return; // 背面：灯辉/芯片/命中全部退场
      const Rz2 = R * zoom;
      l.x = cx + Rz2 * (X * Rx + Y * Ry + Z * Rz);
      l.y = cy - Rz2 * (X * Nx + Y * Ny + Z * Nz);
      const i = l.cur;
      if (i <= 0.02 && l.state === "CLOSED") return;
      const sig = signalsRef.current[l.exch.mic];
      const pct = sig && Number.isFinite(sig.changePct) ? (sig.changePct as number) : null;
      let color: [number, number, number];
      if (l.state === "PRE") color = SILVER;
      else if (pct !== null && pct > 0.005) color = CINNABAR;
      else if (pct !== null && pct < -0.005) color = SILVER;
      else color = GOLD;
      const isSilver = color === SILVER;
      const amp = l.state === "OPEN" && pct !== null ? 1 + clamp(Math.abs(pct) / 2.5, 0, 1) * 0.6 : 1;
      const bloom = l.bloomT > 0 ? 1 - l.bloomT / 0.6 : 0;
      const breath = l.breathT > 0 ? Math.sin(((0.8 - l.breathT) / 0.8) * Math.PI) * 0.25 : 0;
      l.breathK = breath;
      const face = l.faceT > 0 ? Math.sin((l.faceT / 0.45) * Math.PI) : 0; // 迎面点亮：转到正面的一次性灌光
      const collapse = l.collapseT > 0 ? 1 - l.collapseT / 0.3 : 0;
      const persp = 0.65 + 0.35 * z; // 透视：边缘灯辉收缩
      const baseR = clamp(R * 0.1, 11, 26) * (color === CINNABAR ? 1.12 : 1); // 朱红视知觉偏暗，半径补偿
      if (i > 0.05) {
        const rr = baseR * (1 + bloom * 0.9 + breath * 1.4 + face * 0.55) * persp;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = clamp(((isSilver ? 0.3 : 0.38) * i + bloom * 0.3 + breath * 0.6 + face * 0.35) * amp * z, 0, 1) * bootK;
        ctx.drawImage(glowSprite(color), l.x - rr, l.y - rr, rr * 2, rr * 2);
        ctx.restore();
      }
      if (bloom > 0) {
        ctx.strokeStyle = rgba(color, 0.7 * (1 - bloom));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(l.x, l.y, baseR * 0.5 + bloom * baseR * 2.0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (collapse > 0) {
        // 收灯：收缩环（开是点亮，闭是收灯——一对方向相反的墨动作）
        ctx.strokeStyle = rgba(SILVER, 0.35 * (1 - collapse));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(l.x, l.y, baseR * (1.5 - collapse * 1.0), 0, Math.PI * 2);
        ctx.stroke();
      }
      const core = (2.2 + 1.3 * i) * (0.7 + 0.3 * z);
      if (glMode) {
        // 墨晕垫底：亮色卫星影像上 CLOSED 白芯与辉光靠色——先坐一枚墨晕再点芯
        ctx.fillStyle = "rgba(5, 8, 14, 0.4)";
        ctx.beginPath();
        ctx.arc(l.x, l.y, core * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (l.state === "CLOSED") {
        ctx.fillStyle =
          pct !== null && pct > 0
            ? rgba(CINNABAR, 0.2 + 0.2 * i)
            : pct !== null && pct < 0
              ? rgba(SILVER, 0.22 + 0.18 * i)
              : "rgba(255, 255, 255, 0.2)";
      } else {
        ctx.fillStyle = rgba(color, (isSilver ? 0.35 : 0.55) + 0.45 * i);
      }
      ctx.beginPath();
      ctx.arc(l.x, l.y, core, 0, Math.PI * 2);
      ctx.fill();
      if (l.state === "OPEN" && i > 0.7) {
        ctx.fillStyle = `rgba(255, 244, 224, ${(((i - 0.7) / 0.3) * 0.8 * z).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(l.x, l.y, core * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      const isFocus = l === hoverLamp || l.exch.mic === selectedMicRef.current || l === sweepLamp || face > 0.05;
      if (isFocus) {
        ctx.strokeStyle = rgba(SILVER, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(l.x, l.y, clamp(R * 0.058, 6, 13) * (1 + face * 0.35), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /** 芯片就近布局：标签贴着灯点（八向候选 + 优先级抢占 + 下推避让）——地图注记的经典做法。
     * 偏移是屏幕像素级：放大后标签天然贴点不出屏（取代外挂轨道——长引线不雅且 zoom 大时出屏）。
     * 防打架：焦点 > 大所 > 开市 > 其余的优先级排序，先到先得好位，后到者八向试探，
     * 全撞则向下找空档；间距阈值 4px 视觉不贴脸。 */
    function layoutChips(rotFast: boolean) {
      const desktopFull = W >= 900; // 桌面前半球全员（27 所正面约 14-15 枚）
      const narrow = W < 640;
      const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
      const items = lamps
        .filter((l) => {
          if (l.z <= 0.15) {
            l.chipOn = false;
            return false;
          }
          const focus = l === hoverLamp || l.exch.mic === selectedMicRef.current || l === sweepLamp;
          const open = l.state === "OPEN" || l.state === "BREAK";
          const on = rotFast
            ? MAJOR_SET.has(l.exch.mic) || focus
            : desktopFull
              ? true
              : narrow
                ? zoom >= 1.4 || MAJOR_SET.has(l.exch.mic) || open || focus // 窄屏放大唤回次要芯片（与中带宽同款逃生门）
                : zoom >= 1.4 || MAJOR_SET.has(l.exch.mic) || open || focus;
          l.chipOn = on;
          return on;
        })
        .sort((a, b) => {
          const pri = (l: typeof a) =>
            (l === hoverLamp || l.exch.mic === selectedMicRef.current || l === sweepLamp ? 4 : 0) +
            (MAJOR_SET.has(l.exch.mic) ? 2 : 0) +
            (l.state === "OPEN" || l.state === "BREAK" ? 1 : 0);
          return pri(b) - pri(a) || a.x - b.x;
        });
      const hit = (x: number, y: number, w: number, h: number) =>
        placed.some((p) => x < p.x1 + 4 && x + w > p.x0 - 4 && y < p.y1 + 3 && y + h > p.y0 - 3);
      const gap = 7 + clamp(R * zoom * 0.02, 0, 8); // 点芯到芯片留白（微随比例）
      for (const l of items) {
        const candidates: Array<[number, number]> = [
          [gap, -gap - l.chipH], // 右上
          [-gap - l.chipW, -gap - l.chipH], // 左上
          [gap, gap], // 右下
          [-gap - l.chipW, gap], // 左下
          [gap, -l.chipH / 2], // 右
          [-gap - l.chipW, -l.chipH / 2], // 左
          [-l.chipW / 2, -gap - l.chipH], // 上
          [-l.chipW / 2, gap], // 下
        ];
        let bx = 0;
        let by = 0;
        let ok = false;
        for (const [ox, oy] of candidates) {
          const x = clamp(l.x + ox, 2, Math.max(2, W - l.chipW - 2));
          const y = clamp(l.y + oy, 2, Math.max(2, H - l.chipH - 2));
          if (!hit(x, y, l.chipW, l.chipH)) {
            bx = x;
            by = y;
            ok = true;
            break;
          }
        }
        if (!ok) {
          // 八向全撞：沿右下方向找空档（最多 12 步）
          const x = clamp(l.x + gap, 2, Math.max(2, W - l.chipW - 2));
          let y = clamp(l.y + gap, 2, Math.max(2, H - l.chipH - 2));
          for (let k = 0; k < 12 && !ok; k++) {
            if (!hit(x, y, l.chipW, l.chipH)) {
              bx = x;
              by = y;
              ok = true;
            }
            y = clamp(y + l.chipH + 4, 2, Math.max(2, H - l.chipH - 2));
          }
        }
        if (!ok) {
          // 兜底：允许与既有芯片重叠（27 枚内极少走到）
          bx = clamp(l.x + gap, 2, Math.max(2, W - l.chipW - 2));
          by = clamp(l.y + gap, 2, Math.max(2, H - l.chipH - 2));
        }
        l.chipX = bx;
        l.chipY = by;
        l.chipSide = 1;
        placed.push({ x0: bx, y0: by, x1: bx + l.chipW, y1: by + l.chipH });
      }
    }

    function drawChips(bootK: number) {
      for (const l of lamps) {
        if (!l.chipOn || !l.chipBmp) continue;
        const fk = l.faceT > 0 ? Math.sin((l.faceT / 0.45) * Math.PI) : 0;
        const focus = l === hoverLamp || l.exch.mic === selectedMicRef.current || l === sweepLamp || fk > 0.05;
        const bodyA =
          (0.45 + 0.55 * clamp(l.cur, 0, 1)) * smoothstep(0.15, 0.35, l.z) * bootK * l.chipA * (1 + l.breathK * 0.48 + fk * 0.4);
        if (bodyA <= 0.03) continue;
        // 就近短引线：灯点 → 芯片近边的小连笔（点到边的自然连线，不再有长直线）
        const ex = clamp(l.x, l.chipX + 4, l.chipX + l.chipW - 4);
        const ey = l.y <= l.chipY ? l.chipY : l.chipY + l.chipH;
        if (glMode) {
          ctx.strokeStyle = "rgba(7, 9, 14, 0.32)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(l.x, l.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        ctx.strokeStyle = focus ? "rgba(190, 205, 225, 0.5)" : "rgba(190, 205, 225, 0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // 卫星模式常垫墨底：亮色影像上的可读性（不只是焦点态）
        if (glMode || focus) {
          ctx.fillStyle = focus ? "rgba(8, 12, 20, 0.78)" : "rgba(8, 12, 20, 0.5)";
          ctx.fillRect(l.chipX - 2, l.chipY - 2, l.chipW + 4, l.chipH + 4);
          ctx.strokeStyle = "rgba(190, 205, 225, 0.55)";
          ctx.strokeRect(l.chipX - 2.5, l.chipY - 2.5, l.chipW + 5, l.chipH + 5);
        }
        ctx.save();
        ctx.globalAlpha = bodyA;
        ctx.drawImage(l.chipBmp, l.chipX, l.chipY, l.chipW, l.chipH);
        ctx.restore();
      }
    }

    /** 悬停金晕（手电照玉，clip 圆内） */
    function drawSpecular() {
      const Rz2 = R * zoom;
      const rad = clamp(R * 0.35, 80, 170);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Rz2, 0, Math.PI * 2);
      ctx.clip();
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, rgba(GOLD, 0.1));
      g.addColorStop(0.55, rgba(GOLD, 0.035));
      g.addColorStop(1, rgba(GOLD, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      ctx.restore();
    }

    /* ---- 命中：角度拾取（背面不命中）+ 芯片矩形 ---- */
    function lampAt(x: number, y: number) {
      const hitR = Math.max(13, R * zoom * 0.05);
      let best: (typeof lamps)[number] | null = null;
      let bestD = hitR;
      for (const l of lamps) {
        if (l.z <= 0.02) continue;
        const d = Math.hypot(l.x - x, l.y - y);
        if (d <= bestD) {
          bestD = d;
          best = l;
        }
      }
      return best;
    }
    function chipAt(x: number, y: number) {
      for (const l of lamps) {
        if (!l.chipOn) continue;
        if (x >= l.chipX - 3 && x <= l.chipX + l.chipW + 3 && y >= l.chipY - 3 && y <= l.chipY + l.chipH + 3) return l;
      }
      return null;
    }

    /* ---- 刻度盘拨时（唯一时间入口；球不随拨动转） ---- */
    function beginDialScrub(x: number) {
      dialDragging = true;
      live = false;
      springT = -1;
      dragAnchorX = x;
      dragAnchorMs = displayMs;
      setScrubbing(true);
      const tip = tipRef.current;
      if (tip) tip.style.opacity = "0";
      ensureLoop();
    }
    function applyDialDelta(xNow: number, speed: number) {
      if (!dialDragging) return;
      const dHours = ((xNow - dragAnchorX) / Math.max(W, 1)) * 24 * speed;
      displayMs = dragAnchorMs + dHours * 3600_000;
      if (!Number.isFinite(displayMs)) displayMs = nowMs;
      reevaluate(clamp(displayMs, nowMs - SCRUB_RANGE_MS, nowMs + SCRUB_RANGE_MS));
      ensureLoop();
    }
    function endDialScrub() {
      if (!dialDragging) return;
      dialDragging = false;
      springFrom = displayMs;
      springT = 0; // is-scrubbing 由弹簧终帧摘除
      ensureLoop();
    }
    /** 盘上扫描读出：指针时刻对应经度 → 最近交易所（时间手势的伴读） */
    function computeSweep() {
      if (!(dialDragging || springT >= 0 || !live)) return null;
      const d = new Date(displayMs);
      const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
      const lonPtr = (utcMin / 1440) * 360 - 180;
      let best: (typeof lamps)[number] | null = null;
      let bestD = 1e9;
      for (const l of lamps) {
        const dd = Math.abs((((l.exch.lon - lonPtr + 540) % 360) + 360) % 360 - 180);
        if (dd < bestD) {
          bestD = dd;
          best = l;
        }
      }
      return best;
    }

    /* ---- 此面滚动信息带：正面半球交易所按屏左→右（视角/信号变化才重建） ----
     * 四修：①定速不定时（scrollWidth/2 ÷ 38px/s，钳 18-70s）②空态占位不停跑马
     * ③旋转中冻结（转动看球不看带，停稳一次性呈现）④DOM 构建杀注入面；
     * 附：核心正面（z>迎面阈）条目名字下加金线——带=宽正面（此面），金线=正对 */
    const faceThresh = () => 0.78 + 0.1 * (zoom - 1); // zoom 放大后核心区顶出视口的补偿
    let tickerSig = "";
    function updateTicker() {
      const el = tickerTrackRef.current;
      if (!el) return;
      if (rotDrag || Math.abs(velYaw) > 2) return; // 旋转中冻结，停稳后下一帧重建
      const facing = lamps.filter((l) => l.z > 0.35).sort((a, b) => a.x - b.x);
      const sig = facing
        .map((l) => {
          const s = signalsRef.current[l.exch.mic];
          const pct = s && Number.isFinite(s.changePct) ? (s.changePct as number) : null;
          return `${l.exch.mic}:${l.state}:${pct === null ? "-" : pct.toFixed(2)}:${l.z > faceThresh() ? "F" : ""}`;
        })
        .join(",");
      if (sig === tickerSig) return;
      tickerSig = sig;
      el.textContent = "";
      const wrap = tickerTrackRef.current?.parentElement;
      if (facing.length === 0) {
        // 空态：正对皆洋——静态占位，不跑马（is-empty 停动画）
        const span = document.createElement("span");
        span.className = "atlas-ticker-item is-empty";
        span.textContent = "此面皆洋 · 转动地球寻灯";
        el.appendChild(span);
        el.classList.add("is-empty");
        if (wrap) wrap.classList.add("is-empty");
        return;
      }
      el.classList.remove("is-empty");
      if (wrap) wrap.classList.remove("is-empty");
      const frag = document.createDocumentFragment();
      const mkItem = (l: (typeof lamps)[number]) => {
        const s = signalsRef.current[l.exch.mic];
        const pct = s && Number.isFinite(s.changePct) ? (s.changePct as number) : null;
        const span = document.createElement("span");
        span.className =
          "atlas-ticker-item" +
          (pct === null ? "" : pct > 0.005 ? " tk-up" : pct < -0.005 ? " tk-down" : "") +
          (l.z > faceThresh() ? " tk-face" : "");
        if (l.cc) {
          const uri = flagUri(l.cc);
          if (uri) {
            const img = document.createElement("img");
            img.className = "atlas-ticker-flag";
            img.src = uri;
            img.alt = "";
            span.appendChild(img);
          }
        }
        const b = document.createElement("b");
        b.textContent = l.exch.zh;
        span.appendChild(b);
        span.appendChild(document.createTextNode(` ${STATE_ZH[l.state]}${pct === null ? "" : ` ${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}`));
        return span;
      };
      const oneSet = facing.map(mkItem);
      // 复制到 ≥2× 视口宽，循环里不留空窗；双份起步保证无缝
      let copies = 2;
      for (const it of oneSet) frag.appendChild(it);
      while (copies < 6 && el.scrollWidth < window.innerWidth * 2) {
        for (const it of oneSet) frag.appendChild(it.cloneNode(true));
        copies++;
      }
      el.appendChild(frag);
      // 定速：38px/s 线速度，时长 = 单份宽/速度，钳 18-70s
      const oneW = Math.max(1, el.scrollWidth / copies);
      const dur = clamp(oneW / 38, 18, 70);
      el.style.animationDuration = `${dur.toFixed(1)}s`;
    }

    let last = performance.now();
    let prevFrameP = 0;
    function loop(nowP: number) {
      if (disposed) return;
      const rawMs = prevFrameP ? nowP - prevFrameP : 16;
      prevFrameP = nowP;
      /* FPS 安全阀（v4.14）：boot 后采样 EMA 帧时长，>22ms 持续 3s → 一次性降档（非英雄模型退符号点，永不回升） */
      if (bootDone && rawMs > 4 && rawMs < 400) {
        fpsEmaMs += (rawMs - fpsEmaMs) * 0.05;
        if (fpsEmaMs > 22) {
          if (!fpsBadSince) fpsBadSince = nowP;
          else if (nowP - fpsBadSince > 3000) {
            if (!narrowModelsOff) narrowModelsOff = true;
            else meshDegrade = true; // 二级降档：网骨架 k→1
          }
        } else fpsBadSince = 0;
      }
      const dt = Math.min(0.05, (nowP - last) / 1000);
      const dtRaw = Math.min(1, (nowP - last) / 1000); // 自转/飞行按真实时间积分：节流环境下不减速
      last = nowP;
      if (W < 50 || H < 50 || R < 8) {
        running = false; // 零尺寸（隐藏/未布局）：停帧，resize 会重启
        return;
      }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (!bootDone) {
        bootT += dt;
        if (bootT >= BOOT_SEC) bootDone = true;
      }

      /* 时间轴：dial 弹回 */
      let dialStrong = 0;
      if (dialDragging) {
        displayMs = clamp(displayMs, nowMs - SCRUB_RANGE_MS, nowMs + SCRUB_RANGE_MS);
        dialStrong = 1;
      } else if (springT >= 0) {
        springT += dt;
        const p = clamp(springT / SPRING_SEC, 0, 1);
        displayMs = springFrom + (nowMs - springFrom) * (reduced ? 1 : easeInOut(p));
        dialStrong = 1 - p;
        reevaluate(displayMs); // 弹回逐帧翻转：27 灯按假想时刻渐次回真，末尾不再集体爆闪
        if (p >= 1) {
          springT = -1;
          live = true;
          nowMs = Date.now();
          displayMs = nowMs;
          reevaluate(nowMs);
          scheduleBoundary();
          setScrubbing(false); // is-scrubbing 在弹簧终帧摘除（松手瞬间摘会让 0.9s 回真期假装置身事外）
        }
      } else if (live) {
        nowMs = Date.now();
        displayMs = nowMs;
      } else {
        dialStrong = 0.6; // 键盘拨时等假想驻留态：读针/幽灵弧以中强度登场
      }
      if (!Number.isFinite(displayMs)) displayMs = nowMs;

      /* 行星自转：常帧推进（交互即停缓入恢复；宪法由用户修正案授权） */
      const spinTarget = spinActive() ? 360 / SPIN_PERIOD_S : 0;
      spinRate += (spinTarget - spinRate) * (1 - Math.exp(-dtRaw * 2.2)); // ~0.45s 缓入缓出
      if (Math.abs(spinRate) > 0.005) {
        const dSpin = spinRate * dtRaw;
        spinAngle = (spinAngle + dSpin) % 360;
        simMs += dSpin * 240000; // 360° 自转 = 86400000ms 一天：卫星同钟快进（GEO 因此锚定经度）
      }

      /* 视角复原飞行：静默达到阈值 → 优雅飞回家；任意输入即刻打断 */
      if (flight) {
        flight.t += dtRaw;
        const p = easeInOut(clamp(flight.t / FLIGHT_SEC, 0, 1));
        yaw = flight.yaw0 + flight.yaw1 * p;
        pitch = flight.pitch0 + (flight.pitch1 - flight.pitch0) * p;
        zoom = flight.zoom0 + (flight.zoom1 - flight.zoom0) * p;
        if (flight.t >= FLIGHT_SEC) {
          flight = null;
          bumpIdle(); // 重新武装（已在家则下次为零位移，幂等）
        }
      } else if (
        restoreAt > 0 &&
        performance.now() >= restoreAt &&
        !rotDrag &&
        !dialDragging &&
        pointers.size === 0 &&
        springT < 0
      ) {
        // 最短弧回家（yaw 展开到 ±180 邻域）
        let dy = ((HOME_TZ_LON - yaw + 540) % 360) - 180;
        if (Math.abs(dy) > 0.5 || Math.abs(pitch - HOME_LAT) > 0.5 || Math.abs(zoom - 1) > 0.01) {
          flight = { t: 0, yaw0: yaw, yaw1: dy, pitch0: pitch, pitch1: HOME_LAT, zoom0: zoom, zoom1: 1 };
          spinResumeAt = performance.now() + FLIGHT_SEC * 1000 + SPIN_RESUME_MS; // 飞行期间自转缓行
        }
        restoreAt = 0;
      }

      /* 惯性（yaw only；静止窗/低速/6τ 三重收尾） */
      let rotating = false;
      if (!rotDrag && velYaw !== 0) {
        yaw += velYaw * dt;
        velYaw *= Math.exp(-dt / INERTIA_TAU);
        inertiaT += dt;
        if (Math.abs(velYaw) < 2 || inertiaT > INERTIA_TAU * 6) {
          velYaw = 0;
          // 停稳点亮：快甩被门控的迎面灌光在此补齐——按离视心的水平距离错峰 0-150ms
          const Rzq = R * zoom;
          for (const l of lamps) {
            if (l.z > faceThresh() && l.faceT <= 0) {
              l.faceT = 0.45;
              l.faceDelay = Math.round((Math.abs(l.x - cx) / Math.max(1, Rzq)) * 150);
            }
          }
        }
        rotating = Math.abs(velYaw) > 1;
      }
      const rotFast = rotDrag || rotating;
      // 降档判据：惯性速度 + 拖拽中的实时角速度（rotSamples 现成，拖拽期 velYaw 恒 0 的老漏洞）
      let dragAngSpeed = 0;
      if (rotDrag && rotSamples.length >= 2) {
        const a = rotSamples[0];
        const b = rotSamples[rotSamples.length - 1];
        const span = (b.t - a.t) / 1000;
        if (span > 0.01) dragAngSpeed = Math.abs((b.yaw - a.yaw) / span);
      }
      const angSpeed = Math.max(Math.abs(velYaw), dragAngSpeed);
      const fastThreshold = 40; // deg/s 以上进入降档
      const degrade = rotFast && angSpeed > fastThreshold;

      frameBasis();
      const bf = bootFactors();
      const bootK = reduced ? 1 : clamp(bootT / BOOT_SEC + 0.15, 0, 1);

      /* 球体本体：卫星纹理球（WebGL）优先；失败回退点阵水墨球（2D 全套保留） */
      const isGL = glOn();
      glMode = isGL;
      const realSun = subsolarVecOf(Date.now());
      const strong2 = Math.max(dialStrong, rotFast ? 0.55 : 0); // 旋转时晨昏弧也增强
      const cityK = bootDone ? 1 : 0.25 + 0.75 * bf.settleP + 0.09 * Math.sin(bf.settleP * Math.PI);
      // boot 期把太阳经度从晨昏起点快进到真实位置——「快进一个昼夜」被字面演出
      let sunVec = realSun;
      if (!bootDone && bf.sweepP < 1) {
        const φ = (1 - bf.sweepP) * Math.PI * 2;
        const cφ = Math.cos(φ);
        const sφ = Math.sin(φ);
        sunVec = { Sx: cφ * realSun.Sx - sφ * realSun.Sy, Sy: sφ * realSun.Sx + cφ * realSun.Sy, Sz: realSun.Sz };
      }
      if (isGL && glr) {
        // GL 球亮度独立快升（circle 相位 0.46s 内 0→1），昼夜快进交给太阳经度，两轴分离
        const glK = reduced || bootDone ? 1 : 1 - Math.pow(1 - clamp(bootT / 0.46, 0, 1), 3);
        glr.render({ W, H, DPR, cx, cy, R: R * zoom, Ex, Ey, Ez, Nx, Ny, Nz, Rx, Ry, Rz, Sx: sunVec.Sx, Sy: sunVec.Sy, Sz: sunVec.Sz, k: glK, nightK: cityK });
        // 2D 补画刻度环（sphereSprite 只在回退分支绘制，GL 下不补则金 tick 悬空）
        drawTickRing((x0, y0, x1, y1, major) => {
          ctx.strokeStyle = `rgba(${INKPAPER}, ${major ? 0.5 : 0.26})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + x0, cy + y0);
          ctx.lineTo(cx + x1, cy + y1);
          ctx.stroke();
        }, zoom);
      } else if (sphereSprite) {
        const spW = (sphereSprite.width / DPR) * zoom; // 回退底盘随 zoom 同步（否则地形溢出墨玉盘）
        const spH = (sphereSprite.height / DPR) * zoom;
        if (reduced || bf.circleP >= 1) {
          ctx.drawImage(sphereSprite, cx - spW / 2, cy - spH / 2, spW, spH);
        } else {
          ctx.save();
          ctx.globalAlpha = bf.circleP;
          ctx.drawImage(sphereSprite, cx - spW / 2, cy - spH / 2, spW, spH);
          ctx.restore();
          // 落笔画圆：界圆从正上方起笔扫过 360°
          ctx.strokeStyle = `rgba(${INKPAPER}, ${(0.16 * bf.circleP).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, R * zoom, -Math.PI / 2, -Math.PI / 2 + bf.circleP * Math.PI * 2);
          ctx.stroke();
        }
      }

      drawStars(nowP); // 星野：最底装饰层（球外裁切）
      drawMeteors(dtRaw, sunVec); // 流星：球后裁切的栈底层
      drawGraticule(bf.circleP); // 卫星模式网格走墨衬（见 casing），不再压 alpha
      if (!isGL) {
        drawEquatorBand();
        paintTerrain(bf.circleP, bf.sweepP, bf.startLon);
        drawNightShade(sunVec, bootDone ? 1 : bf.settleP);
        const cityDegrade = degrade || W < 640;
        if (cityF && cityF.n > 0) {
          cityN = cityDegrade ? Math.min(cityF.n, CITY_DEGRADE_N) : cityF.n;
          // 光晕减数不熄灭：静止桌面 2000、旋转中 600、窄屏 350——转起来灯球不变素
          citySpriteN = W < 640 ? Math.min(350, cityN) : degrade ? Math.min(600, cityN) : Math.min(CITY_SPRITE_N, cityN);
        }
        if (citySprite === null) citySprite = makeCitySprite();
        computeCityLUT(Date.now()); // 光照只跟真实太阳（0.3ms/帧；静止帧也不重算——停帧即冻结）
        paintCities(cityK, degrade, bf.sweepP, bf.startLon);
      }

      // boot 扫掠带可见化：前沿亮线 + 8° 尾迹（快进一个昼夜被演出来）
      if (!bootDone && bf.sweepP > 0 && bf.sweepP < 1) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const frontLon = bf.startLon + bf.sweepP * 360;
        strokeMeridian(frontLon, rgba(SILVER, 0.45), 1.5, { gate: 0.02 });
        strokeMeridian(frontLon - 8, rgba(SILVER, 0.12), 1, { gate: 0.02 });
        ctx.restore();
      }

      drawTerminator(strong2, sunVec);
      drawGhostTerminator(dialStrong);
      if (!isGL) drawNoonMeridian(strong2); // 卫星图上 shader 已真实受光，日带=同件事画两遍
      drawSunAccent(isGL ? sunVec : realSun, strong2, isGL);
      if (!isGL) drawRim(realSun);
      drawOrbitBones(simMs); // 轨道弧常驻（真值织笼，卫星层下）
      drawSats(sunVec, simMs); // 真实卫星层（球上、大气族下、交易所灯之下）
      updateMesh(dt * 1000);
      drawMesh(); // 巨网骨架（事件层下、结构底衬）
      updateBeams(nowP);
      drawBeams(nowP); // 链路层（星间中继 + 过顶示意）：卫星与灯之上

      let alive = !bootDone || rotDrag || rotating || dialDragging || springT >= 0 || repaint || spinTarget > 0 || !!flight || meteorCount() > 0 || fxCount() > 0 || beams.length > 0;
      for (const l of lamps) {
        if (!bootDone && bootT < l.activeAt * BOOT_SEC) continue;
        if (!bootDone && !l.bootLit) {
          l.bootLit = true;
          l.bloomT = Math.max(l.bloomT, 0.25); // 扫掠带扫到时的点火小花（别用开盘的 0.6，抢戏）
        }
        l.cur += (l.target - l.cur) * (1 - Math.exp(-dt * 7));
        if (Math.abs(l.target - l.cur) > 0.004) alive = true;
        else l.cur = l.target;
        if (l.bloomT > 0) {
          l.bloomT -= dt;
          alive = true;
        }
        if (l.collapseT > 0) {
          l.collapseT -= dt;
          alive = true;
        }
        if (l.breathT > 0) {
          l.breathT -= dt;
          alive = true;
        }
        if (l.faceDelay > 0) {
          l.faceDelay -= dt * 1000; // 停稳点亮的错峰等待
          if (l.faceDelay <= 0) {
            l.faceDelay = 0;
            l.faceT = 0.45;
          }
          alive = true;
        }
        if (l.faceT > 0) {
          l.faceT -= dt;
          alive = true;
        }
        const chipTarget = l.chipOn ? 1 : 0;
        if (Math.abs(chipTarget - l.chipA) > 0.01) {
          l.chipA += (chipTarget - l.chipA) * (1 - Math.exp(-dt * 14)); // ~160ms 淡入防轨道跳列
          alive = true;
        } else l.chipA = chipTarget;
        drawLamp(l, bootK);
        // 迎面点亮：跨入正视区一次性灌光（NaN 哨兵防首帧集体爆闪；reduced 不灌光；
        // 角速度 >120°/s 不触发——快甩是导航不是审视，停稳由惯性终止处错峰补点）
        if (
          bootDone &&
          !reduced &&
          Math.abs(velYaw) < 120 &&
          Number.isFinite(l.prevZ) &&
          l.z > faceThresh() &&
          l.prevZ <= faceThresh() &&
          l.faceT <= 0
        ) {
          l.faceT = 0.45;
        }
        l.prevZ = l.z;
      }
      sweepLamp = computeSweep();
      layoutChips(degrade);
      drawChips(bootK);
      drawSweepNeedle(dialStrong);

      if (hoverLamp && finePtr && !rotDrag && !glMode && nowP - lastMoveAt < 400) {
        drawSpecular();
        alive = true;
      }

      sweepLamp = computeSweep();
      updateDial(dialStrong);
      updateTicker();

      if (alive) raf = requestAnimationFrame(loop);
      else {
        running = false; // 收敛帧已绘净，停帧保留静态图（静止帧即烘焙）
        repaint = false;
      }
    }

    function ensureLoop() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    /* ---- 指针：旋转 / 捏合 / 长按 / 双击回家 ---- */
    function killLongPress() {
      clearTimeout(longPressTimer);
      longPressLamp = null;
    }

    const onStagePointerDown = (e: PointerEvent) => {
      skipBoot();
      spinResumeAt = performance.now() + SPIN_RESUME_MS; // 交互即停自转
      cancelFlight();
      bumpIdle();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // 双指捏合：取消旋转与长按，快照起始距离
        rotDrag = false;
        killLongPress();
        const pts = Array.from(pointers.values());
        pinchDist0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        zoom0 = zoom;
        return;
      }
      velYaw = 0;
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const l = chipAt(x, y) ?? lampAt(x, y);
      if (l) {
        setSelectedMic(l.exch.mic);
        hoverLamp = null;
        if (!finePtr) {
          // 触屏长按 350ms → 浮签（移动端第一次获得读出）
          longPressLamp = l;
          longPressX = x;
          longPressY = y;
          longPressTimer = window.setTimeout(() => {
            if (disposed || !longPressLamp) return;
            const tip = tipRef.current;
            if (tip) {
              tip.textContent = `${longPressLamp.exch.zh} ${STATE_ZH[stateOf(longPressLamp, displayMs)]} · ${formatLocalTime(longPressLamp.exch.tz, new Date(displayMs))}`;
              tip.style.transform = `translate(${clamp(longPressX + 14, 4, Math.max(4, W - 150))}px, ${clamp(longPressY - 30, 4, Math.max(4, H - 24))}px)`;
              tip.style.opacity = "1";
            }
          }, 350);
        }
      } else {
        setSelectedMic(null);
        // 触屏 tap 选中卫星（keeptrack/satvis 惯例）：down 记候选，up 短距短时确认
        tapDownSat = { x, y, t: performance.now(), sat: satAt(x, y, 22) };
      }
      rotDrag = true;
      rotLastX = x;
      rotLastY = y;
      rotSamples = [];
      stage.setPointerCapture?.(e.pointerId);
      ensureLoop();
    };
    const onStagePointerMove = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
      lastMoveAt = performance.now();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        zoom = clamp(zoom0 * (d / pinchDist0), ZOOM_MIN, ZOOM_MAX);
        bumpIdle();
        ensureLoop();
        return;
      }
      if (rotDrag) {
        const dx = px - rotLastX;
        const dy = py - rotLastY;
        rotLastX = px;
        rotLastY = py;
        const Rz2 = Math.max(30, R * zoom);
        yaw -= (dx * 90) / Rz2; // 拖满半径 = 转 90°
        pitch = clamp(pitch + (dy * 90) / Rz2, -PITCH_CLAMP, PITCH_CLAMP);
        rotSamples.push({ t: performance.now(), yaw });
        if (rotSamples.length > 8) rotSamples.shift();
        bumpIdle(); // 主动旋转刷新复原阈值
        if (longPressLamp && Math.hypot(px - longPressX, py - longPressY) > 10) killLongPress();
        ensureLoop();
        return;
      }
      if (!finePtr) return;
      const l = chipAt(px, py) ?? lampAt(px, py);
      const sat = l ? null : satAt(px, py);
      hoverLamp = l;
      hoverSat = sat;
      stage.style.cursor = l || sat ? "pointer" : "grab";
      const tip = tipRef.current;
      if (tip) {
        if (sat && !l) {
          const tierZh = sat.el.tier === "leo" ? "近地" : sat.el.tier === "meo" ? "中距" : "静止轨道";
          const p = propagate(sat.el, simMs); // 高度与显示位置同钟（单钟律）
          tip.textContent = `${sat.el.zh || sat.name} · ${tierZh} · ${p ? Math.round(p.altKm) + "km" : ""} · 最近邻 ${Math.round(nearestNeighborKm(sat))}km · 示意模型 · TLE 历元 ${Math.max(0, Math.round((Date.now() - sat.el.epoch) / 86400000))} 天前 · 仪表时钟×${Math.round(86400 / SPIN_PERIOD_S)}`;
          const tx = clamp(px + 14, 4, Math.max(4, W - 150));
          const ty = clamp(py - 30, 4, Math.max(4, H - 24));
          tip.style.transform = `translate(${tx}px, ${ty}px)`;
          tip.style.opacity = "1";
        } else if (l) {
          tip.textContent = `${l.exch.zh} ${STATE_ZH[stateOf(l, displayMs)]} · ${formatLocalTime(l.exch.tz, new Date(displayMs))}`;
          const tx = clamp(px + 14, 4, Math.max(4, W - 150));
          const ty = clamp(py - 30, 4, Math.max(4, H - 24));
          tip.style.transform = `translate(${tx}px, ${ty}px)`;
          tip.style.opacity = "1";
        } else {
          tip.style.opacity = "0";
        }
      }
      ensureLoop();
    };
    const onStagePointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      stage.releasePointerCapture?.(e.pointerId);
      killLongPress();
      // 触屏 tap 选中卫星（keeptrack/satvis 惯例）：单指、位移<10px、<400ms → 实名 tip + 全弧 2.5s 驻留
      if (tapDownSat?.sat && pointers.size === 0) {
        const rect = stage.getBoundingClientRect();
        const d = Math.hypot(e.clientX - rect.left - tapDownSat.x, e.clientY - rect.top - tapDownSat.y);
        if (d < 10 && performance.now() - tapDownSat.t < 400) {
          const sat = tapDownSat.sat;
          hoverSat = sat;
          selectedSatUntil = performance.now() + 2500;
          const tip = tipRef.current;
          if (tip) {
            const tierZh = sat.el.tier === "leo" ? "近地" : sat.el.tier === "meo" ? "中距" : "静止轨道";
            const p = propagate(sat.el, simMs); // 高度与显示位置同钟（单钟律）
            tip.textContent = `${sat.el.zh || sat.name} · ${tierZh} · ${p ? Math.round(p.altKm) + "km" : ""} · 最近邻 ${Math.round(nearestNeighborKm(sat))}km · 示意模型 · TLE 历元 ${Math.max(0, Math.round((Date.now() - sat.el.epoch) / 86400000))} 天前 · 仪表时钟×${Math.round(86400 / SPIN_PERIOD_S)}`;
            tip.style.transform = `translate(${clamp(tapDownSat.x + 14, 4, Math.max(4, W - 150))}px, ${clamp(tapDownSat.y - 30, 4, Math.max(4, H - 24))}px)`;
            tip.style.opacity = "1";
          }
          window.setTimeout(() => {
            if (disposed) return;
            if (hoverSat === sat) {
              hoverSat = null;
              const t2 = tipRef.current;
              if (t2 && !finePtr) t2.style.opacity = "0";
            }
            repaint = true;
            ensureLoop();
          }, 2550);
          repaint = true;
          ensureLoop();
        }
      }
      tapDownSat = null;
      const tip = tipRef.current;
      if (tip && !finePtr && performance.now() > selectedSatUntil) tip.style.opacity = "0";
      if (pointers.size > 0) {
        // 从捏合回到单指：剩余手指接管旋转（锚点取留在屏上的那根，不是抬起的这根——
        // 两指相距 40-120px，用错锚下一帧 yaw 跳 30° 级）
        rotDrag = true;
        velYaw = 0;
        const remain = pointers.values().next().value;
        const rect2 = stage.getBoundingClientRect();
        rotLastX = remain ? remain.x - rect2.left : e.clientX - rect2.left;
        rotLastY = remain ? remain.y - rect2.top : e.clientY - rect2.top;
        rotSamples = [];
        return;
      }
      if (rotDrag) {
        rotDrag = false;
        // 松手静止窗：80ms 内无移动样本则不起惯性
        const now = performance.now();
        const recent = rotSamples.filter((s) => now - s.t <= RELEASE_STILL_MS);
        if (!reduced && recent.length >= 2) {
          const first = recent[0];
          const span = (now - first.t) / 1000;
          if (span > 0.01) {
            const v = (yaw - first.yaw) / span;
            velYaw = clamp(v, -360, 360);
            inertiaT = 0;
          }
        }
        ensureLoop();
      }
    };
    const onStageLeave = () => {
      hoverLamp = null;
      hoverSat = null;
      const tip = tipRef.current;
      if (tip) tip.style.opacity = "0";
    };
    const onDblClick = (e: MouseEvent) => {
      skipBoot();
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (chipAt(x, y) || lampAt(x, y)) return;
      // 回家：北上 + 用户时区中央经线 + 默认视距（空间归你，回家是显式动作）
      const tzOffsetMin = -new Date().getTimezoneOffset();
      yaw = Math.round((tzOffsetMin / 60) * 15);
      bumpIdle();
      pitch = HOME_LAT;
      zoom = 1;
      velYaw = 0;
      ensureLoop();
    };
    const onWheel = (e: WheelEvent) => {
      skipBoot();
      cancelFlight();
      bumpIdle();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
      ensureLoop();
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      skipBoot();
      if (e.key === "Escape") setSelectedMic(null);
    };

    /* 刻度盘指针事件（时间入口） */
    const onDialPointerDown = (e: PointerEvent) => {
      skipBoot();
      spinResumeAt = performance.now() + SPIN_RESUME_MS; // 拨时停转
      cancelFlight();
      bumpIdle();
      const dial = dialRef.current;
      if (!dial) return;
      dial.setPointerCapture?.(e.pointerId);
      const rect = dial.getBoundingClientRect();
      const xNorm = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
      beginDialScrub(xNorm);
    };
    const onDialPointerMove = (e: PointerEvent) => {
      if (!dialDragging) return;
      const dial = dialRef.current;
      if (!dial) return;
      const rect = dial.getBoundingClientRect();
      const xNorm = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
      applyDialDelta(xNorm, 2); // 刻度盘行程 ×2：细调更从容
      bumpIdle();
    };
    const onDialPointerUp = (e: PointerEvent) => {
      dialRef.current?.releasePointerCapture?.(e.pointerId);
      endDialScrub();
    };
    /** 盘键盘：←/→ ±30min（Shift ±4h），Esc 弹回；步进后 1.5s 空闲自动弹回——
     * 否则 live=false 永不回，幽灵弧/读针缺席、边界定时器把灯态拉回真值而指针停在假想时刻 */
    let keyIdleTimer = 0;
    const onDialKey = (e: KeyboardEvent) => {
      skipBoot();
      spinResumeAt = performance.now() + SPIN_RESUME_MS; // 键盘拨时停转
      cancelFlight();
      bumpIdle();
      if (e.key === "Escape") {
        setSelectedMic(null);
        clearTimeout(keyIdleTimer);
        if (dialDragging || springT >= 0 || !live) {
          springFrom = displayMs;
          springT = 0;
          live = false;
          ensureLoop();
        }
        return;
      }
      const step = e.shiftKey ? 4 * 3600_000 : 30 * 60_000;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        live = false;
        springT = -1;
        displayMs = clamp(displayMs + (e.key === "ArrowRight" ? step : -step), nowMs - SCRUB_RANGE_MS, nowMs + SCRUB_RANGE_MS);
        reevaluate(displayMs);
        setScrubbing(true);
        clearTimeout(keyIdleTimer);
        keyIdleTimer = window.setTimeout(() => {
          if (disposed) return;
          springFrom = displayMs;
          springT = 0;
          ensureLoop();
        }, 1500);
        ensureLoop();
      }
    };

    function skipBoot() {
      if (bootDone) return;
      bootDone = true;
      bootT = 1e9;
      for (const l of lamps) l.cur = l.target;
    }

    /* ---- 实时调度：下一全局边界 + 60s 晨昏步进 + 可见性门控 ---- */
    let boundaryTimer = 0;
    let safetyTimer = 0;
    function scheduleBoundary() {
      clearTimeout(boundaryTimer);
      let t = nowMs + 60_000;
      for (const l of lamps) {
        const b = nextBoundaryAfter(l.exch, nowMs);
        if (b < t) t = b;
      }
      boundaryTimer = window.setTimeout(
        () => {
          if (disposed) return;
          nowMs = Date.now();
          // 假想驻留（拨动/键盘步进）期间不把灯态拉回真值——灯/针/读数必须同说一种时间
          if (live) {
            displayMs = nowMs;
            reevaluate(nowMs);
          }
          ensureLoop();
          scheduleBoundary();
        },
        Math.max(1500, t - Date.now()),
      );
    }
    const onSafety = () => {
      nowMs = Date.now();
      if (live && !dialDragging && springT < 0) {
        displayMs = nowMs;
        reevaluate(nowMs);
      }
      repaint = true; // 晨昏线随真实时间挪动：60s 重画一帧
      ensureLoop();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearMeteors(); // 回来无僵尸光条
        beams.length = 0; // 链路同清（回来再自然触发）
        meshEdges.clear();
        clearTimeout(boundaryTimer);
        clearInterval(safetyTimer);
      } else {
        onSafety();
        scheduleBoundary();
        safetyTimer = window.setInterval(onSafety, 60_000);
      }
    };
    /* 信号到达：灯色即换（一次性重画，无事件动画——光一次性）；
     * 卫星球纹理就绪：切模式重画一帧 */
    const onSignalsArrived = () => {
      repaint = true;
      ensureLoop();
    };
    const onGLReady = () => {
      repaint = true;
      ensureLoop();
    };

    /* ---- 待机呼吸：每 6~11s 挑一盏正面可见的亮灯做一次 0.8s 微光 ---- */
    let breathTimer = 0;
    function scheduleBreath() {
      clearTimeout(breathTimer);
      if (reduced) return;
      breathTimer = window.setTimeout(
        () => {
          if (disposed) return;
          frameBasis();
          // 呼吸池：正面可见的开市灯为主（70%），盘前灯偶尔一闪（30%）——睡着的半球也有脉搏
          const front = lamps.filter((l) => l.vx * Ex + l.vy * Ey + l.vz * Ez > 0.2);
          const opens = front.filter((l) => l.state === "OPEN");
          const pres = front.filter((l) => l.state === "PRE");
          const pickOpens = opens.length > 0 && (pres.length === 0 || Math.random() < 0.7);
          const pool = pickOpens ? opens : pres;
          if (pool.length > 0) {
            pool[Math.floor(Math.random() * pool.length)].breathT = 0.8;
            ensureLoop();
          }
          scheduleBreath();
        },
        6000 + Math.random() * 5000,
      );
    }

    /* ---- 刻度盘 DOM 直写（RAF 频率，不走 React） ---- */
    let boundaryCacheKey = "";
    let boundaryCacheText = "";
    // resolvedOptions 每帧构造是纯浪费（updateDial 在 RAF 频率）——effect 顶部求一次
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    function updateDial(strong: number) {
      const handle = handleRef.current;
      const readout = readoutRef.current;
      const flagEl = dialFlagRef.current;
      const nameEl = dialNameRef.current;
      const c = zonedClock(new Date(displayMs), browserTz);
      if (handle && c) handle.style.left = `${((c.minutes / 1440) * 100).toFixed(2)}%`;
      const d = new Date(displayMs);
      const utc = formatLocalTime("UTC", d);
      const bj = formatLocalTime("Asia/Shanghai", d);
      const sw = strong > 0 ? sweepLamp : null;
      if (!bootDone) {
        if (readout) readout.textContent = "拖动地球旋转 · 刻度盘拨动时间";
        if (flagEl) flagEl.style.display = "none";
        if (nameEl) nameEl.style.display = "none";
        return;
      }
      if (readout) {
        if (sw) {
          readout.textContent = `拨动中 · UTC ${utc} · 北京 ${bj} · 松手回到现在`;
        } else {
          // 静止态：下一全球边界倒计时（27 所最近一次开/闭市；分钟级缓存）
          const key = `${Math.floor(nowMs / 60000)}`;
          if (key !== boundaryCacheKey) {
            boundaryCacheKey = key;
            let bt = Infinity;
            let bl: (typeof lamps)[number] | null = null;
            for (const l of lamps) {
              const b = nextBoundaryAfter(l.exch, nowMs);
              if (b < bt) {
                bt = b;
                bl = l;
              }
            }
            if (bl) {
              const deltaMs = Math.max(0, bt - nowMs);
              const h = Math.floor(deltaMs / 3_600_000);
              const m = Math.floor((deltaMs % 3_600_000) / 60_000);
              const verb = bl.state === "OPEN" || bl.state === "BREAK" ? "收盘" : "开盘";
              boundaryCacheText = `下一边界 · ${bl.exch.zh} ${h > 0 ? `${h} 时 ` : ""}${m} 分后${verb}`;
            } else boundaryCacheText = "";
          }
          readout.textContent = boundaryCacheText || `现在 · 北京 ${bj} · UTC ${utc}`;
        }
      }
      if (flagEl && nameEl) {
        if (sw) {
          const uri = sw.cc ? flagUri(sw.cc) : null;
          if (uri) {
            if (flagEl.getAttribute("src") !== uri) flagEl.src = uri;
            flagEl.style.display = "inline-block";
          } else {
            flagEl.style.display = "none";
          }
          nameEl.textContent = `${sw.exch.zh} ${formatLocalTime(sw.exch.tz, d)} ${STATE_ZH[stateOf(sw, displayMs)]}`;
          nameEl.style.display = "inline-block";
        } else {
          flagEl.style.display = "none";
          nameEl.style.display = "none";
        }
      }
    }

    /* ---- 尺寸 ---- */
    function resize() {
      const rect = stage.getBoundingClientRect();
      W = Math.max(0, rect.width);
      H = Math.max(0, rect.height);
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      R = Math.max(8, 0.4 * Math.min(W, H)); // 球径占短边 80%
      cx = W / 2;
      cy = H * 0.43; // 光学中心略偏高（下方留给芯片与刻度盘）
      glr?.resize(Math.max(1, Math.round(W * DPR)), Math.max(1, Math.round(H * DPR)));
      bakeSphere();
      bakeChips();
      bakeStars();
      updateDial(0);
      repaint = true;
      ensureLoop();
    }

    /* ---- 装配 ---- */
    try {
      const fm = getComputedStyle(document.documentElement).getPropertyValue("--ink-font-mono");
      if (fm && fm.trim()) monoFamily = fm.trim();
    } catch {
      /* 保持默认字体 */
    }
    // 旗帜异步解码竞态：onload 后重烘芯片（否则首帧烘进双字母占位永不更新）
    for (const l of lamps) {
      const img = l.flag;
      if (img && !img.complete) {
        img.addEventListener(
          "load",
          () => {
            if (disposed) return;
            bakeChips();
            repaint = true;
            ensureLoop();
          },
          { once: true },
        );
      }
    }
    resize();
    reevaluate(nowMs, true);
    if (reduced) {
      bootDone = true;
      for (const l of lamps) l.cur = l.target;
    }
    scheduleBoundary();
    scheduleBreath();
    safetyTimer = window.setInterval(onSafety, 60_000);
    // 调试/验收钩子（仅 dev）：外部可设视角（写闭包三数字 + 杀惯性 + 唤醒一帧）
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__atlasSetView = (y: number, p: number, z: number) => {
        if (!Number.isFinite(y) || !Number.isFinite(p)) return;
        yaw = y;
        pitch = clamp(p, -PITCH_CLAMP, PITCH_CLAMP);
        if (Number.isFinite(z)) zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
        velYaw = 0;
        ensureLoop();
      };
    }
    ensureLoop();

    stage.addEventListener("pointerdown", onStagePointerDown);
    stage.addEventListener("pointermove", onStagePointerMove, { passive: true });
    stage.addEventListener("pointerup", onStagePointerUp);
    stage.addEventListener("pointercancel", onStagePointerUp);
    stage.addEventListener("pointerleave", onStageLeave);
    stage.addEventListener("dblclick", onDblClick);
    stage.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("atlas:signals", onSignalsArrived);
    window.addEventListener("atlas:gl-ready", onGLReady);
    const dial = dialRef.current;
    if (dial) {
      dial.addEventListener("pointerdown", onDialPointerDown);
      dial.addEventListener("pointermove", onDialPointerMove, { passive: true });
      dial.addEventListener("pointerup", onDialPointerUp);
      dial.addEventListener("keydown", onDialKey);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
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

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      glr?.dispose();
      delete (window as unknown as Record<string, unknown>).__atlasSetView;
      delete (window as unknown as Record<string, unknown>).__atlasView;
      clearTimeout(boundaryTimer);
      clearInterval(safetyTimer);
      clearTimeout(breathTimer);
      clearTimeout(longPressTimer);
      clearTimeout(resizeTimer);
      stage.removeEventListener("pointerdown", onStagePointerDown);
      stage.removeEventListener("pointermove", onStagePointerMove);
      stage.removeEventListener("pointerup", onStagePointerUp);
      stage.removeEventListener("pointercancel", onStagePointerUp);
      stage.removeEventListener("pointerleave", onStageLeave);
      stage.removeEventListener("dblclick", onDblClick);
      stage.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("atlas:signals", onSignalsArrived);
      window.removeEventListener("atlas:gl-ready", onGLReady);
      if (dial) {
        dial.removeEventListener("pointerdown", onDialPointerDown);
        dial.removeEventListener("pointermove", onDialPointerMove);
        dial.removeEventListener("pointerup", onDialPointerUp);
        dial.removeEventListener("keydown", onDialKey);
      }
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResizeDebounced);
      ro?.disconnect();
    };
  }, []);

  /* 顶部时钟 + 双市场倒计时（1Hz，独立于画布引擎） */
  useEffect(() => {
    const cn = EXCHANGES.find((e) => e.mic === "XSHG");
    const us = EXCHANGES.find((e) => e.mic === "XNYS");
    const chip = (exch: (typeof EXCHANGES)[number] | undefined, label: string) => {
      if (!exch) return null;
      const d = new Date();
      const st = stateAt(exch, d);
      const ms = Math.max(0, nextBoundaryAfter(exch, d.getTime()) - d.getTime());
      const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
      const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
      const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
      const open = st === "OPEN" || st === "BREAK";
      return { label, verb: open ? "收盘" : "开盘", t: `${h}:${m}:${s}`, open };
    };
    const tick = () => {
      const d = new Date();
      setClockText(`UTC ${formatLocalTime("UTC", d)} · 北京 ${formatLocalTime("Asia/Shanghai", d)}`);
      setCounts([chip(cn, "A股"), chip(us, "美股")].filter(Boolean) as NonNullable<ReturnType<typeof chip>>[]);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  /* 信号轮询：页面可见才拉，开市 30s / 闭市 10min；失败保留上一份 */
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(poll, ms);
    };
    const poll = async () => {
      if (stopped) return;
      if (document.hidden) {
        schedule(15_000);
        return;
      }
      try {
        const r = await fetch("/api/atlas/signals", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { signals?: Record<string, SignalLite> };
          if (!stopped && j && typeof j.signals === "object") {
            const changed = JSON.stringify(signalsRef.current) !== JSON.stringify(j.signals);
            signalsRef.current = j.signals;
            setSignals(j.signals);
            if (changed) window.dispatchEvent(new CustomEvent("atlas:signals"));
          }
        }
      } catch {
        /* 保留上一份真实数据 */
      }
      schedule(openCountRef.current > 0 ? 30_000 : 600_000);
    };
    poll();
    const onVis = () => {
      if (!document.hidden) schedule(500);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className={`atlas-root${scrubbing ? " is-scrubbing" : ""}`}>
      <header className="atlas-head">
        <div>
          <div className="hall-topline">
            <p className="atlas-kicker">Ninglo · Vault of Ink</p>
            <Link href="/modules" className="hall-return" aria-label="返回主页面 · 模块大厅" title="返回大厅">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5m0 0 6 6m-6-6 6-6" />
              </svg>
              返回大厅
            </Link>
          </div>
          <h1 className="atlas-title">图</h1>
          <p className="atlas-sub">舆图 · 灯色即当地基准指数涨跌 —— 朱涨银跌，全球风险偏好一眼可辨</p>
        </div>
        <div className="atlas-side">
          <div className="atlas-counts" aria-live="off">
            {counts.map((c) => (
              <span key={c.label} className={`atlas-chip${c.open ? " is-open" : ""}`}>
                {c.label} {c.verb} <b>{c.t}</b>
              </span>
            ))}
          </div>
          <p className="atlas-clock">{clockText}</p>
          <p className="atlas-legend">
            <i className="lg-up" /> 涨
            <i className="lg-down" /> 跌
            <i className="lg-gold" /> 平/无据
            <i className="lg-off" /> 休市
          </p>
        </div>
      </header>

      <main className="atlas-stage" ref={stageRef}>
        <canvas ref={glCanvasRef} className="atlas-gl" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="atlas-canvas"
          role="img"
          aria-label="世界交易所开闭市卫星地球：拖动旋转地球，底部刻度盘拨动时间"
        />
        <div className="atlas-tip" ref={tipRef} aria-hidden="true" />
        {selected && <LampCard rec={selected} sig={signals[selected.mic]} onClose={() => setSelectedMic(null)} />}
      </main>

      <div className="atlas-ticker" aria-hidden="true" title="当前正对半球的交易所">
        <div className="atlas-ticker-track" ref={tickerTrackRef} />
      </div>

      {/* 读屏可达：画布芯片只存在于指针路径，SR 用户的等价物是全量清单（点击开灯卡） */}
      <ul className="atlas-sr-list" aria-label="全部交易所">
        {mounted &&
          EXCHANGES.map((e) => (
            <li key={e.mic}>
              <button type="button" onClick={() => setSelectedMic(e.mic)}>
                {`${e.zh} ${STATE_ZH[stateAt(e, new Date())]} 当地 ${formatLocalTime(e.tz, new Date())}`}
              </button>
            </li>
          ))}
      </ul>

      <footer
        className="atlas-dial"
        ref={dialRef}
        role="slider"
        aria-label="二十四小时刻度盘：拖动拨动时间，松手回到现在；方向键微调"
        aria-orientation="horizontal"
        tabIndex={0}
      >
        <div className="atlas-dial-track">
          <span className="atlas-dial-tick t0">00</span>
          <span className="atlas-dial-tick t6">06</span>
          <span className="atlas-dial-tick t12">12</span>
          <span className="atlas-dial-tick t18">18</span>
          <span className="atlas-dial-tick t24">24</span>
          <div className="atlas-dial-handle" ref={handleRef}>
            <i />
          </div>
        </div>
        <span className="atlas-dial-readwrap">
          <img ref={dialFlagRef} className="atlas-dial-flag" alt="" />
          <span ref={dialNameRef} className="atlas-dial-name" />
          <span className="atlas-dial-read" ref={readoutRef}>
            —
          </span>
        </span>
      </footer>
    </div>
  );
}

/* ---------------- 灯卡：点选交易所后的详情（1Hz 刷新，含指数与下钻观墨） ---------------- */

const pctDir = (p: number | null | undefined) =>
  p === null || p === undefined || !Number.isFinite(p) ? "" : p > 0.005 ? "is-up" : p < -0.005 ? "is-down" : "";

function LampCard({ rec, sig, onClose }: { rec: AtlasExchange; sig?: SignalLite; onClose: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cc = MIC_CC[rec.mic];
  const flagSrc = cc ? flagUri(cc) : null;
  const now = new Date();
  const st = stateAt(rec, now);
  const nextB = nextBoundaryAfter(rec, now.getTime());
  const deltaMs = Math.max(0, nextB - now.getTime());
  const hrs = Math.floor(deltaMs / 3600_000);
  const mins = Math.floor((deltaMs % 3600_000) / 60_000);
  const later = `${hrs > 0 ? `${hrs} 时 ` : ""}${mins} 分后${st === "OPEN" || st === "BREAK" ? "收盘" : "开盘"}`;
  const mics = rec.mics ?? [rec.mic];
  const drills = mics.filter((m) => DRILL_MARKET[m]);

  return (
    <aside className="atlas-card" aria-label={`${rec.zh}交易所详情`}>
      <button className="atlas-card-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
      <p className="atlas-card-city">
        {flagSrc && <img className="atlas-card-flag" src={flagSrc} alt="" />}
        {rec.zh} <span>{rec.city}</span>
      </p>
      <p className="atlas-card-mic">{mics.join(" · ")}</p>
      {sig && sig.price !== null && (
        <p className={`atlas-card-idx ${pctDir(sig.changePct)}`}>
          <span className="atlas-card-idxname">{sig.indexName}</span>
          <span className="atlas-card-num">
            {sig.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
            <em>
              {sig.changePct !== null && sig.changePct > 0 ? "+" : ""}
              {Number.isFinite(sig.changePct) ? (sig.changePct as number).toFixed(2) : "--"}%
            </em>
          </span>
        </p>
      )}
      <p className={`atlas-card-state is-${st.toLowerCase()}`}>
        <i /> {STATE_ZH[st]}
      </p>
      <dl className="atlas-card-facts">
        <div>
          <dt>当地时刻</dt>
          <dd>{formatLocalTime(rec.tz, now)}</dd>
        </div>
        <div>
          <dt>下一边界</dt>
          <dd>{later}</dd>
        </div>
        <div>
          <dt>时区</dt>
          <dd>{rec.tz}</dd>
        </div>
      </dl>
      {drills.length > 0 && (
        <div className="atlas-card-drill">
          {drills.map((m) => (
            <Link key={m} href={`/quant?market=${DRILL_MARKET[m]}&exchange=${m}`} className="atlas-card-link">
              进观墨 · {m}
            </Link>
          ))}
        </div>
      )}
      {rec.calendar === "lean" && <p className="atlas-card-cal">假日日历来自 LEAN（Apache-2.0）</p>}
    </aside>
  );
}
