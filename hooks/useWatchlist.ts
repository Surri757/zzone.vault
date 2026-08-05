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
      if (storedEntries) {
        setEntries(JSON.parse(storedEntries) as WatchlistEntry[]);
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
    setEntries((prev) => prev.filter((e) => e.id !== id));
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
