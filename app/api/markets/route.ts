import { NextResponse } from "next/server";
import { assets } from "@/lib/mock-data";

export function GET() {
  return NextResponse.json({ assets });
}
