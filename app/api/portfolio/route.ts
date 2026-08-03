import { NextResponse } from "next/server";
import { portfolio } from "@/lib/mock-data";

export function GET() {
  return NextResponse.json({ portfolio });
}
