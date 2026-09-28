import { NextResponse } from "next/server";

import { getAtlasSignals } from "@/lib/atlas-signals.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getAtlasSignals();
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
