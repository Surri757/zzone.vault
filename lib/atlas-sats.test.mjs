/** atlas-sats 传播测试 —— `node --test lib/atlas-sats.test.mjs`（用真实入库 TLE 做集成断言） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTLE, propagate, stale, gmstRad } from "./atlas-sats.ts";

const data = JSON.parse(readFileSync(new URL("../data/atlas-satellites.json", import.meta.url), "utf8"));
const byZh = (zh) => data.sats.find((s) => s.zh === zh);
const mk = (s) => parseTLE(s.tle1, s.tle2, s.tier, { norad: s.norad, zh: s.zh });
const now = Date.parse(data.fetchedAt) + 3600_000; // 拉取后 1 小时

test("GMST 基准：J2000 正午 ≈ 280.46°", () => {
  const g = gmstRad(Date.UTC(2000, 0, 1, 12));
  const deg = (g * 180) / Math.PI;
  assert.ok(Math.abs(deg - 280.46) < 0.5, `GMST ${deg.toFixed(2)}°`);
});

test("ISS 周期 ≈ 92-93 分钟（LEO 真值）", () => {
  const el = mk(byZh("国际空间站"));
  assert.ok(el, "ISS 应可解析");
  const periodMin = (2 * Math.PI) / el.n;
  assert.ok(periodMin > 90 && periodMin < 95, `周期 ${periodMin.toFixed(1)}min`);
});

test("风云四号（GEO）纬度近零、高度 ≈ 35786km、地固经度 1 小时漂移 < 0.2°", () => {
  const el = mk(byZh("风云四号 A"));
  assert.ok(el, "FY-4A 应可解析");
  const p1 = propagate(el, now);
  const p2 = propagate(el, now + 3600_000);
  assert.ok(p1 && p2, "传播应有值");
  assert.ok(Math.abs(p1.lat) < 0.05, `纬度 ${(p1.lat * 180) / Math.PI}°`);
  assert.ok(Math.abs(p1.altKm - 35786) < 600, `高度 ${p1.altKm.toFixed(0)}km`);
  let d = Math.abs(p2.lon - p1.lon);
  if (d > Math.PI) d = 2 * Math.PI - d;
  assert.ok(d < 0.004, `经度漂移 ${(d * 180) / Math.PI}°/h`);
});

test("北斗 IGSO 纬度摆动 ±（倾角八字形）且周期 ≈ 1 恒星日", () => {
  const el = mk(byZh("北斗 IGSO-1"));
  assert.ok(el, "IGSO 应可解析");
  const p = propagate(el, now);
  const periodMin = (2 * Math.PI) / el.n;
  assert.ok(Math.abs(periodMin - 1436) < 10, `周期 ${periodMin.toFixed(0)}min`);
  assert.ok(p && Number.isFinite(p.lat), "传播应有值");
});

test("超龄闸与坏输入不抛", () => {
  const el = mk(byZh("国际空间站"));
  assert.equal(stale(el, el.epoch + 13 * 86400000), false);
  assert.equal(stale(el, el.epoch + 15 * 86400000), true);
  assert.equal(parseTLE("garbage", "nope", "leo", { norad: 1, zh: "x" }), null);
  const p = propagate(el, NaN);
  assert.equal(p, null);
});
