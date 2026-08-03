import { NextRequest, NextResponse } from "next/server";
import { findAssetPrice } from "@/lib/mock-data";
import type { SimulatedOrder, SimulatedOrderRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<SimulatedOrderRequest>;

  if (!body.assetId || !body.side || !body.quantity || body.quantity <= 0) {
    return NextResponse.json(
      { error: "Invalid simulated order payload" },
      { status: 400 }
    );
  }

  if (body.side !== "buy" && body.side !== "sell") {
    return NextResponse.json({ error: "Unsupported order side" }, { status: 400 });
  }

  const markPrice = findAssetPrice(body.assetId);

  if (!markPrice) {
    return NextResponse.json({ error: "Unknown asset" }, { status: 404 });
  }

  const order: SimulatedOrder = {
    id: `SIM-${Date.now().toString(36).toUpperCase()}`,
    side: body.side,
    assetId: body.assetId,
    quantity: body.quantity,
    price: body.limitPrice && body.limitPrice > 0 ? body.limitPrice : markPrice,
    status: "simulated",
    createdAt: new Date().toISOString()
  };

  return NextResponse.json({
    order,
    execution: "local-simulation-only"
  });
}
