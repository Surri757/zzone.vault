import { NextResponse } from "next/server";

import { flowHealth } from "@/lib/notes-flow.server";

export const dynamic = "force-dynamic";

/** 进程心跳 + 行情源健康：永不触上游、永不抛错。
 *  watchdog 与人工排查共用：一个答「我活着吗」，flow 段答「东财活着吗」。 */
export async function GET() {
  let flow: ReturnType<typeof flowHealth> | { error: string };
  try {
    flow = flowHealth();
  } catch (e) {
    flow = { error: e instanceof Error ? e.message : "unknown" };
  }
  return NextResponse.json(
    {
      ok: true,
      pid: typeof process !== "undefined" ? process.pid : null,
      uptimeSec: typeof process !== "undefined" ? Math.round(process.uptime()) : null,
      flow,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
