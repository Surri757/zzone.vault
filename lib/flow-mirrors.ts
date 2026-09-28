import "server-only";

import type { NotesFlowBundle } from "./notes-flow.server";

/**
 * 手记数据镜像层（2026-09-28 定案：东财封本机 IP 期间的稳定供数通道）。
 *
 * 链路：GitHub Actions（.github/workflows/flow-archive.yml）每 5 分钟从
 * 线上 Worker 拉整包 → 孤儿分支 data/flow（latest.json + d/日期.json 定稿档）。
 * 本机读 api.github.com（实测稳定可达；undici 直连 200）——api.cloudflare.com
 * 的 KV 直读作为可选预埋（需要用户签发只读 API Token 后设 env，暂未启用）。
 *
 * 职责边界：镜像只在本机东财双闸（封禁冷却/熔断）关闭、或整包失败时被咨询；
 * 采纳前过完整性校验（series ≥ 12）；采纳后即成为 cached 并落盘存粮——
 * 镜像与存粮共生，不是两套系统。东财恢复由探针驱动自动回主源。
 */

const REPO = "Surri757/zzone.vault";
const BRANCH = "data/flow";
const GH = "https://api.github.com";
const CHECK_THROTTLE_MS = 120_000;

let memoSha = "";
let memoBundle: NotesFlowBundle | null = null;
let memoAt = 0;
let lastCheckAt = 0;

function integrityOk(b: NotesFlowBundle): boolean {
  return Boolean(
    b &&
      typeof b.asOf === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
      Array.isArray(b.series) &&
      b.series.length >= 12 &&
      b.series.every((s) => Array.isArray(s.points) && s.points.length >= 1)
  );
}

async function gh(path: string, accept: string): Promise<string | null> {
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: accept, "User-Agent": "zzone-vault-mirror" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.text();
}

/** 最新镜像：sha 轮询节流 + 内容 memo；无新内容时返回上次 memo（可为 null） */
export async function fetchMirrorLatest(force = false): Promise<NotesFlowBundle | null> {
  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return memoBundle;
  lastCheckAt = now;
  try {
    const commitsText = await gh(
      `/repos/${REPO}/commits?sha=${BRANCH}&per_page=1`,
      "application/vnd.github+json"
    );
    if (!commitsText) return memoBundle;
    const sha = (JSON.parse(commitsText) as Array<{ sha?: string }>)[0]?.sha ?? "";
    if (!sha) return memoBundle;
    if (sha === memoSha && memoBundle) return memoBundle;
    const raw = await gh(
      `/repos/${REPO}/contents/latest.json?ref=${BRANCH}`,
      "application/vnd.github.raw"
    );
    if (!raw) return memoBundle;
    const bundle = JSON.parse(raw) as NotesFlowBundle;
    if (!integrityOk(bundle)) return memoBundle;
    memoSha = sha;
    memoBundle = bundle;
    memoAt = now;
    return bundle;
  } catch {
    return memoBundle;
  }
}

/** 指定交易日的定稿档（d/YYYY-MM-DD.json）；昨日的收盘重演态是冷启动的地板 */
export async function fetchMirrorDay(date: string): Promise<NotesFlowBundle | null> {
  try {
    const raw = await gh(
      `/repos/${REPO}/contents/d/${date}.json?ref=${BRANCH}`,
      "application/vnd.github.raw"
    );
    if (!raw) return null;
    const bundle = JSON.parse(raw) as NotesFlowBundle;
    return integrityOk(bundle) ? bundle : null;
  } catch {
    return null;
  }
}

/** 镜像新鲜度诊断（/api/health 用） */
export function mirrorStatus(): { sha: string; ageMs: number | null } {
  return { sha: memoSha.slice(0, 7), ageMs: memoBundle ? Date.now() - memoAt : null };
}
