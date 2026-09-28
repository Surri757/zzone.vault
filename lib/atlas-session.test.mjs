/**
 * atlas-session 边缘测试 —— `npm run test:atlas`（node:test，零依赖）。
 * 用真实产出数据（data/atlas-exchanges.json）做集成断言，外加合成坏输入。
 * 覆盖：午休、周界、周日开市（利雅得）、美东夏令时切换、LEAN 假日、
 * 提前收盘、墙钟逆映射（utcForLocal）、下一边界扫描、坏输入不抛。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stateAt, zonedClock, utcForLocal, nextBoundaryAfter, formatLocalTime } from "./atlas-session.ts";

const data = JSON.parse(readFileSync(new URL("../data/atlas-exchanges.json", import.meta.url), "utf8"));
const byMic = (mic) => data.exchanges.find((e) => e.mic === mic);
const XSHG = byMic("XSHG");
const XNYS = byMic("XNYS");
const XSAU = byMic("XSAU");
const XNSE = byMic("XNSE");
const U = (s) => new Date(s).getTime();

assert.ok(XSHG && XNYS && XSAU && XNSE, "数据里应有 XSHG/XNYS/XSAU/XNSE");

/* ---- 中国时段：开盘前 / 开盘 / 午休 / 午后 / 收盘边界（end 不含） ---- */
test("XSHG 常规日五档", () => {
  const d = (h, m = 0, s = 0) => new Date(Date.UTC(2026, 8, 21, h, m, s)); // 2026-09-21 周一
  assert.equal(stateAt(XSHG, d(1, 29, 30)), "PRE"); // 09:29:30 当地
  assert.equal(stateAt(XSHG, d(1, 30)), "OPEN"); // 09:30
  assert.equal(stateAt(XSHG, d(3, 45)), "BREAK"); // 11:45 午休
  assert.equal(stateAt(XSHG, d(5, 0)), "OPEN"); // 13:00 午后
  assert.equal(stateAt(XSHG, d(6, 59)), "OPEN"); // 14:59
  assert.equal(stateAt(XSHG, d(7, 0)), "CLOSED"); // 15:00 收盘（end 不含）
});

test("XSHG 周末全关", () => {
  assert.equal(stateAt(XSHG, new Date(Date.UTC(2026, 8, 19, 3))), "CLOSED"); // 周六
  assert.equal(stateAt(XSHG, new Date(Date.UTC(2026, 8, 20, 3))), "CLOSED"); // 周日
});

/* ---- 周日开市：利雅得（UTC+3 无夏令时） ---- */
test("XSAU 周日开盘", () => {
  const sun = new Date(Date.UTC(2026, 8, 20)); // 周日
  assert.equal(stateAt(XSAU, new Date(U("2026-09-20T07:10:00Z"))), "OPEN"); // 10:10 当地
  assert.equal(stateAt(XSAU, new Date(U("2026-09-20T12:00:00Z"))), "CLOSED"); // 15:00 收
  assert.equal(stateAt(XSAU, new Date(U("2026-09-21T07:10:00Z"))), "OPEN"); // 周一也开
});

/* ---- 美东夏令时：同一当地钟点，UTC 边界漂移一小时 ---- */
test("XNYS DST 切换前后", () => {
  assert.equal(stateAt(XNYS, new Date(U("2026-03-06T14:30:00Z"))), "OPEN"); // EST 09:30
  assert.equal(stateAt(XNYS, new Date(U("2026-03-06T20:59:00Z"))), "OPEN"); // EST 15:59
  assert.equal(stateAt(XNYS, new Date(U("2026-03-06T21:00:00Z"))), "CLOSED"); // EST 16:00
  assert.equal(stateAt(XNYS, new Date(U("2026-03-13T13:30:00Z"))), "OPEN"); // EDT 09:30（钟点未变，UTC 提前一小时）
  assert.equal(stateAt(XNYS, new Date(U("2026-03-13T19:59:00Z"))), "OPEN"); // EDT 15:59
  assert.equal(stateAt(XNYS, new Date(U("2026-03-13T20:00:00Z"))), "CLOSED"); // EDT 16:00
});

/* ---- LEAN 假日与提前收盘 ---- */
test("XNYS 圣诞休市", () => {
  assert.equal(stateAt(XNYS, new Date(U("2026-12-25T15:00:00Z"))), "CLOSED"); // 周五 10:00 EST，本应开盘
});

test("XNYS 感恩节次日半日市", () => {
  assert.equal(stateAt(XNYS, new Date(U("2026-11-27T17:59:00Z"))), "OPEN"); // 12:59 EST
  assert.equal(stateAt(XNYS, new Date(U("2026-11-27T18:00:00Z"))), "CLOSED"); // 13:00 提前收盘
});

test("XNSE 用数据里第一个 2026 假日验证休市", () => {
  const hol = (XNSE.holidays || []).filter((d) => d >= "2026-01-01").sort()[0];
  assert.ok(hol, "XNSE 应有 2026 假日（LEAN 提供）");
  const noon = new Date(`${hol}T05:00:00Z`); // 10:30 IST，盘中时刻
  assert.equal(stateAt(XNSE, noon), "CLOSED");
});

/* ---- 墙钟逆映射与下一边界 ---- */
test("utcForLocal 含 DST 逆推", () => {
  const edt = utcForLocal("America/New_York", 2026, 3, 13, 570); // 当地 09:30
  assert.ok(Math.abs(edt - U("2026-03-13T13:30:00Z")) <= 60000, `EDT 逆推 ${new Date(edt).toISOString()}`);
  const est = utcForLocal("America/New_York", 2026, 3, 6, 570);
  assert.ok(Math.abs(est - U("2026-03-06T14:30:00Z")) <= 60000, `EST 逆推 ${new Date(est).toISOString()}`);
  const cn = utcForLocal("Asia/Shanghai", 2026, 9, 21, 570);
  assert.ok(Math.abs(cn - U("2026-09-21T01:30:00Z")) <= 60000);
});

test("nextBoundaryAfter 跳过周末找下一开盘", () => {
  const t1 = nextBoundaryAfter(XSHG, U("2026-09-21T01:00:00Z"));
  assert.ok(Math.abs(t1 - U("2026-09-21T01:30:00Z")) <= 60000, `盘中 ${new Date(t1).toISOString()}`);
  const t2 = nextBoundaryAfter(XSHG, U("2026-09-21T07:30:00Z"));
  assert.ok(Math.abs(t2 - U("2026-09-22T01:30:00Z")) <= 60000, `次日 ${new Date(t2).toISOString()}`);
  const t3 = nextBoundaryAfter(XSHG, U("2026-09-25T07:30:00Z"));
  assert.ok(Math.abs(t3 - U("2026-09-28T01:30:00Z")) <= 60000, `周五收盘后跳到周一 ${new Date(t3).toISOString()}`);
});

/* 回归：当地已过正午时，day-0 探针必须仍取「现在所在的当地日期」，
 * 否则盘中的当日收盘（A 股 15:00）被漏掉、倒计时直跳次日开盘 */
test("nextBoundaryAfter 盘中取当日边界（当地下午不丢收盘）", () => {
  const t = nextBoundaryAfter(XSHG, U("2026-09-21T05:23:00Z")); // 北京 13:23 午后盘中
  assert.ok(Math.abs(t - U("2026-09-21T07:00:00Z")) <= 60000, `午后盘中应指 15:00 收盘，得 ${new Date(t).toISOString()}`);
  const t2 = nextBoundaryAfter(XSHG, U("2026-09-21T02:00:00Z")); // 北京 10:00 上午盘中
  assert.ok(Math.abs(t2 - U("2026-09-21T03:30:00Z")) <= 60000, `上午盘中应指 11:30 午休，得 ${new Date(t2).toISOString()}`);
  const t3 = nextBoundaryAfter(XSHG, U("2026-09-21T04:00:00Z")); // 北京 12:00 午休
  assert.ok(Math.abs(t3 - U("2026-09-21T05:00:00Z")) <= 60000, `午休应指 13:00 午后开盘，得 ${new Date(t3).toISOString()}`);
});

/* ---- 坏输入：全部收敛，绝不抛 ---- */
test("坏输入不崩溃", () => {
  assert.equal(stateAt(null, new Date()), "CLOSED");
  assert.equal(stateAt(undefined, new Date()), "CLOSED");
  assert.equal(stateAt(XSHG, new Date(NaN)), "CLOSED");
  assert.equal(stateAt(XSHG, null), "CLOSED");
  const badTz = { ...XSHG, tz: "Not/AZone" };
  // 固定周六正午 UTC：时区回退到 UTC 后必然不在盘中（避免时间依赖断言）
  assert.equal(stateAt(badTz, new Date("2026-09-19T12:00:00Z")), "CLOSED");
  const noSessions = { ...XSHG, sessions: {} };
  assert.equal(stateAt(noSessions, new Date()), "CLOSED");
  const badSegs = { ...XSHG, sessions: { 1: [["25:99", "x"]] } };
  assert.equal(stateAt(badSegs, new Date()), "CLOSED");
  assert.equal(typeof nextBoundaryAfter(null, Date.now()), "number");
  assert.equal(formatLocalTime("Not/AZone", new Date()), "--:--");
});

test("zonedClock 基准换算", () => {
  const c = zonedClock(new Date(Date.UTC(2026, 8, 21, 0, 0, 0)), "Asia/Shanghai");
  assert.deepEqual({ w: c.weekday, k: c.dateKey, m: c.minutes }, { w: 1, k: "2026-09-21", m: 480 });
  assert.equal(zonedClock(new Date(NaN), "Asia/Shanghai"), null);
  assert.equal(formatLocalTime("Asia/Shanghai", new Date(Date.UTC(2026, 8, 21, 0, 0, 0))), "08:00");
});
