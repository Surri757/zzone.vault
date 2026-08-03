"use client";

import {
  Activity,
  Banknote,
  CircleDollarSign,
  Gauge,
  Scale,
  ShieldAlert,
  WalletCards
} from "lucide-react";
import type { PortfolioSnapshot } from "@/lib/types";
import { MetricTile } from "@/components/shared/MetricTile";
import { className } from "@/components/shared/util";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const preciseCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const quantity = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0
});

export function PortfolioCore({ snapshot }: { snapshot: PortfolioSnapshot }) {
  return (
    <section id="portfolio" className="ink-section relative z-10 px-4 py-12 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ink-kicker flex items-center gap-2 text-sm text-voltage">
              <WalletCards className="h-4 w-4" aria-hidden="true" />
              PORTFOLIO CORE
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-white sm:text-5xl">
              组合核心
            </h2>
          </div>
          <div className="border border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-white/58">
            LOCAL SIMULATION / SNAPSHOT
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile
            icon={CircleDollarSign}
            label="TOTAL EQUITY"
            value={currency.format(snapshot.totalEquity)}
            tone="text-acid"
          />
          <MetricTile
            icon={Activity}
            label="DAY PNL"
            value={currency.format(snapshot.dayPnl)}
            tone={snapshot.dayPnl >= 0 ? "text-acid" : "text-dangerline"}
          />
          <MetricTile
            icon={ShieldAlert}
            label="RISK EXPOSURE"
            value={percent.format(snapshot.riskExposure)}
            tone="text-amberline"
          />
          <MetricTile
            icon={Gauge}
            label="VAR 95"
            value={currency.format(snapshot.valueAtRisk95)}
            tone="text-dangerline"
          />
          <MetricTile
            icon={Banknote}
            label="AVAILABLE CASH"
            value={currency.format(snapshot.cash)}
            tone="text-cyanline"
          />
          <MetricTile
            icon={Scale}
            label="PORTFOLIO BETA"
            value={snapshot.beta.toFixed(2)}
            tone="text-amberline"
          />
        </div>

        <div className="ink-panel mt-5 overflow-hidden rounded-[8px]">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="font-mono text-xs text-white/68">SIMULATED POSITIONS</h3>
            <p className="mt-1 text-xs text-white/42">本地组合快照，不连接真实券商账户</p>
          </div>

          {snapshot.positions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-white/48">暂无模拟持仓</p>
          ) : (
            <>
              <ul className="divide-y divide-white/[0.07] md:hidden" aria-label="模拟持仓明细">
                {snapshot.positions.map((position) => {
                  const allocationPercent = Math.max(0, Math.min(100, position.allocation * 100));
                  return (
                    <li key={position.assetId} className="px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-mono text-base text-white">{position.symbol}</p>
                          <p className="mt-1 break-words text-xs text-white/48">{position.name}</p>
                        </div>
                        <span
                          className={className(
                            "shrink-0 font-mono text-sm",
                            position.unrealizedPnl >= 0 ? "text-acid" : "text-dangerline"
                          )}
                        >
                          {currency.format(position.unrealizedPnl)}
                        </span>
                      </div>

                      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                        {[
                          ["数量", quantity.format(position.quantity)],
                          ["市值", currency.format(position.marketValue)],
                          ["平均成本", preciseCurrency.format(position.averageCost)],
                          ["标记价格", preciseCurrency.format(position.markPrice)]
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="font-mono text-[11px] text-white/48">{label}</dt>
                            <dd className="mt-1 break-words font-mono text-sm text-white/78">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                          <span className="text-white/48">组合占比</span>
                          <span className="text-white/72">{percent.format(position.allocation)}</span>
                        </div>
                        <div
                          className="mt-2 h-1.5 bg-white/10"
                          role="progressbar"
                          aria-label={`${position.symbol} 组合占比`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(allocationPercent)}
                        >
                          <div
                            className="h-full bg-cyanline"
                            style={{ width: `${allocationPercent}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="hidden overflow-x-auto thin-scrollbar md:block">
                <table className="w-full min-w-[920px] border-collapse text-left">
                  <caption className="sr-only">本地模拟持仓明细</caption>
                  <thead>
                    <tr className="border-b border-white/10 font-mono text-xs text-white/48">
                      <th scope="col" className="px-4 py-3 font-normal">标的</th>
                      <th scope="col" className="px-3 py-3 font-normal">数量</th>
                      <th scope="col" className="px-3 py-3 font-normal">平均成本</th>
                      <th scope="col" className="px-3 py-3 font-normal">标记价格</th>
                      <th scope="col" className="px-3 py-3 font-normal">市值</th>
                      <th scope="col" className="px-3 py-3 font-normal">未实现盈亏</th>
                      <th scope="col" className="px-4 py-3 font-normal">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.positions.map((position) => {
                      const allocationPercent = Math.max(0, Math.min(100, position.allocation * 100));
                      return (
                        <tr key={position.assetId} className="border-b border-white/[0.06] last:border-b-0">
                          <th scope="row" className="px-4 py-4 font-normal">
                            <span className="block font-mono text-white">{position.symbol}</span>
                            <span className="mt-1 block text-xs text-white/48">{position.name}</span>
                          </th>
                          <td className="px-3 py-4 font-mono text-sm text-white/78">
                            {quantity.format(position.quantity)}
                          </td>
                          <td className="px-3 py-4 font-mono text-sm text-white/78">
                            {preciseCurrency.format(position.averageCost)}
                          </td>
                          <td className="px-3 py-4 font-mono text-sm text-white/78">
                            {preciseCurrency.format(position.markPrice)}
                          </td>
                          <td className="px-3 py-4 font-mono text-sm text-white/78">
                            {currency.format(position.marketValue)}
                          </td>
                          <td
                            className={className(
                              "px-3 py-4 font-mono text-sm",
                              position.unrealizedPnl >= 0 ? "text-acid" : "text-dangerline"
                            )}
                          >
                            {currency.format(position.unrealizedPnl)}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex min-w-32 items-center gap-3">
                              <div
                                className="h-1.5 flex-1 bg-white/10"
                                role="progressbar"
                                aria-label={`${position.symbol} 组合占比`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(allocationPercent)}
                              >
                                <div
                                  className="h-full bg-cyanline"
                                  style={{ width: `${allocationPercent}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs text-white/58">
                                {percent.format(position.allocation)}
                              </span>
                            </div>
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
    </section>
  );
}
