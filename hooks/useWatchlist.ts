"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StockInstrument } from "@/lib/stock-catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  id: string; // StockInstrument ID (e.g. "CN:XSHG:600519")
  symbol: string;
  name: string;
  addedAt: string; // ISO timestamp
}

export interface WatchlistAlert {
  id: string;
  symbol: string;
  condition: "price-above" | "price-below" | "volume-above" | "change-above" | "change-below";
  threshold: number;
  triggered: boolean;
  triggeredAt?: string;
}

const WATCHLIST_STORAGE_KEY = "zzone-vault-watchlist";
const ALERTS_STORAGE_KEY = "zzone-vault-alerts";
// 用户主动删光自选后置位，避免下次访问再次自动补种默认示例自选。
const WATCHLIST_DISMISSED_KEY = "zzone-vault-watchlist-dismissed";

// 首次访问时播种的默认示例自选，让观势页自选面板不至于空得像死胡同。
// 用户一旦真正添加过自选，将以用户数据为准，不再重复播种。
const DEFAULT_WATCHLIST: Array<Pick<WatchlistEntry, "id" | "symbol" | "name">> = [
  { id: "CN:XSHG:600519", symbol: "600519", name: "贵州茅台" },
  { id: "CN:XSHE:300750", symbol: "300750", name: "宁德时代" },
  { id: "CN:XSHE:000001", symbol: "000001", name: "平安银行" },
  { id: "US:XNAS:NVDA", symbol: "NVDA", name: "NVIDIA" },
  { id: "US:XNAS:MSFT", symbol: "MSFT", name: "Microsoft" },
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWatchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const storedEntries = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      const storedAlerts = localStorage.getItem(ALERTS_STORAGE_KEY);
      // 用户主动删光过自选则置位该标记，之后不再自动补种默认示例。
      const dismissed = localStorage.getItem(WATCHLIST_DISMISSED_KEY) === "1";
      // 只要没有已保存的自选（未访问过，或旧版留下的空数组 []），都播种默认示例，
      // 让修复前访问过的旧访客也能补上默认自选，避免观势页自选面板空落落。
      let parsed: WatchlistEntry[] | null = null;
      if (storedEntries) {
        try {
          parsed = JSON.parse(storedEntries) as WatchlistEntry[];
        } catch {
          parsed = null;
        }
      }
      if (parsed && parsed.length > 0) {
        setEntries(parsed);
        // 用户已有真实自选，清除“已删除”标记，重置补种状态。
        localStorage.removeItem(WATCHLIST_DISMISSED_KEY);
      } else if (dismissed) {
        // 用户主动删光过自选，尊重其选择，保持为空。
        setEntries([]);
      } else {
        const now = new Date().toISOString();
        setEntries(
          DEFAULT_WATCHLIST.map((item) => ({ ...item, addedAt: now }))
        );
      }
      setAlerts(storedAlerts ? (JSON.parse(storedAlerts) as WatchlistAlert[]) : []);
    } catch {
      setEntries([]);
      setAlerts([]);
    } finally {
      setStorageReady(true);
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or unavailable
    }
  }, [entries, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      // Storage full or unavailable
    }
  }, [alerts, storageReady]);

  const watchlistIds = useMemo(() => entries.map((e) => e.id), [entries]);

  const add = useCallback((instrument: StockInstrument) => {
    setEntries((prev) => {
      if (prev.some((e) => e.id === instrument.id)) return prev;
      return [
        ...prev,
        {
          id: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          addedAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (next.length === 0) {
        // 最后一次删除：标记为用户已主动清空，之后不再自动补种默认示例。
        try {
          localStorage.setItem(WATCHLIST_DISMISSED_KEY, "1");
        } catch {
          // Storage unavailable
        }
      }
      return next;
    });
  }, []);

  const isWatched = useCallback(
    (id: string) => entries.some((e) => e.id === id),
    [entries]
  );

  const addAlert = useCallback((alert: Omit<WatchlistAlert, "triggered">) => {
    setAlerts((prev) => [
      ...prev,
      { ...alert, triggered: false },
    ]);
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearTriggered = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, triggered: false } : a))
    );
  }, []);

  return {
    entries,
    watchlistIds,
    add,
    remove,
    isWatched,
    alerts,
    addAlert,
    removeAlert,
    clearTriggered,
  };
}
