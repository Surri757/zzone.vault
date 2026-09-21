/**
 * 舆图卫星传播 —— 纯函数，零依赖（与 globe-gl 同一「零依赖手写」纪律）。
 * 精选实名卫星的真实 TLE 两行根数（data/atlas-satellites.json，CelesTrak 拉取），
 * 平均根数开普勒 + J2 长期项（Ω̇/Ṁ）传播，真实格林尼治时角转地固。
 *
 * 「轨道归真、呈现仪表化」判例：位置来自真名真轨道面真周期；传播简化与
 * 高度压缩（真实 1.06/4.2/6.6R → 显示 1.10/1.32/1.52R）是呈现层的仪表化，
 * 与「自转 1 圈/5min」「均时差忽略」同族。历元超龄（LEO 14 天 / MEO·GEO 30 天）
 * 该星隐藏——宁可缺席，不可造假。
 *
 * 崩溃纪律：解析/传播任何坏输入返回 null，调用方跳画该星，永不抛异常。
 */

export interface SatElement {
  norad: number;
  name: string;
  zh: string;
  tier: "leo" | "meo" | "geo";
  /** 历元（UTC 毫秒） */
  epoch: number;
  i: number; // 倾角 rad
  om: number; // 升交点赤经 rad
  e: number; // 偏心率
  w: number; // 近地点幅角 rad
  M0: number; // 历元平近点角 rad
  n: number; // 平均运动 rad/min
  /** J2 长期项 */
  omDot: number; // Ω̇ rad/min
  MDot: number; // Ṁ rad/min
  /** 显示半径（R 倍数，按层仪表化） */
  rDisp: number;
}

export interface SatPos {
  lon: number; // 地固经度 rad
  lat: number; // 地心地固纬度 rad
  altKm: number;
  /** 历元年龄（天） */
  ageDays: number;
}

const MU = 398600.5; // km³/s²
const RE = 6378.137;
const J2 = 1.08262668e-3;
const TIER_R: Record<string, number> = { leo: 1.1, meo: 1.32, geo: 1.52 };

/** TLE 两行解析 → 根数。坏行返回 null。 */
export function parseTLE(tle1: string, tle2: string, tier: string, meta: { norad: number; zh: string }): SatElement | null {
  try {
    const l1 = String(tle1 || "");
    const l2 = String(tle2 || "");
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) return null;
    const yy = parseInt(l1.slice(18, 20), 10);
    const doy = parseFloat(l1.slice(20, 32));
    if (!Number.isFinite(yy) || !Number.isFinite(doy) || doy < 1 || doy > 367) return null;
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epoch = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
    const num = (s: string) => {
      // TLE 定点数可能缺前导 0（.1234 / -.1234）
      const t = s.trim().replace("-", "-");
      const v = parseFloat(t.startsWith(".") ? "0" + t : t.startsWith("-.") ? "-0" + t.slice(1) : t);
      return Number.isFinite(v) ? v : NaN;
    };
    const iDeg = num(l2.slice(8, 16));
    const omDeg = num(l2.slice(17, 25));
    const e = parseInt(l2.slice(26, 33).trim() || "0", 10) / 1e7;
    const wDeg = num(l2.slice(34, 42));
    const MDeg = num(l2.slice(43, 51));
    const nRevDay = num(l2.slice(52, 63));
    if ([iDeg, omDeg, e, wDeg, MDeg, nRevDay].some((v) => !Number.isFinite(v)) || nRevDay <= 0) return null;
    const n = (nRevDay * 2 * Math.PI) / 1440; // rad/min
    const i = iDeg * (Math.PI / 180);
    // J2 长期项（Vallado 无阻力形式；p = a(1-e²)，a 由开普勒第三定律反解）
    const nRadS = n / 60;
    const a = Math.cbrt(MU / (nRadS * nRadS));
    const p = a * (1 - e * e);
    const k2 = 1.5 * n * J2 * (RE / p) * (RE / p);
    const omDot = -k2 * Math.cos(i);
    const MDot = k2 * 0.5 * Math.sqrt(1 - e * e);
    return {
      norad: meta.norad,
      name: "",
      zh: meta.zh,
      tier: (tier as SatElement["tier"]) || "leo",
      epoch,
      i,
      om: omDeg * (Math.PI / 180),
      e,
      w: wDeg * (Math.PI / 180),
      M0: MDeg * (Math.PI / 180),
      n,
      omDot,
      MDot,
      rDisp: TIER_R[tier] ?? 1.2,
    };
  } catch {
    return null;
  }
}

/** 格林尼治平恒星时（度→rad）。UTC≈UT1（呈现精度足够）。 */
export function gmstRad(ms: number): number {
  const jd = ms / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const T = d / 36525;
  let g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
  g = ((g % 360) + 360) % 360;
  return g * (Math.PI / 180);
}

/** 开普勒方程牛顿迭代（E − e·sinE = M） */
function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 7; k++) {
    const f = E - e * Math.sin(E) - M;
    E -= f / (1 - e * Math.cos(E));
  }
  return E;
}

/** 传播到 tMs → 地固经纬/高度。坏值返回 null。 */
export function propagate(el: SatElement, tMs: number): SatPos | null {
  try {
    const tMin = (tMs - el.epoch) / 60000;
    const M = el.M0 + (el.n + el.MDot) * tMin;
    const om = el.om + el.omDot * tMin;
    const E = solveKepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), el.e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
    const nRadS = el.n / 60;
    const a = Math.cbrt(MU / (nRadS * nRadS));
    const r = a * (1 - el.e * Math.cos(E));
    const u = el.w + nu;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const cO = Math.cos(om);
    const sO = Math.sin(om);
    const ci = Math.cos(el.i);
    const si = Math.sin(el.i);
    const x = r * (cO * cu - sO * su * ci);
    const y = r * (sO * cu + cO * su * ci);
    const z = r * su * si;
    let lon = Math.atan2(y, x) - gmstRad(tMs);
    lon = (((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const lat = Math.asin(Math.max(-1, Math.min(1, z / r)));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat, altKm: r - 6371, ageDays: (tMs - el.epoch) / 86400000 };
  } catch {
    return null;
  }
}

/** 历元超龄闸：LEO 14 天 / MEO·GEO 30 天 */
export function stale(el: SatElement, tMs: number): boolean {
  const age = (tMs - el.epoch) / 86400000;
  return age > (el.tier === "leo" ? 14 : 30) || age < -1;
}
