import { NextResponse } from "next/server";
import { fetchStockBars } from "@/lib/historical-bars.server";
import { findStockInstrumentsByIds } from "@/lib/stock-catalog";
import type { StockBarsApiResponse, StockChartPeriod } from "@/lib/stock-bars";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set<StockChartPeriod>([
  "intraday",
  "five-day",
  "daily",
  "monthly",
]);
const MAX_IDS = 5;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawIds = params.get("ids")?.trim();
  const period = (params.get("period")?.trim().toLowerCase() ??
    "intraday") as StockChartPeriod;

  if (!rawIds) {
    return NextResponse.json({ error: "ids parameter is required" }, { status: 400 });
  }

  const ids = [
    ...new Set(
      rawIds
        .split(",")
        .map((id) => id.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "ids must contain at least one stock catalog id" },
      { status: 400 }
    );
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `ids must not contain more than ${MAX_IDS} instrument ids` },
      { status: 400 }
    );
  }
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: `period must be one of: ${[...VALID_PERIODS].join(", ")}` },
      { status: 400 }
    );
  }

  const instruments = findStockInstrumentsByIds(ids);
  if (instruments.length === 0) {
    return NextResponse.json({ error: "no matching instruments found" }, { status: 404 });
  }

  try {
    const results = await Promise.all(
      instruments.map((instrument) => fetchStockBars(instrument, period))
    );
    const payload: StockBarsApiResponse = {
      generatedAt: new Date().toISOString(),
      results,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "stock bars provider failed",
        period,
      },
      { status: 502 }
    );
  }
}
