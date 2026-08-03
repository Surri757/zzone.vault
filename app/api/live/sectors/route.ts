import { NextResponse } from "next/server";
import { getSectorStrength } from "@/lib/market-overview.server";
import type { StockMarket } from "@/lib/stock-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawMarket = new URL(request.url).searchParams
    .get("market")
    ?.trim()
    .toUpperCase();

  if (rawMarket !== "CN" && rawMarket !== "US") {
    return NextResponse.json(
      { error: "market must be CN or US" },
      { status: 400 }
    );
  }

  const market = rawMarket as StockMarket;

  try {
    const response = await getSectorStrength(market);
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "sector strength provider failed",
        market,
      },
      { status: 502 }
    );
  }
}
