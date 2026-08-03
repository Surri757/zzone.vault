import { NextResponse } from "next/server";
import {
  STOCK_CATALOG_PAGE_SIZE_MAX,
  searchStockCatalog,
  type StockMarket
} from "@/lib/stock-catalog";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number, name: string, maximum?: number) {
  if (value === null || value === "") return { value: fallback };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { error: `${name} must be a positive integer` };
  }
  if (maximum !== undefined && parsed > maximum) {
    return { error: `${name} must not exceed ${maximum}` };
  }

  return { value: parsed };
}

export function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const rawMarket = parameters.get("market")?.trim().toUpperCase();
  if (rawMarket && rawMarket !== "CN" && rawMarket !== "US") {
    return NextResponse.json({ error: "market must be CN or US" }, { status: 400 });
  }

  const page = positiveInteger(parameters.get("page"), 1, "page");
  if (page.error) return NextResponse.json({ error: page.error }, { status: 400 });

  const pageSize = positiveInteger(
    parameters.get("pageSize"),
    30,
    "pageSize",
    STOCK_CATALOG_PAGE_SIZE_MAX
  );
  if (pageSize.error) return NextResponse.json({ error: pageSize.error }, { status: 400 });

  const q = parameters.get("q")?.trim() ?? "";
  if (q.length > 120) {
    return NextResponse.json({ error: "q must not exceed 120 characters" }, { status: 400 });
  }

  const response = searchStockCatalog({
    market: rawMarket as StockMarket | undefined,
    exchange: parameters.get("exchange")?.trim() || undefined,
    q,
    page: page.value,
    pageSize: pageSize.value
  });

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600"
    }
  });
}
