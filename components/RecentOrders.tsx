"use client";

import { LockKeyhole } from "lucide-react";
import type { SimulatedOrder } from "@/lib/types";
import { className } from "@/components/shared/util";

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const quantity = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4
});

const orderStatus: Record<
  SimulatedOrder["status"],
  { label: string; tone: string }
> = {
  queued: { label: "排队中 / QUEUED", tone: "text-amberline" },
  accepted: { label: "已接受 / ACCEPTED", tone: "text-acid" },
  simulated: { label: "模拟完成 / SIMULATED", tone: "text-cyanline" },
  rejected: { label: "已拒绝 / REJECTED", tone: "text-dangerline" }
};

function orderTime(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "--";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function RecentOrders({ orders }: { orders: SimulatedOrder[] }) {
  return (
    <section className="ink-section relative z-10 px-4 pb-14 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="ink-panel rounded-[8px] p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="ink-kicker flex items-center gap-2 text-sm text-voltage">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              <span className="font-serif text-white/72">最近模拟订单</span>
            </div>
            <span className="border border-white/10 bg-white/[0.035] px-2.5 py-1.5 font-mono text-xs text-white/58">
              LOCAL SIMULATION
            </span>
          </div>
          <div className="mt-4">
            {orders.length === 0 ? (
              <p className="rounded-[8px] border border-white/10 bg-white/[0.03] p-3 text-sm text-white/46">
                暂无模拟订单
              </p>
            ) : (
              <>
                <ol className="divide-y divide-white/[0.07] border-y border-white/10 md:hidden">
                  {orders.map((order) => {
                    const status = orderStatus[order.status];
                    const notional = order.quantity * order.price;
                    return (
                      <li key={order.id} className="py-4">
                        <article aria-labelledby={`${order.id}-asset`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 id={`${order.id}-asset`} className="break-words font-mono text-base text-white">
                                {order.assetId.toUpperCase()}
                              </h3>
                              <p className="mt-1 break-all font-mono text-[11px] text-white/42">{order.id}</p>
                            </div>
                            <span
                              className={className(
                                "shrink-0 font-mono text-xs",
                                order.side === "buy" ? "text-acid" : "text-dangerline"
                              )}
                            >
                              {order.side === "buy" ? "买入 / BUY" : "卖出 / SELL"}
                            </span>
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                            {[
                              ["数量", quantity.format(order.quantity)],
                              ["模拟价格", preciseCurrency.format(order.price)],
                              ["名义金额", preciseCurrency.format(notional)],
                              ["提交时间", orderTime(order.createdAt)]
                            ].map(([label, value]) => (
                              <div key={label} className="min-w-0">
                                <dt className="font-mono text-[11px] text-white/48">{label}</dt>
                                <dd className="mt-1 break-words font-mono text-sm text-white/76">{value}</dd>
                              </div>
                            ))}
                          </dl>

                          <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-3">
                            <span className="font-mono text-[11px] text-white/48">模拟状态</span>
                            <span className={className("font-mono text-xs", status.tone)}>
                              {status.label}
                            </span>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>

                <div className="hidden overflow-x-auto thin-scrollbar md:block">
                  <table className="w-full min-w-[940px] border-collapse text-left">
                    <caption className="sr-only">最近本地模拟订单</caption>
                    <thead>
                      <tr className="border-y border-white/10 font-mono text-xs text-white/48">
                        <th scope="col" className="px-3 py-3 font-normal">标的 / 订单</th>
                        <th scope="col" className="px-3 py-3 font-normal">方向</th>
                        <th scope="col" className="px-3 py-3 font-normal">数量</th>
                        <th scope="col" className="px-3 py-3 font-normal">模拟价格</th>
                        <th scope="col" className="px-3 py-3 font-normal">名义金额</th>
                        <th scope="col" className="px-3 py-3 font-normal">状态</th>
                        <th scope="col" className="px-3 py-3 font-normal">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => {
                        const status = orderStatus[order.status];
                        return (
                          <tr key={order.id} className="border-b border-white/[0.06] last:border-b-0">
                            <th scope="row" className="px-3 py-4 font-normal">
                              <span className="block font-mono text-sm text-white">
                                {order.assetId.toUpperCase()}
                              </span>
                              <span className="mt-1 block font-mono text-[10px] text-white/42">
                                {order.id}
                              </span>
                            </th>
                            <td
                              className={className(
                                "px-3 py-4 font-mono text-sm",
                                order.side === "buy" ? "text-acid" : "text-dangerline"
                              )}
                            >
                              {order.side === "buy" ? "买入 / BUY" : "卖出 / SELL"}
                            </td>
                            <td className="px-3 py-4 font-mono text-sm text-white/72">
                              {quantity.format(order.quantity)}
                            </td>
                            <td className="px-3 py-4 font-mono text-sm text-white/72">
                              {preciseCurrency.format(order.price)}
                            </td>
                            <td className="px-3 py-4 font-mono text-sm text-white/72">
                              {preciseCurrency.format(order.quantity * order.price)}
                            </td>
                            <td className={className("px-3 py-4 font-mono text-xs", status.tone)}>
                              {status.label}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-white/58">
                              {orderTime(order.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
