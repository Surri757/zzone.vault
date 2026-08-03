import { NextResponse } from "next/server";
import {
  exchangeSources,
  marketGroups,
  visualizationLenses
} from "@/lib/market-data-hub";

export function GET() {
  return NextResponse.json({
    mode: "sandbox-adapter-ready",
    exchangeSources,
    marketGroups,
    visualizationLenses
  });
}
