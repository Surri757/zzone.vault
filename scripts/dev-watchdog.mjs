#!/usr/bin/env node
/**
 * dev-watchdog —— 本地 dev 服务器的死活看门（2026-09-23 定案）。
 *
 * 背景：dev 服务器曾死过两天无人知晓，用户以为「还是被封」。watchdog 把
 * 「服务器死了」从四种故障（东财抖动/我被封/指纹歧视/服务器死）里独立出来：
 *   · 拉起 npm run dev（stdio 落 dev-server.log）
 *   · 每 30s HEAD /api/health；启动 180s 宽免（next dev 首编译慢）
 *   · 连续 5 败或子进程退出 → 杀树 → 退避重启（30s→60s→…→5min 封顶）
 *   · dev-server.log 超 20MB 轮转
 *   · 事件追加 notes-flow-events.jsonl（与行情事件同一时间线，复盘用）
 *   · Windows msg 通知（零依赖，失败静默）
 *
 * 用法：node scripts/dev-watchdog.mjs   （dev-server.cmd 已改为只跑它）
 */
import { spawn } from "node:child_process";
import { appendFileSync, statSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 3000;
const HEALTH = `http://localhost:${PORT}/api/health`;
const LOG = resolve(ROOT, "dev-server.log");
const EVENTS = resolve(ROOT, "notes-flow-events.jsonl");
const GRACE_MS = 180_000;
const PERIOD_MS = 30_000;
const FAIL_LIMIT = 5;
const LOG_CAP = 20 * 1024 * 1024;

function event(ev, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ev, ...extra });
  try {
    appendFileSync(EVENTS, line + "\n");
  } catch {}
  console.log(`[watchdog] ${line}`);
}

function notify(_msg) {
  /* 家庭版 Windows 无 msg.exe；通知由客户端标题前缀（[断供]/[无服务]）承担 */
}

function rotateLogIfNeeded() {
  try {
    if (statSync(LOG).size > LOG_CAP) {
      renameSync(LOG, `${LOG}.old`);
      event("log-rotate");
    }
  } catch {}
}

let child = null;

/** 直接以 node 拉 next dev（绕开 npm.cmd：Windows 上 spawn .cmd 必须 shell:true，
 *  而 shell 会让 pid 树失控；node 直启既无 shell 问题又便于 taskkill 收树） */
const NEXT_BIN = resolve(ROOT, "node_modules", "next", "dist", "bin", "next");

function startDev() {
  rotateLogIfNeeded();
  event("dev-start");
  const logFd = (() => {
    try {
      const { openSync } = require("node:fs");
      return openSync(LOG, "a");
    } catch {
      return "ignore";
    }
  })();
  child = spawn(process.execPath, [NEXT_BIN, "dev"], {
    cwd: ROOT,
    stdio: ["ignore", logFd === "ignore" ? "ignore" : logFd, logFd === "ignore" ? "ignore" : logFd],
    env: { ...process.env, ZZONE_NEXT_DIST_DIR: "output/next-dev" },
    windowsHide: true,
    shell: false,
  });
  child.on("exit", (code) => {
    event("dev-exit", { code });
    child = null;
    restartSoon("子进程退出");
  });
  return Date.now();
}

let backoff = 30_000;
let restartTimer = null;

function restartSoon(reason) {
  if (restartTimer) return;
  event("watchdog-restart-scheduled", { reason, inMs: backoff });
  notify(`${reason}，${Math.round(backoff / 1000)}s 后重启 dev`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    backoff = Math.min(backoff * 2, 5 * 60_000);
    killTree();
    startDev();
  }, backoff);
}

function killTree() {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  } catch {}
}

async function headHealth() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(HEALTH, { method: "HEAD", signal: ac.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let startedAt = startDev();
let fails = 0;

console.log(`[watchdog] 守护中：HEAD ${HEALTH} 每 ${PERIOD_MS / 1000}s`);
setInterval(async () => {
  if (restartTimer) return; // 已在等重启
  if (Date.now() - startedAt < GRACE_MS) return;
  const ok = await headHealth();
  if (ok) {
    if (fails > 0) event("health-recovered", { afterFails: fails });
    fails = 0;
    backoff = 30_000;
    return;
  }
  fails += 1;
  event("health-fail", { fails });
  if (fails >= FAIL_LIMIT) {
    fails = 0;
    restartSoon(`健康检查连续 ${FAIL_LIMIT} 败`);
  }
}, PERIOD_MS);

process.on("SIGINT", () => {
  event("watchdog-stop");
  killTree();
  process.exit(0);
});
