"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  Eye,
  EyeOff,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { LiveQuote } from "@/lib/live-instruments";
import { className, formatQuoteNumber } from "@/components/shared/util";
import type { WatchlistAlert, WatchlistEntry } from "@/hooks/useWatchlist";
import { marketChangeText } from "@/lib/market-colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WatchlistPanelProps {
  entries: WatchlistEntry[];
  onRemove: (id: string) => void;
  onSelect: (entry: WatchlistEntry) => void;
  alerts: WatchlistAlert[];
  onClearAlert: (id: string) => void;
  /** Live quotes for watchlist entries (fetched by parent) */
  quotes: Map<string, LiveQuote>;
  /** Navigate to the stock catalog to add entries (used by the empty state) */
  onOpenCatalog?: () => void;
}

// ---------------------------------------------------------------------------
// Alert check logic
// ---------------------------------------------------------------------------

function checkAlertTriggered(
  alert: WatchlistAlert,
  quote: LiveQuote | undefined
): boolean {
  if (!quote) return false;
  const price = quote.price;
  const volume = quote.volume;
  const changePct = quote.changePct;

  switch (alert.condition) {
    case "price-above":
      return price !== null && price >= alert.threshold;
    case "price-below":
      return price !== null && price <= alert.threshold;
    case "volume-above":
      return volume !== null && volume >= alert.threshold;
    case "change-above":
      return changePct !== null && changePct >= alert.threshold;
    case "change-below":
      return changePct !== null && changePct <= alert.threshold;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WatchlistPanel({
  entries,
  onRemove,
  onSelect,
  alerts,
  onClearAlert,
  quotes,
  onOpenCatalog,
}: WatchlistPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const triggeredAlertIds = useMemo(() => {
    const triggered = new Set<string>();
    for (const alert of alerts) {
      const matched = entries.find((e) => alert.id.startsWith(e.id));
      if (matched) {
        const q = quotes.get(matched.id);
        if (checkAlertTriggered(alert, q)) {
          triggered.add(alert.id);
        }
      }
    }
    return triggered;
  }, [alerts, quotes, entries]);

  const activeAlertCount = triggeredAlertIds.size;

  if (entries.length === 0 && alerts.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-white/10 bg-[#070807]/8 p-4 shadow-panel-edge backdrop-blur-md">
        <div className="flex items-center gap-2 text-sm text-white/48">
          <Star className="h-4 w-4 text-acid/70" aria-hidden="true" />
          <span>自选列表为空</span>
        </div>
        <p className="mt-3 max-w-md text-xs leading-relaxed text-white/38">
          在「个股 OHLCV」目录中点击任意股票卡片上的星标，即可把它加入自选，实时跟踪涨跌与价格。
        </p>
        {onOpenCatalog && (
          <button
            type="button"
            onClick={onOpenCatalog}
            className="mt-4 inline-flex items-center gap-2 rounded-[6px] border border-acid/40 bg-acid/[0.08] px-3 py-1.5 text-xs font-medium text-acid transition hover:border-acid/70 hover:bg-acid/[0.14]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            去个股页添加自选
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-white/10 bg-[#070807]/8 p-4 shadow-panel-edge backdrop-blur-md">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-white/52 hover:text-acid transition"
            aria-label={collapsed ? "展开自选" : "收起自选"}
            title={collapsed ? "展开自选" : "收起自选"}
          >
            {collapsed ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <span className="font-mono text-sm text-white">WATCHLIST</span>
          <span className="font-mono text-xs text-white/36">
            {entries.length} stocks
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeAlertCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-[6px] border border-dangerline/40 bg-dangerline/10 px-2 py-0.5 font-mono text-[10px] text-dangerline">
              <BellRing className="h-3 w-3" aria-hidden="true" />
              {activeAlertCount} alerts
            </span>
          )}
          <Bell className="h-4 w-4 text-white/28" aria-hidden="true" />
        </div>
      </div>

      {!collapsed && (
        <div className="mt-4 grid gap-1.5">
          {entries.map((entry) => {
            const quote = quotes.get(entry.id);
            const changePct = quote?.changePct;
            const hasChange =
              typeof changePct === "number" && Number.isFinite(changePct);
            const market = entry.id.startsWith("US:") ? "US" : "CN";

            return (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-[6px] border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04] transition"
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                  aria-label={`打开 ${entry.name} ${entry.symbol} K 线`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-white">{entry.symbol}</span>
                      <span className="truncate text-[10px] text-white/42">
                        {entry.name.slice(0, 20)}
                      </span>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs text-white/72">
                      {formatQuoteNumber(quote?.price, 4)}
                    </span>
                    <span
                      className={className(
                        "min-w-[4.5rem] text-right font-mono text-xs",
                        hasChange ? marketChangeText(market, changePct) : "text-white/32"
                      )}
                    >
                      {hasChange
                        ? `${changePct > 0 ? "+" : ""}${formatQuoteNumber(changePct, 2)}%`
                        : "--"}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  className="ml-2 grid h-9 w-9 shrink-0 place-items-center text-white/28 transition hover:text-dangerline"
                  aria-label={`移除 ${entry.symbol} 自选`}
                  title="移除自选"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
