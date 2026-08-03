"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#030403",
          color: "#e5ddca",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ width: "min(90vw, 560px)", textAlign: "center" }}>
          <TriangleAlert
            size={28}
            color="#df6b55"
            aria-hidden="true"
            style={{ marginInline: "auto" }}
          />
          <p
            style={{
              marginTop: 20,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              color: "#df6b55",
            }}
          >
            SYSTEM RECOVERY
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: 30 }}>界面需要重新载入</h1>
          <p style={{ margin: "16px auto 0", maxWidth: 430, lineHeight: 1.8, color: "#b8b3a6" }}>
            顶层界面未能完成初始化。本地数据不会因重新载入而被提交到外部系统。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              marginTop: 28,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid rgba(127,183,163,.55)",
              borderRadius: 6,
              padding: "10px 16px",
              background: "rgba(127,183,163,.1)",
              color: "#7fb7a3",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            重新载入
          </button>
        </main>
      </body>
    </html>
  );
}
