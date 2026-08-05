"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import { className } from "@/components/shared/util";

interface AsyncPanelProps {
  children: ReactNode;
  error: string | null;
  hasData: boolean;
  header: ReactNode;
  loading: boolean;
  loadingLabel: string;
  minBodyClassName: string;
  onRetry: () => void;
  sourceLabel?: string;
  updatedAt: string | null;
}

function formatTime(value: string | null) {
  if (!value) return "--:--:--";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "--:--:--";
  return timestamp.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function asyncErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "公开行情暂不可用";
}

export function AsyncPanel({
  children,
  error,
  hasData,
  header,
  loading,
  loadingLabel,
  minBodyClassName,
  onRetry,
  sourceLabel = "PUBLIC FEED",
  updatedAt,
}: AsyncPanelProps) {
  const dataTime = formatTime(updatedAt);
  const statusText = loading
    ? `SYNCING / ${sourceLabel} / LAST ${dataTime}`
    : error
      ? `${hasData ? "STALE" : "ERROR"} / ${sourceLabel} / ${error}${hasData ? ` / LAST ${dataTime}` : ""}`
      : `${sourceLabel} / DATA AS OF ${dataTime}`;

  return (
    <section className="rounded-[8px] border border-white/10 bg-[#070807]/8 p-4 shadow-panel-edge backdrop-blur-md">
      {header}

      <div
        className={className(
          "relative mt-4",
          minBodyClassName,
          !hasData && "grid place-items-center"
        )}
      >
        {hasData ? (
          children
        ) : (
          <div className="flex max-w-sm flex-col items-center gap-2 px-4 text-center">
            {loading ? (
              <LoaderCircle className="h-5 w-5 animate-spin text-acid" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-cinnabar" aria-hidden="true" />
            )}
            <p className="text-sm text-white/58">
              {loading ? loadingLabel : "暂时无法读取公开行情"}
            </p>
          </div>
        )}
      </div>

      <div
        className="mt-3 flex min-h-9 items-center justify-between gap-3 border-t border-white/[0.08] pt-3 font-mono text-[10px]"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-center gap-2">
          {loading ? (
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-acid" aria-hidden="true" />
          ) : error ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-cinnabar" aria-hidden="true" />
          ) : (
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-jade" aria-hidden="true" />
          )}
          <span
            className={className(
              "truncate",
              loading ? "text-white/52" : error ? "text-cinnabar" : "text-white/42"
            )}
            title={error ?? undefined}
          >
            {statusText}
          </span>
        </div>

        {error && (
          <button
            type="button"
            onClick={onRetry}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-cinnabar/45 bg-cinnabar/[0.08] text-cinnabar transition hover:border-cinnabar/75 hover:bg-cinnabar/[0.14] disabled:cursor-wait disabled:opacity-50"
            aria-label="重试公开行情"
            title="重试公开行情"
            disabled={loading}
          >
            <RefreshCw className={className("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
