// 真值天球数据构建：BSC5P（耶鲁亮星表，公有领域）→ data/atlas-stars.json
// 源：frostoven/BSC5P-JSON 镜像的 original_bsc5p/catalog（gh api raw 拉取，本机缓存 .zcode/bsc5p.raw）
// 定宽列（1 起含端，HEASARC ReadMe）：RA2000 76-83（HH MM SS.T）、Dec 符 84 + 85-90、Vmag 103-107、B-V 110-114
// 输出四平行整型数组：ra(0..65535↔0..2π)、dec(厘度)、m(视星等×10)、c(色桶 0..8；9=无 B-V 中性)
// 颜色：B-V→Ballesteros 2012 色温→黑体 RGB（Tanner Helland 近似），压彩度 ×0.55 保色相序（判例：色相保真、彩度压背景档）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const RAW = new URL("../.zcode/bsc5p.raw", import.meta.url);
if (!existsSync(RAW)) {
  console.log("缓存无 raw，gh api 拉取 BSC5P…");
  const buf = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", "repos/frostoven/BSC5P-JSON/contents/original_bsc5p/catalog"], { maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(RAW, buf);
}
const raw = readFileSync(RAW, "utf8");

const MAG_MAX = 6.0;
const rows = [];
for (const line of raw.split(/\r?\n/)) {
  if (line.length < 107) continue;
  const raH = +line.slice(75, 77), raM = +line.slice(77, 79), raS = +line.slice(79, 83);
  // Dec2000：符号 idx83、度 84-85、分 86-87、秒 88-89（实测 Sirius 行定位）
  const decS = line[83], decD = +line.slice(84, 86), decM = +line.slice(86, 88), decSec = +line.slice(88, 90);
  const vmag = +line.slice(102, 107);
  const bvStr = line.slice(109, 114).trim();
  if (![raH, raM, raS, decD, decM, decSec, vmag].every(Number.isFinite) || Number.isNaN(vmag)) continue;
  const dec = (decS === "-" ? -1 : 1) * (decD + decM / 60 + decSec / 3600);
  if (!Number.isFinite(dec) || Math.abs(dec) > 90 || decD > 90) continue;
  if (vmag > MAG_MAX || vmag < -2) continue;
  const ra = ((raH + raM / 60 + raS / 3600) / 24) * 360;
  rows.push({ ra, dec, vmag, bv: bvStr ? +bvStr : null });
}
console.log(`Vmag≤${MAG_MAX}：${rows.length} 颗（B-V 缺 ${rows.filter(r => r.bv === null).length}）`);

// B-V → RGB：vendian/Charity 星色锚点分段线性（Ballesteros 序的等价查表；锚点值即该参考表实测）
const BV_ANCHORS = [
  [-0.33, 155, 176, 255], [0.0, 202, 215, 255], [0.3, 248, 247, 255], [0.58, 255, 244, 234],
  [0.81, 255, 224, 188], [1.2, 255, 210, 161], [1.6, 255, 196, 137], [1.99, 255, 180, 120],
];
const bvToRgb = bv => {
  if (bv <= BV_ANCHORS[0][0]) return BV_ANCHORS[0].slice(1);
  for (let i = 1; i < BV_ANCHORS.length; i++) {
    if (bv <= BV_ANCHORS[i][0]) {
      const [b0, ...r0] = BV_ANCHORS[i - 1], [b1, ...r1] = BV_ANCHORS[i];
      const t = (bv - b0) / (b1 - b0);
      return r0.map((v, k) => Math.round(v + (r1[k] - v) * t));
    }
  }
  return BV_ANCHORS[BV_ANCHORS.length - 1].slice(1);
};
const compress = ([r, g, b]) => { // 彩度 ×0.55：向同亮度灰收，色相序不动
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [Math.round(l + (r - l) * 0.55), Math.round(l + (g - l) * 0.55), Math.round(l + (b - l) * 0.55)];
};
const BUCKETS = 9;
const palette = [];
for (let i = 0; i < BUCKETS; i++) palette.push(compress(bvToRgb(-0.33 + ((1.99 + 0.33) * i) / (BUCKETS - 1))));
palette.push([200, 204, 214]); // 桶 9：B-V 缺失 → 中性灰白（缺席非造值）
console.log("调色板（bv −0.33→+1.99 九档+中性）：");
palette.forEach((p, i) => console.log(`  桶${i} rgb(${p.join(",")})`));

const raA = [], decA = [], mA = [], cA = [];
for (const r of rows) {
  raA.push(Math.round((r.ra / 360) * 65535));
  decA.push(Math.round(r.dec * 100));
  mA.push(Math.round(r.vmag * 10));
  const bv = r.bv === null || !Number.isFinite(r.bv) || r.bv < -0.4 || r.bv > 2.1 ? null : r.bv;
  cA.push(bv === null ? 9 : Math.min(BUCKETS - 1, Math.max(0, Math.round(((bv + 0.33) / (1.99 + 0.33)) * (BUCKETS - 1)))));
}
const out = { v: 1, src: "BSC5P Hoffleit & Warren 1991 (Yale/SAO, public domain), J2000", n: rows.length, palette, ra: raA, dec: decA, m: mA, c: cA };
writeFileSync(new URL("../data/atlas-stars.json", import.meta.url), JSON.stringify(out));
console.log(`written data/atlas-stars.json：${rows.length} 颗，${(JSON.stringify(out).length / 1024).toFixed(0)}KB`);
// 抽查名星：HR2491 天狼星（-1.46, bv0.00, RA 6h45m Dec -16°43'）
const idx = rows.findIndex(r => Math.abs(r.ra - (6 + 45 / 60 + 8.9 / 3600) / 24 * 360) < 0.2 && Math.abs(r.dec + 16.7) < 0.3);
if (idx >= 0) console.log(`抽查 天狼星：vmag=${(mA[idx] / 10).toFixed(1)} 桶=${cA[idx]}（应≈3，bv0.00 中点）`);
else console.log("警告：未抽查到天狼星");
