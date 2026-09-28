import "server-only";

/**
 * 上游行情源的防封卫士 —— 2026-09-21 三连断供事故的机构化收口。
 *
 *   熔断   连续失败按指数退避闭闸（2min→4→8→…→30min 封顶），
 *          绝不在已知被拒的窗口里继续撞墙——事故当晚每次轮询都在拿
 *          20 个失败请求喂封禁，熔断后才算真正止血。
 *   冷启动 最后好包跨进程/跨隔离体保活：Node dev 落盘（tmp+rename 原子写），
 *          workerd 用 Cache API（caches.default 跨隔离体存活）——
 *          部署/重启后的第一眼就能陈旧保供，而不是 502 裸奔等东财回魂。
 *
 * 粒度是「整包」：一次 bundle 尝试内部的主机梯子与批间节奏由调用方自理；
 * 本模块只回答三个问题——现在能不能发、这次成没成、断电后存粮在哪。
 *
 * 边界（要诚实）：undici 的 TLS 指纹伪装不成浏览器，防封模块保证的是
 * 「不火上浇油 + 断供有存粮 + 恢复无缝续上」，不保证永不被封。
 */

export interface UpstreamGuardOptions {
  /** 连续失败几次后开始熔断 */
  failureThreshold: number;
  /** 熔断基础冷却，随继续失败指数翻倍 */
  cooldownMs: number;
  /** 冷却上限 */
  maxCooldownMs: number;
}

export class UpstreamGuard {
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly opts: UpstreamGuardOptions) {}

  /** 熔断开启中：调用方不应发任何上游请求，直接走陈旧保供/报错路径。
   *  冷却到期自动呈「半开」——放行下一次尝试作为试探。 */
  get blocked(): boolean {
    return Date.now() < this.openUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) {
      const exp = this.failures - this.opts.failureThreshold;
      const cd = Math.min(this.opts.cooldownMs * 2 ** exp, this.opts.maxCooldownMs);
      this.openUntil = Date.now() + cd;
    }
  }

  status(): { failures: number; openUntil: number } {
    return { failures: this.failures, openUntil: this.openUntil };
  }
}

/* ---------------- 最后好包的冷启动保活 ---------------- */

interface LastGood<T> {
  at: number;
  payload: T;
}

/** workerd 的 Cache API 键（永不会被真正 fetch，只作 caches.default 的存取键） */
const PERSIST_KEY = "https://vault.local/upstream/notes-flow-last-good";
const PERSIST_FILE = ".notes-flow-last-good.json";

/** 写存粮：workerd 走 Cache API + KV 镜像（本机可经 api.cloudflare.com 直读 KV，
 *  绕开 workers.dev 封锁——需用户签发只读 Token 后启用读侧），Node 走落盘。
 *  失败静默——保活不伤主流程。 */
export async function persistLastGood<T>(payload: T): Promise<void> {
  const body = JSON.stringify({ at: Date.now(), payload } satisfies LastGood<T>);
  try {
    const cdn = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
    if (cdn?.default) {
      await Promise.all([
        cdn.default.put(PERSIST_KEY, new Response(body, { headers: { "Cache-Control": "public, max-age=86400" } })),
        putKvMirror(body),
      ]);
      return;
    }
    const { writeFileSync, renameSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tmp = `${PERSIST_FILE}.tmp`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, join(process.cwd(), PERSIST_FILE));
  } catch {
    /* 存粮失败不影响行情主流程 */
  }
}

/** KV 镜像（workerd）：同一 key 幂等覆盖，免费档 1000 写/日内（240 分钟/日 ≪ 限额） */
async function putKvMirror(body: string): Promise<void> {
  try {
    const mod = (await import("@opennextjs/cloudflare")) as {
      getCloudflareContext?: () => { env?: { NS_FLOW?: { put: (key: string, value: string) => Promise<unknown> } } };
    };
    const env = mod.getCloudflareContext?.().env;
    await env?.NS_FLOW?.put("flow:latest", body);
  } catch {
    /* KV 写失败静默：GitHub 中继仍在 */
  }
}

/** 读存粮：过期（maxAgeMs）或不存在返回 null。 */
export async function loadLastGood<T>(maxAgeMs: number): Promise<LastGood<T> | null> {
  try {
    const cdn = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
    const raw = cdn?.default
      ? await (await cdn.default.match(PERSIST_KEY))?.text()
      : await readPersistFile();
    if (!raw) return null;
    const last = JSON.parse(raw) as LastGood<T>;
    if (typeof last?.at !== "number" || !last.payload || Date.now() - last.at > maxAgeMs) return null;
    return last;
  } catch {
    return null;
  }
}

async function readPersistFile(): Promise<string | null> {
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(process.cwd(), PERSIST_FILE), "utf8");
  } catch {
    return null;
  }
}
