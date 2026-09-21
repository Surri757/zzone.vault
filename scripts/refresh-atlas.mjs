/**
 * refresh:atlas —— 舆图数据构建管线（构建期炼数据，运行期零新依赖）。
 *
 * 产出两份静态资产：
 *   data/atlas-dots.json       点阵地形（Natural Earth 陆地，等距圆柱网格采样）
 *   data/atlas-exchanges.json  交易所灯表（坐标/时区/分段时段/假日/提前收盘）
 *
 * 数据源与回退梯子（任一失败不崩溃，逐级降级）：
 *   地形   node_modules/world-atlas（npm 本地，永远可用）
 *   时段   仓库内精选表（下方 EXCHANGES，人工核对的正源）
 *   假日   QuantConnect LEAN market-hours-database.json（Apache-2.0）：
 *          .atlas-cache 缓存 → gh api → jsDelivr → gh 镜像 → raw
 *          全部失败则不带假日正常写出（ weekday 时钟层，灯只是早亮晚亮）
 *
 * 校验失败（坐标非法/时区不可解析/时段倒挂/点阵过少）→ 退出码 1，不写坏数据。
 * 写入原子：临时文件 + rename（同 refresh-stock-catalog 惯例）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(ROOT, ".atlas-cache");
const DOT_GRID = { stepLon: 1.4, stepLat: 1.4, latTop: 90.0, latBottom: -90.0, lonLeft: -179.3 };
const HOLIDAY_MIN_YEAR = 2025;
const HOLIDAY_MAX_YEAR = 2029;

/* ------------------------------------------------------------------ */
/* 精选交易所表 —— 灯的正源。时段为交易所当地时间的现金股票常规时段。 */
/* 坐标为城市级（世界尺度足够）；off 为显示微调（度），避免近邻城市灯重叠。 */
/* leanKey 命中 LEAN 时：时段以 LEAN market 段为准，假日/提前收盘并入。 */
const EXCHANGES = [
  { mic: "XSHG", city: "Shanghai", zh: "上海", lat: 31.24, lon: 121.48, tz: "Asia/Shanghai",
    sessions: { 1: [["09:30", "11:30"], ["13:00", "15:00"]], 2: [["09:30", "11:30"], ["13:00", "15:00"]], 3: [["09:30", "11:30"], ["13:00", "15:00"]], 4: [["09:30", "11:30"], ["13:00", "15:00"]], 5: [["09:30", "11:30"], ["13:00", "15:00"]] } },
  { mic: "XSHE", city: "Shenzhen", zh: "深圳", lat: 22.54, lon: 114.06, tz: "Asia/Shanghai",
    sessions: { 1: [["09:30", "11:30"], ["13:00", "15:00"]], 2: [["09:30", "11:30"], ["13:00", "15:00"]], 3: [["09:30", "11:30"], ["13:00", "15:00"]], 4: [["09:30", "11:30"], ["13:00", "15:00"]], 5: [["09:30", "11:30"], ["13:00", "15:00"]] } },
  { mic: "XBSE", city: "Beijing", zh: "北京", lat: 39.9, lon: 116.41, tz: "Asia/Shanghai",
    sessions: { 1: [["09:30", "11:30"], ["13:00", "15:00"]], 2: [["09:30", "11:30"], ["13:00", "15:00"]], 3: [["09:30", "11:30"], ["13:00", "15:00"]], 4: [["09:30", "11:30"], ["13:00", "15:00"]], 5: [["09:30", "11:30"], ["13:00", "15:00"]] } },
  { mic: "XHKG", city: "Hong Kong", zh: "中国·香港", lat: 22.28, lon: 114.16, off: [0.7, -0.8], tz: "Asia/Hong_Kong",
    sessions: { 1: [["09:30", "12:00"], ["13:00", "16:00"]], 2: [["09:30", "12:00"], ["13:00", "16:00"]], 3: [["09:30", "12:00"], ["13:00", "16:00"]], 4: [["09:30", "12:00"], ["13:00", "16:00"]], 5: [["09:30", "12:00"], ["13:00", "16:00"]] } },
  { mic: "XTAI", city: "Taipei", zh: "中国·台湾", lat: 25.03, lon: 121.57, tz: "Asia/Taipei",
    sessions: { 1: [["09:00", "13:30"]], 2: [["09:00", "13:30"]], 3: [["09:00", "13:30"]], 4: [["09:00", "13:30"]], 5: [["09:00", "13:30"]] } },
  { mic: "XJPX", city: "Tokyo", zh: "东京", lat: 35.68, lon: 139.77, tz: "Asia/Tokyo",
    sessions: { 1: [["09:00", "11:30"], ["12:30", "15:00"]], 2: [["09:00", "11:30"], ["12:30", "15:00"]], 3: [["09:00", "11:30"], ["12:30", "15:00"]], 4: [["09:00", "11:30"], ["12:30", "15:00"]], 5: [["09:00", "11:30"], ["12:30", "15:00"]] } },
  { mic: "XKRX", city: "Seoul", zh: "首尔", lat: 37.57, lon: 126.98, tz: "Asia/Seoul",
    sessions: { 1: [["09:00", "15:30"]], 2: [["09:00", "15:30"]], 3: [["09:00", "15:30"]], 4: [["09:00", "15:30"]], 5: [["09:00", "15:30"]] } },
  { mic: "XSES", city: "Singapore", zh: "新加坡", lat: 1.28, lon: 103.85, tz: "Asia/Singapore",
    sessions: { 1: [["09:00", "12:00"], ["13:00", "17:00"]], 2: [["09:00", "12:00"], ["13:00", "17:00"]], 3: [["09:00", "12:00"], ["13:00", "17:00"]], 4: [["09:00", "12:00"], ["13:00", "17:00"]], 5: [["09:00", "12:00"], ["13:00", "17:00"]] } },
  { mic: "XNSE", city: "Mumbai", zh: "孟买", lat: 19.08, lon: 72.88, tz: "Asia/Kolkata", leanKey: "Equity-india-[*]",
    sessions: { 1: [["09:15", "15:30"]], 2: [["09:15", "15:30"]], 3: [["09:15", "15:30"]], 4: [["09:15", "15:30"]], 5: [["09:15", "15:30"]] } },
  { mic: "XASX", city: "Sydney", zh: "悉尼", lat: -33.87, lon: 151.21, tz: "Australia/Sydney",
    sessions: { 1: [["10:00", "16:00"]], 2: [["10:00", "16:00"]], 3: [["10:00", "16:00"]], 4: [["10:00", "16:00"]], 5: [["10:00", "16:00"]] } },
  { mic: "XSAU", city: "Riyadh", zh: "利雅得", lat: 24.71, lon: 46.68, tz: "Asia/Riyadh",
    sessions: { 0: [["10:00", "15:00"]], 1: [["10:00", "15:00"]], 2: [["10:00", "15:00"]], 3: [["10:00", "15:00"]], 4: [["10:00", "15:00"]] } },
  { mic: "XDUB", city: "Dubai", zh: "迪拜", lat: 25.2, lon: 55.27, tz: "Asia/Dubai",
    sessions: { 1: [["10:00", "15:00"]], 2: [["10:00", "15:00"]], 3: [["10:00", "15:00"]], 4: [["10:00", "15:00"]], 5: [["10:00", "15:00"]] } },
  { mic: "XJSE", city: "Johannesburg", zh: "约翰内斯堡", lat: -26.2, lon: 28.05, tz: "Africa/Johannesburg",
    sessions: { 1: [["09:00", "17:00"]], 2: [["09:00", "17:00"]], 3: [["09:00", "17:00"]], 4: [["09:00", "17:00"]], 5: [["09:00", "17:00"]] } },
  { mic: "XMSM", city: "Moscow", zh: "莫斯科", lat: 55.76, lon: 37.62, tz: "Europe/Moscow",
    sessions: { 1: [["10:00", "18:50"]], 2: [["10:00", "18:50"]], 3: [["10:00", "18:50"]], 4: [["10:00", "18:50"]], 5: [["10:00", "18:50"]] } },
  { mic: "XETR", city: "Frankfurt", zh: "法兰克福", lat: 50.11, lon: 8.68, off: [7, 1], tz: "Europe/Berlin",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XPAR", city: "Paris", zh: "巴黎", lat: 48.86, lon: 2.35, off: [-8, -2], tz: "Europe/Paris",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XAMS", city: "Amsterdam", zh: "阿姆斯特丹", lat: 52.37, lon: 4.9, off: [0, 7], tz: "Europe/Amsterdam",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XSWX", city: "Zurich", zh: "苏黎世", lat: 47.38, lon: 8.54, off: [4, -7], tz: "Europe/Zurich",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XMIL", city: "Milan", zh: "米兰", lat: 45.46, lon: 9.19, off: [8, -8], tz: "Europe/Rome",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XMAD", city: "Madrid", zh: "马德里", lat: 40.42, lon: -3.7, tz: "Europe/Madrid",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XSTO", city: "Stockholm", zh: "斯德哥尔摩", lat: 59.33, lon: 18.07, tz: "Europe/Stockholm",
    sessions: { 1: [["09:00", "17:30"]], 2: [["09:00", "17:30"]], 3: [["09:00", "17:30"]], 4: [["09:00", "17:30"]], 5: [["09:00", "17:30"]] } },
  { mic: "XIST", city: "Istanbul", zh: "伊斯坦布尔", lat: 41.01, lon: 28.98, tz: "Europe/Istanbul",
    sessions: { 1: [["10:00", "18:00"]], 2: [["10:00", "18:00"]], 3: [["10:00", "18:00"]], 4: [["10:00", "18:00"]], 5: [["10:00", "18:00"]] } },
  { mic: "XLON", city: "London", zh: "伦敦", lat: 51.51, lon: -0.13, off: [-6, 4], tz: "Europe/London",
    sessions: { 1: [["08:00", "16:30"]], 2: [["08:00", "16:30"]], 3: [["08:00", "16:30"]], 4: [["08:00", "16:30"]], 5: [["08:00", "16:30"]] } },
  { mic: "XNYS", mics: ["XNYS", "XNAS"], city: "New York", zh: "纽约", lat: 40.71, lon: -74.01, tz: "America/New_York", leanKey: "Equity-usa-[*]",
    sessions: { 1: [["09:30", "16:00"]], 2: [["09:30", "16:00"]], 3: [["09:30", "16:00"]], 4: [["09:30", "16:00"]], 5: [["09:30", "16:00"]] } },
  { mic: "XTSE", city: "Toronto", zh: "多伦多", lat: 43.65, lon: -79.38, off: [-9, 4], tz: "America/Toronto",
    sessions: { 1: [["09:30", "16:00"]], 2: [["09:30", "16:00"]], 3: [["09:30", "16:00"]], 4: [["09:30", "16:00"]], 5: [["09:30", "16:00"]] } },
  { mic: "XMEX", city: "Mexico City", zh: "墨西哥城", lat: 19.43, lon: -99.13, tz: "America/Mexico_City",
    sessions: { 1: [["08:30", "15:00"]], 2: [["08:30", "15:00"]], 3: [["08:30", "15:00"]], 4: [["08:30", "15:00"]], 5: [["08:30", "15:00"]] } },
  { mic: "BVMF", city: "São Paulo", zh: "圣保罗", lat: -23.55, lon: -46.63, tz: "America/Sao_Paulo",
    sessions: { 1: [["10:00", "17:30"]], 2: [["10:00", "17:30"]], 3: [["10:00", "17:30"]], 4: [["10:00", "17:30"]], 5: [["10:00", "17:30"]] } },
];

/* ------------------------------------------------------------------ */
/* 工具 */

const fail = (msg) => { console.error(`[refresh:atlas] 校验失败：${msg}`); process.exit(1); };
const hm2min = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};
const pad = (n) => String(n).padStart(2, "0");
/** LEAN 的 M/D/YYYY（可零填充）→ YYYY-MM-DD；不合法返回 null */
const leanDateToIso = (raw) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
};

function atomicWrite(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
  renameSync(tmp, file);
}

async function fetchWithTimeout(url, ms = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* LEAN 假日数据：缓存 → gh api → CDN/镜像 → 放弃（降级不带假日） */

const LEAN_FILE = "Data/market-hours/market-hours-database.json";
const LEAN_CACHE = path.join(CACHE_DIR, "market-hours-database.json");

async function loadLean() {
  const attempts = [];
  // 1) 本地缓存
  if (existsSync(LEAN_CACHE)) {
    try {
      const parsed = JSON.parse(readFileSync(LEAN_CACHE, "utf8"));
      if (parsed && parsed.entries && Object.keys(parsed.entries).length > 0) {
        console.log("[refresh:atlas] LEAN：命中本地缓存");
        return { db: parsed, source: "cache(.atlas-cache)" };
      }
      attempts.push("cache:结构异常");
    } catch {
      attempts.push("cache:解析失败");
    }
  }
  // 2) gh api（本机实测可达；github.com 直连 443 不通的环境仍可用）
  try {
    const r = spawnSync("gh", ["api", `repos/QuantConnect/Lean/contents/${LEAN_FILE}`, "-H", "Accept: application/vnd.github.raw"], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (r.status === 0 && r.stdout && r.stdout.length > 1000) {
      const parsed = JSON.parse(r.stdout.toString("utf8"));
      if (parsed && parsed.entries) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(LEAN_CACHE, r.stdout);
        console.log("[refresh:atlas] LEAN：gh api 拉取成功（已写缓存）");
        return { db: parsed, source: "gh api (github.com/QuantConnect/Lean)" };
      }
      attempts.push("gh-api:结构异常");
    } else {
      attempts.push(`gh-api:exit=${r.status}${r.error ? `(${r.error.code})` : ""}`);
    }
  } catch (e) {
    attempts.push(`gh-api:${e.code ?? e.message}`);
  }
  // 3) CDN 与镜像
  const mirrors = [
    ["jsdelivr", `https://cdn.jsdelivr.net/gh/QuantConnect/Lean@master/${LEAN_FILE}`],
    ["ghfast", `https://ghfast.top/https://raw.githubusercontent.com/QuantConnect/Lean/master/${LEAN_FILE}`],
    ["gh-proxy", `https://gh-proxy.com/https://raw.githubusercontent.com/QuantConnect/Lean/master/${LEAN_FILE}`],
    ["raw", `https://raw.githubusercontent.com/QuantConnect/Lean/master/${LEAN_FILE}`],
  ];
  for (const [name, url] of mirrors) {
    try {
      const buf = await fetchWithTimeout(url);
      const parsed = JSON.parse(buf.toString("utf8"));
      if (parsed && parsed.entries) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(LEAN_CACHE, buf);
        console.log(`[refresh:atlas] LEAN：${name} 镜像拉取成功（已写缓存）`);
        return { db: parsed, source: `${name} mirror` };
      }
      attempts.push(`${name}:结构异常`);
    } catch (e) {
      attempts.push(`${name}:${e.code ?? e.message}`);
    }
  }
  console.warn(`[refresh:atlas] LEAN 全部来源失败，降级：不带假日表（仅周内时段）。尝试记录：${attempts.join(" | ")}`);
  return { db: null, source: null };
}

/** 从 LEAN 条目提炼：weekday→market 段、假日 ISO、提前收盘 ISO→分钟 */
function distillLeanEntry(entry) {
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const sessions = {};
  dayNames.forEach((dn, i) => {
    const segs = (entry[dn] || []).filter((s) => s.state === "market");
    if (segs.length > 0) sessions[i] = segs.map((s) => [hm2min(s.start), hm2min(s.end)]);
  });
  const holidays = [];
  for (const raw of entry.holidays || []) {
    const iso = leanDateToIso(raw);
    const y = iso ? Number(iso.slice(0, 4)) : 0;
    if (iso && y >= HOLIDAY_MIN_YEAR && y <= HOLIDAY_MAX_YEAR) holidays.push(iso);
  }
  const earlyCloses = {};
  for (const [raw, time] of Object.entries(entry.earlyCloses || {})) {
    const iso = leanDateToIso(raw);
    const min = hm2min(time);
    const y = iso ? Number(iso.slice(0, 4)) : 0;
    if (iso && min !== null && y >= HOLIDAY_MIN_YEAR && y <= HOLIDAY_MAX_YEAR) earlyCloses[iso] = min;
  }
  return { sessions, holidays: [...new Set(holidays)].sort(), earlyCloses };
}

/* ------------------------------------------------------------------ */
/* 点阵地形：world-atlas 陆地多边形 → 等距圆柱网格采样 */

function buildDots() {
  let land;
  try {
    const topo = require("world-atlas/land-110m.json");
    const { feature } = require("topojson-client");
    const f = feature(topo, topo.objects.land);
    land = f.features ? f.features[0] : f;
  } catch (e) {
    fail(`地形依赖不可用（npm i -D world-atlas topojson-client d3-geo）：${e.message}`);
  }
  const { geoContains } = require("d3-geo");

  const { stepLon, stepLat, latTop, latBottom, lonLeft } = DOT_GRID;
  const lons = [];
  for (let lon = lonLeft; lon <= 180; lon += stepLon) lons.push(lon);
  const dots = [];
  let hash = 2166136261;
  const rand = () => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; // xorshift32，确定性抖动
    return ((hash >>> 0) % 10000) / 10000;
  };
  for (let lat = latTop; lat >= latBottom; lat -= stepLat) {
    for (const lon0 of lons) {
      const jit = (rand() - 0.5) * 0.55;
      const jit2 = (rand() - 0.5) * 0.55;
      const lon = Math.max(-179.9, Math.min(179.9, lon0 + jit));
      const la = Math.max(latBottom, Math.min(latTop, lat + jit2));
      if (!geoContains(land, [lon, la])) continue;
      // 极圈外压低权重：冰帽淡点即可（球形化后极冠必须有陆、但不能抢戏）
      let w = 0.55 + rand() * 0.45;
      if (Math.abs(la) > 66) w *= 0.45;
      dots.push({ lon, lat: la, w });
    }
  }
  if (dots.length < 1000) fail(`点阵过少（${dots.length} < 1000），疑似地形数据损坏`);

  // 编码：每点 5 字节 [lonQ u16][latQ u16][w u8]，量化到 0.1°，base64。
  // 陆地点纬度偏移 +90（覆盖极冠 -90..90；城市管线仍用 +58，互不影响）
  const buf = Buffer.alloc(dots.length * 5);
  dots.forEach((d, i) => {
    const o = i * 5;
    buf.writeUInt16LE(Math.round((d.lon + 180) * 10), o);
    buf.writeUInt16LE(Math.round((d.lat + 90) * 10), o + 2);
    buf.writeUInt8(Math.round(d.w * 255), o + 4);
  });
  return {
    v: 1,
    encoding: "u16le-b64-deci",
    stepLon, stepLat, latTop, latBottom, lonLeft,
    count: dots.length,
    data: buf.toString("base64"),
  };
}

/* ------------------------------------------------------------------ */
/* 城市灯光层：GeoNames cities15000（CC-BY 4.0，人口≥5 万的城市点）。
 * 失败不致命：警告 + 保留旧 data/atlas-cities.json（城市层缺省=现状，不崩溃）。 */
const CITY_MIN_POP = 50_000;

async function buildCities() {
  const txtPath = path.join(CACHE_DIR, "cities15000.txt");
  const zipPath = path.join(CACHE_DIR, "cities15000.zip");
  let fromCache = false;
  if (existsSync(txtPath)) {
    fromCache = true;
  } else {
    mkdirSync(CACHE_DIR, { recursive: true });
    // 下载 zip（GeoNames 直链实测可达）；解压用系统 bsdtar（Windows 10+ 自带，支持 zip），失败退 PowerShell
    try {
      const buf = await fetchWithTimeout("https://download.geonames.org/export/dump/cities15000.zip", 180_000);
      writeFileSync(zipPath, buf);
    } catch (e) {
      console.warn(`[refresh:atlas] 城市层：GeoNames 下载失败（${e.code ?? e.message}），保留旧数据`);
      return null;
    }
    let r = spawnSync("tar", ["-xf", zipPath, "-C", CACHE_DIR], { timeout: 60_000 });
    if (r.status !== 0 || !existsSync(txtPath)) {
      r = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${CACHE_DIR}' -Force`], { timeout: 60_000 });
    }
    if (r.status !== 0 || !existsSync(txtPath)) {
      console.warn("[refresh:atlas] 城市层：解压失败，保留旧数据");
      return null;
    }
  }
  const cities = [];
  for (const line of readFileSync(txtPath, "utf8").split("\n")) {
    const f = line.split("\t");
    if (f.length < 15) continue;
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const pop = Number(f[14]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(pop) || pop < CITY_MIN_POP) continue;
    if (lat < -56 || lat > 78 || lon < -180 || lon > 180) continue;
    cities.push({ lon, lat, pop });
  }
  if (cities.length < 2000) {
    console.warn(`[refresh:atlas] 城市层：有效城市过少（${cities.length}），疑似数据损坏，保留旧数据`);
    return null;
  }
  // 编码同点阵约定：5B [lonQ u16][latQ u16][popLog u8]；popLog = log10(pop) 档（4.7→0，7.8→255）
  const buf = Buffer.alloc(cities.length * 5);
  cities.forEach((c, i) => {
    const o = i * 5;
    buf.writeUInt16LE(Math.round((c.lon + 180) * 10), o);
    buf.writeUInt16LE(Math.round((c.lat + 58) * 10), o + 2);
    const lg = clampN((Math.log10(c.pop) - 4.7) / (7.8 - 4.7), 0, 1);
    buf.writeUInt8(Math.round(lg * 255), o + 4);
  });
  return { cities, b64: buf.toString("base64"), fromCache };
}

const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ */
/* 主流程 */

/** 精选实名卫星（真实 TLE，CelesTrak GP 公有领域数据；tier 决定显示半径档） */
const SATS = [
  { norad: 25544, name: "ISS (ZARYA)", zh: "国际空间站", tier: "leo" },
  { norad: 48274, name: "CSS (TIANHE)", zh: "天宫·天和", tier: "leo" },
  { norad: 20580, name: "HST", zh: "哈勃望远镜", tier: "leo" },
  { norad: 33591, name: "NOAA 19", zh: "诺阿 19", tier: "leo" },
  { norad: 43581, name: "BEIDOU-3 M5", zh: "北斗三号 M5", tier: "meo" },
  { norad: 44204, name: "BEIDOU-3 IGSO-1", zh: "北斗 IGSO-1", tier: "geo" },
  { norad: 40534, name: "NAVSTAR 73 (USA 260)", zh: "GPS IIF", tier: "meo" },
  { norad: 40128, name: "GSAT0201 (GALILEO 5)", zh: "伽利略 5", tier: "meo" },
  { norad: 36111, name: "COSMOS 2456 [GLONASS-M]", zh: "格洛纳斯 M", tier: "meo" },
  { norad: 41882, name: "FENGYUN 4A", zh: "风云四号 A", tier: "geo" },
  { norad: 41866, name: "GOES 16", zh: "GOES 16", tier: "geo" },
  { norad: 42915, name: "TDRS 13", zh: "TDRS 13 中继星", tier: "geo" },
  { norad: 49011, name: "TIANLIAN 2-01", zh: "天链二号 01 星", tier: "geo" },
  { norad: 44714, name: "STARLINK-1008", zh: "星链 1008", tier: "leo" },
  { norad: 44718, name: "STARLINK-1012", zh: "星链 1012", tier: "leo" },
  { norad: 68791, name: "NAVSTAR 86 (USA 585)", zh: "GPS III", tier: "meo" },
  { norad: 63130, name: "COSMOS 2584 [GLONASS-K2]", zh: "格洛纳斯 K2", tier: "meo" },
];

/** 拉取精选卫星 TLE：缓存 → CelesTrak 直连（内容校验防节流 200 假响应）→ 全败不写文件（卫星层缺席） */
async function buildSatellites() {
  const cacheFile = path.join(CACHE_DIR, "satellites.json");
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    /* 无缓存 */
  }
  const freshTtlMs = 6 * 3600_000; // 6h 内缓存视为新鲜（尊重 CelesTrak 2h 节流）
  const cacheAge = cached?.fetchedAt ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && Array.isArray(cached.sats) && cached.sats.length >= 8 && cacheAge < freshTtlMs) {
    console.log(`[refresh:atlas] 卫星：命中本地缓存（${cached.sats.length} 颗，${new Date(cached.fetchedAt).toISOString()}）`);
    return cached;
  }
  const sats = [];
  for (const want of SATS) {
    try {
      const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${want.norad}&FORMAT=tle`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      const lines = text.split(/\r?\n/);
      if (lines.length < 3) continue;
      // 内容校验：节流响应 HTTP 200 但 body 是英文提示——TLE 行 1 必以 "1 " 开头
      if (!lines[1].startsWith("1 ") || !lines[2].startsWith("2 ")) continue;
      if (!lines[0].trim()) continue;
      sats.push({ ...want, name: lines[0].trim(), tle1: lines[1], tle2: lines[2] });
    } catch {
      /* 单颗失败跳过 */
    }
  }
  if (sats.length < 8) {
    console.log(`[refresh:atlas] 卫星：仅取到 ${sats.length} 颗（阈值 8），降级不写`);
    return null;
  }
  const payload = { fetchedAt: new Date().toISOString(), sats };
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    atomicWrite(cacheFile, payload);
  } catch {
    /* 缓存写失败不致命 */
  }
  console.log(`[refresh:atlas] 卫星：${sats.length} 颗真实 TLE 入库`);
  return payload;
}

async function main() {
  console.log("[refresh:atlas] 开始……");
  const sources = [];

  // —— 地形 ——
  const dots = buildDots();
  sources.push({ name: "terrain", source: "world-atlas@land-110m（Natural Earth，公有领域）", ok: true });
  console.log(`[refresh:atlas] 点阵：${dots.count} 点（步长 ${DOT_GRID.stepLon}°×${DOT_GRID.stepLat}°，b64 ${(dots.data.length / 1024).toFixed(1)}KB）`);

  // —— 城市灯光层 ——
  const city = await buildCities();
  if (city) {
    sources.push({
      name: "city-lights",
      source: `GeoNames cities15000（CC-BY 4.0）via ${city.fromCache ? "缓存" : "download.geonames.org"}，人口≥${CITY_MIN_POP.toLocaleString()}`,
      ok: true,
    });
    atomicWrite(path.join(DATA_DIR, "atlas-cities.json"), {
      v: 1,
      generatedAt: new Date().toISOString(),
      encoding: "u16le-b64-deci",
      count: city.cities.length,
      minPop: CITY_MIN_POP,
      data: city.b64,
    });
    console.log(`[refresh:atlas] 城市灯：${city.cities.length} 城（pop≥${CITY_MIN_POP.toLocaleString()}，b64 ${(city.b64.length / 1024).toFixed(1)}KB）`);
  } else {
    sources.push({ name: "city-lights", source: "不可达——保留旧 data/atlas-cities.json 或缺省", ok: false });
  }

  // —— 交易所 ——
  const lean = await loadLean();
  if (lean.db) sources.push({ name: "sessions-holidays", source: `LEAN market-hours-database（Apache-2.0）via ${lean.source}`, ok: true });
  else sources.push({ name: "sessions-holidays", source: "精选表（仓库内人工核对）——LEAN 不可达，无假日降级", ok: false });

  const out = [];
  for (const e of EXCHANGES) {
    // 坐标与基础校验
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180) fail(`${e.mic} 坐标非法`);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: e.tz });
    } catch {
      fail(`${e.mic} 时区不可解析：${e.tz}`);
    }

    // 时段：LEAN 命中则以其 market 段为准（与精选表同值则无感）
    let sessions = {};
    let leanMerged = false;
    if (e.leanKey && lean.db?.entries?.[e.leanKey]) {
      const d = distillLeanEntry(lean.db.entries[e.leanKey]);
      const leanTz = lean.db.entries[e.leanKey].exchangeTimeZone;
      if (leanTz && leanTz !== e.tz) fail(`${e.mic} 时区冲突：精选 ${e.tz} vs LEAN ${leanTz}`);
      if (Object.keys(d.sessions).length > 0) {
        sessions = d.sessions;
        leanMerged = true;
        if (d.holidays.length > 0 || Object.keys(d.earlyCloses).length > 0) {
          e._holidays = d.holidays;
          e._earlyCloses = d.earlyCloses;
        }
      }
    }
    if (!leanMerged) {
      for (const [wd, segs] of Object.entries(e.sessions || {})) {
        const parsed = segs.map(([a, b]) => [hm2min(a), hm2min(b)]);
        if (parsed.some(([a, b]) => a === null || b === null || a >= b)) fail(`${e.mic} 星期${wd} 时段倒挂或缺损`);
        sessions[wd] = parsed;
      }
    }
    if (Object.keys(sessions).length === 0) fail(`${e.mic} 全周无时段`);

    const rec = {
      mic: e.mic,
      ...(e.mics ? { mics: e.mics } : {}),
      city: e.city, zh: e.zh,
      lat: e.lat, lon: e.lon,
      ...(e.off ? { off: e.off } : {}),
      tz: e.tz,
      sessions,
      ...(e._holidays ? { holidays: e._holidays } : {}),
      ...(e._earlyCloses ? { earlyCloses: e._earlyCloses } : {}),
      ...(e.leanKey && leanMerged ? { calendar: "lean" } : {}),
    };
    out.push(rec);
  }

  // —— 真实卫星（精选实名 TLE；失败则卫星层整体缺席，不造假） ——
  const sats = await buildSatellites();
  if (sats) {
    sources.push({
      name: "satellites",
      source: `CelesTrak GP/TLE（USSF 跟踪数据，公有领域），${sats.fetchedAt} 拉取，${sats.sats.length} 颗实名`,
      ok: true,
    });
  }

  const generatedAt = new Date().toISOString();
  if (sats) {
    atomicWrite(path.join(DATA_DIR, "atlas-satellites.json"), {
      v: 1,
      generatedAt,
      fetchedAt: sats.fetchedAt,
      note: "精选实名卫星两行根数（TLE）。运行期用平均根数开普勒+J2 传播、真实格林尼治时角转地固；轨道高度按层仪表化压缩（真实 1.06/4.2/6.6R → 显示 1.10/1.32/1.52R）。LEO 历元超 14 天、MEO/GEO 超 30 天该星隐藏。",
      sats: sats.sats,
    });
  }
  atomicWrite(path.join(DATA_DIR, "atlas-dots.json"), { v: dots.v, generatedAt, ...dots });
  atomicWrite(path.join(DATA_DIR, "atlas-exchanges.json"), {
    v: 1,
    generatedAt,
    sources,
    preWindowMin: 30,
    note: "sessions 为交易所当地时间的常规现金时段（分钟数），weekday 0=周日。假日/提前收盘仅 LEAN 覆盖市场（XNYS·XNAS / XNSE）；其余为周内时钟，假日不熄灯属已知限制。",
    exchanges: out,
  });

  const withHol = out.filter((x) => x.holidays).length;
  console.log(`[refresh:atlas] 完成：${out.length} 盏灯（${withHol} 盏带假日日历），点阵 ${dots.count} 点 → data/atlas-*.json`);
}

main().catch((e) => {
  console.error(`[refresh:atlas] 意外崩溃：${e?.stack ?? e}`);
  process.exit(1);
});
