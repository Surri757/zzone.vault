"use client";

import { FormEvent, useState } from "react";
import {
  Command,
  LoaderCircle,
  LockKeyhole,
  Send,
  ShieldCheck
} from "lucide-react";
import type { Asset, OrderSide, SimulatedOrder } from "@/lib/types";
import { className } from "@/components/shared/util";

type OrderDraft = {
  side: OrderSide;
  assetId: string;
  quantity: string;
};

export function CommandLayer({
  markets,
  onOrderCreated
}: {
  markets: Asset[];
  onOrderCreated: (order: SimulatedOrder) => void;
}) {
  const [draft, setDraft] = useState<OrderDraft>({
    side: "buy",
    assetId: markets[0]?.id ?? "btc",
    quantity: "1"
  });
  const [status, setStatus] = useState("本地模拟队列待命");
  const [submitting, setSubmitting] = useState(false);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("正在写入本地模拟队列");

    try {
      const response = await fetch("/api/sim/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          side: draft.side,
          assetId: draft.assetId,
          quantity: Number(draft.quantity)
        })
      });

      if (!response.ok) {
        throw new Error("order rejected");
      }

      const payload = (await response.json()) as { order: SimulatedOrder };
      onOrderCreated(payload.order);
      setStatus("模拟订单已进入本地队列");
    } catch {
      setStatus("模拟订单未通过本地校验");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="commands" className="ink-section relative z-10 px-4 py-12 sm:px-6 lg:px-10">
      <div className="ink-panel mx-auto max-w-7xl p-4 sm:p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="ink-kicker flex items-center gap-2 text-sm text-cyanline">
              <Command className="h-4 w-4" aria-hidden="true" />
              COMMAND / 05
            </p>
            <h2 className="mt-2 font-serif text-2xl font-semibold text-white sm:text-3xl">
              模拟指令
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <span className="inline-flex min-h-9 items-center gap-2 border border-acid/30 bg-acid/10 px-3 text-acid">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              LOCAL SANDBOX
            </span>
            <span className="inline-flex min-h-9 items-center border border-white/10 px-3 text-white/44">
              NO BROKER LINK
            </span>
          </div>
        </div>

        <form
          onSubmit={submitOrder}
          className="mt-6 grid gap-3 md:grid-cols-[0.72fr_1fr_0.8fr_auto]"
        >
          <div className="grid grid-cols-2 rounded-[8px] border border-white/10 bg-black/30 p-1">
            {(["buy", "sell"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, side }))}
                aria-pressed={draft.side === side}
                className={className(
                  "h-10 rounded-[6px] font-mono text-sm transition",
                  draft.side === side
                    ? side === "buy"
                      ? "bg-acid text-black"
                      : "bg-dangerline text-black"
                    : "text-white/58 hover:text-white"
                )}
              >
                {side.toUpperCase()}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="sr-only">资产</span>
            <select
              value={draft.assetId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, assetId: event.target.value }))
              }
              className="h-12 w-full rounded-[8px] border border-white/10 bg-black/40 px-3 font-mono text-sm text-white"
            >
              {markets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.symbol} / {asset.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="sr-only">数量</span>
            <input
              min="0.0001"
              step="0.0001"
              type="number"
              value={draft.quantity}
              onChange={(event) =>
                setDraft((current) => ({ ...current, quantity: event.target.value }))
              }
              className="h-12 w-full rounded-[8px] border border-white/10 bg-black/40 px-3 font-mono text-sm text-white"
              placeholder="Quantity"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-voltage px-5 font-mono text-sm text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            SIM ORDER
          </button>
        </form>

        <div
          className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-sm text-white/54"
          aria-live="polite"
        >
          <LockKeyhole className="h-4 w-4 text-acid" aria-hidden="true" />
          <span>{status}</span>
          <span className="font-mono text-white/34">NO REAL EXECUTION</span>
        </div>
      </div>
    </section>
  );
}
