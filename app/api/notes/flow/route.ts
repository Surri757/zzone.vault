import { NextResponse } from "next/server";

import { fetchNotesFlow, flowHealth } from "@/lib/notes-flow.server";

export const dynamic = "force-dynamic";

/** X-Flow-Health 语义（客户端与排查共用）：
 *  live=新鲜  stale=陈旧保供中（数据真实但滞后）  blocked=源熔断/封禁冷却且无存粮 */
function flowHeaders(): Record<string, string> {
  try {
    const h = flowHealth();
    const health = h.cacheAgeMs == null ? "blocked" : h.cacheAgeMs > 5 * 60_000 ? "stale" : "live";
    return {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "X-Flow-Health": health,
      "X-Flow-Source": h.source ?? "em",
      "X-Flow-Channel": h.channel,
      "X-Flow-Banned": String(h.banned),
      "X-Flow-Cache-Age": h.cacheAgeMs == null ? "none" : String(Math.round(h.cacheAgeMs / 1000)),
    };
  } catch {
    return { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" };
  }
}

export async function GET() {
  try {
    const bundle = await fetchNotesFlow();
    return NextResponse.json(bundle, { headers: flowHeaders() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "notes flow provider failed",
        health: "blocked",
      },
      { status: 502, headers: flowHeaders() }
    );
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: flowHeaders() });
}
