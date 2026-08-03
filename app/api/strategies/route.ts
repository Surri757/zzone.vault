import { NextResponse } from "next/server";
import { strategies } from "@/lib/mock-data";

export function GET() {
  return NextResponse.json({ strategies });
}
