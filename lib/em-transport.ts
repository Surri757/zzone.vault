import "server-only";

/**
 * 东财统一传输层 —— 2026-09-23 五路子代深讨+开源调研的定案产物。
 *
 * 事故链（全部实测）：本家宽 IP 被 push2 集群按 IP 级封禁（~48h TTL）后进入缓刑态，
 * 而 undici 的 TLS 指纹在该路径被网关单独歧视（同刻 curl 200、undici UND_ERR_SOCKET）；
 * 更糟的是「被拒的请求本身继续计分」——缓刑态下一次 undici 整包突发（~20 请求）
 * 几分钟内让整个 IP 回到全封。结论：**指纹是身份，量是量刑；undici 在这条路上
 * 任何量级都不安全**（社区佐证：efinance #216 2025-04 起东财按 IP 限频、
 * akshare #6100/#6613/#7119 封 IP 与验证码挑战）。
 *
 * 三通道一卫士：
 *   workerd  → 原生 fetch（线上出口健康，不动）
 *   Node/win → Git 自带 OpenSSL curl（指纹=全网 Linux curl，实测放行；
 *              System32 的 Schannel curl 指纹会被东财单独歧视——2026-09-28 实测修正）
 *   其余环境 → undici 兜底
 *   卫士     → 全局令牌桶（跨模块共享的东财请求最小间隔）+ IP 封禁判定与
 *              冷却（reset 族失败 → 判封禁，冷却内所有模块零请求，绝不再喂食）
 *
 * 命名：em = eastmoney。所有对东财的 HTTP 一律经 fetchEast()。
 */

export type EmFailKind = "reset" | "connfail" | "timeout" | "http" | "parse" | "spawn";

export class EmTransportError extends Error {
  constructor(
    readonly kind: EmFailKind,
    readonly httpStatus: number | null,
    message: string
  ) {
    super(message);
    this.name = "EmTransportError";
  }
}

/* ---------------- 运行环境与 curl 定位（模块加载时一次定型） ---------------- */

const isWorkerd =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

const IS_WIN = typeof process !== "undefined" && process.platform === "win32";

/** curl 选型（2026-09-28 实测修正）：Schannel 指纹（System32 curl）在东财网关被单独歧视
 *  ——同刻 OpenSSL 指纹 200、Schannel 首发即重置；OpenSSL 指纹=全网 Linux curl，量大管饱。
 *  顺序：Git 自带 OpenSSL curl → 标准 Git 路径 → System32 Schannel（兜底）→ PATH。 */
const CURL_CANDIDATES = IS_WIN
  ? [
      "D:\\Git\\Git\\mingw64\\bin\\curl.exe",
      "C:\\Program Files\\Git\\mingw64\\bin\\curl.exe",
      "C:\\Program Files (x86)\\Git\\mingw64\\bin\\curl.exe",
      "C:\\Windows\\System32\\curl.exe",
    ]
  : [];

let curlBin: string | null = null;
if (!isWorkerd) {
  try {
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    curlBin = CURL_CANDIDATES.find((c) => existsSync(c)) ?? "curl";
  } catch {
    curlBin = "curl";
  }
}

/** 传输通道名（诊断用） */
export const emChannel: "workerd-fetch" | "win-curl" | "undici" = isWorkerd
  ? "workerd-fetch"
  : curlBin
    ? "win-curl"
    : "undici";

/* ---------------- 全局令牌桶：东财请求最小间隔（跨模块） ---------------- */

const GLOBAL_MIN_GAP_MS = 1200;
let lastEmReqAt = 0;
let gapChain: Promise<void> = Promise.resolve();

function paced<T>(job: () => Promise<T>): Promise<T> {
  const run = gapChain.then(async () => {
    const wait = Math.max(0, lastEmReqAt + GLOBAL_MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastEmReqAt = Date.now();
  });
  gapChain = run.then(
    () => undefined,
    () => undefined
  );
  return run.then(job);
}

/* ---------------- IP 封禁冷却：reset 族失败 → 全局闭闸 ---------------- */

/**
 * 「被拒的请求本身计分」——缓刑态 IP 被突发秒级再封的实测结论。
 * reset/connfail 判为 IP 封禁信号，冷却期内任何模块零东财请求。
 * 基础 30min，连续判封翻倍，封顶 24h（对齐东财 ~48h 封禁的一半观察窗）。
 */
let banUntil = 0;
let banStreak = 0;
const BAN_BASE_MS = 30 * 60_000;
const BAN_CAP_MS = 24 * 60 * 60_000;

export function emBanned(): boolean {
  return Date.now() < banUntil;
}

export function emBanRetryInMs(): number {
  return Math.max(0, banUntil - Date.now());
}

function recordResetLike(): void {
  banStreak += 1;
  const cd = Math.min(BAN_BASE_MS * 2 ** (banStreak - 1), BAN_CAP_MS);
  banUntil = Date.now() + cd;
}

function recordHealthy(): void {
  banStreak = 0;
}

/* ---------------- curl 子进程实现（win-curl 通道） ---------------- */

const EM_HEADERS = [
  "Accept: application/json, text/plain, */*",
  "Referer: https://quote.eastmoney.com/",
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

async function curlJson(url: string, timeoutMs: number): Promise<unknown> {
  const { execFile } = await import("node:child_process");
  const args = [
    "-sS",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "--connect-timeout",
    "5",
    "-w",
    "\n%{http_code}",
    ...EM_HEADERS.map((h) => ["-H", h]).flat(),
    url,
  ];
  return new Promise<unknown>((resolve, reject) => {
    execFile(curlBin!, args, { maxBuffer: 12 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        // execFile 的 code：进程退出码（数字）或 spawn 失败名（ENOENT 等）
        const code = Number((err as NodeJS.ErrnoException & { code?: number | string }).code);
        // curl 退出码：56=连接被重置 7=连不上 28=超时
        if (code === 56) return reject(new EmTransportError("reset", null, "curl reset (56)"));
        if (code === 7) return reject(new EmTransportError("connfail", null, "curl connect fail (7)"));
        if (code === 28) return reject(new EmTransportError("timeout", null, "curl timeout (28)"));
        return reject(new EmTransportError("spawn", null, `curl ${code || code === 0 ? code : "?"}: ${stderr}`));
      }
      const out = String(stdout);
      const nl = out.lastIndexOf("\n");
      const status = parseInt(out.slice(nl + 1).trim(), 10);
      const body = out.slice(0, nl);
      if (status >= 400) return reject(new EmTransportError("http", status, `eastmoney ${status}`));
      try {
        recordHealthy();
        resolve(JSON.parse(body));
      } catch {
        reject(new EmTransportError("parse", status, "非 JSON 响应"));
      }
    });
  });
}

/* ---------------- 对外唯一入口 ---------------- */

export async function fetchEast(url: string, timeoutMs = 8000): Promise<unknown> {
  if (emBanned()) {
    throw new EmTransportError(
      "reset",
      null,
      `IP 封禁冷却中（${Math.ceil(emBanRetryInMs() / 60000)}min 后探针）`
    );
  }
  return paced(async () => {
    if (isWorkerd) {
      // 线上出口：原生 fetch 一直健康（带全套浏览器头）
      try {
        const res = await fetch(url, {
          cache: "no-store",
          headers: {
            Accept: EM_HEADERS[0],
            Referer: EM_HEADERS[1],
            "User-Agent": EM_HEADERS[2],
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          if (res.status >= 520 && res.status <= 524) {
            throw new EmTransportError("http", res.status, `eastmoney ${res.status}`);
          }
          throw new EmTransportError("http", res.status, `eastmoney ${res.status}`);
        }
        recordHealthy();
        return await res.json();
      } catch (e) {
        if (e instanceof EmTransportError) throw e;
        const cause = (e as { cause?: { code?: string } }).cause?.code ?? "";
        if (cause.startsWith("UND_ERR") || cause === "ECONNRESET" || cause === "EPIPE") {
          recordResetLike(); // 出口被拒也按封禁冷却处理（保护上游，也保护自己）
          return Promise.reject(new EmTransportError("reset", null, cause));
        }
        if (cause === "ETIMEDOUT" || (e instanceof Error && e.name === "TimeoutError")) {
          return Promise.reject(new EmTransportError("timeout", null, cause || "timeout"));
        }
        return Promise.reject(new EmTransportError("connfail", null, String(cause || e)));
      }
    }
    if (curlBin) {
      try {
        return await curlJson(url, timeoutMs);
      } catch (e) {
        if (e instanceof EmTransportError && (e.kind === "reset" || e.kind === "connfail")) {
          recordResetLike();
        }
        throw e;
      }
    }
    // 非 Windows Node 兜底：undici（指纹风险自负，仅开发兜底）
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Referer: EM_HEADERS[1], "User-Agent": EM_HEADERS[2] },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new EmTransportError("http", res.status, `eastmoney ${res.status}`);
    return res.json();
  });
}

/** 廉价探针：clist 族最小请求（pz=1 单字段单榜单）。只判「通/不通」。
 *  探针与恢复流量同通道（fetchEast），被拒即延长封禁冷却。 */
export async function probeEast(): Promise<boolean> {
  try {
    const p = await fetchEast(
      "https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=1&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m%3A90%2Bt%3A2&fields=f12",
      5000
    );
    const rows = (p as { data?: { diff?: unknown } })?.data?.diff;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
