import { NextResponse } from "next/server";
import { getMarketMovers, getSectorHeatmap } from "@/lib/market-overview.server";
import type { StockMarket } from "@/lib/stock-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawMarket = params.get("market")?.trim().toUpperCase();
  const rawType = params.get("type")?.trim().toLowerCase() ?? "movers";
  const rawLimit = params.get("limit")?.trim() ?? "20";

  if (rawMarket !== "CN" && rawMarket !== "US") {
    return NextResponse.json({ error: "market must be CN or US" }, { status: 400 });
  }

  const market = rawMarket as StockMarket;
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(rawLimit)) || 20));

  try {
    if (rawType === "sectors") {
      const response = await getSectorHeatmap(market);
      return NextResponse.json(response, {
        headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
      });
    }

    const response = await getMarketMovers(market, limit);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "market snapshot provider failed",
        market,
        type: rawType,
      },
      { status: 502 }
    );
  }
}
