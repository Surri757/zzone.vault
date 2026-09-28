"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { siteModules } from "@/lib/site-modules";
import HallLight, { HALL_BOARD_EVENT } from "@/components/HallLight";

/**
 * 模块大厅 —— 封面的九行续写（B 方案：同构封面目录）。
 * 一行一门：静止 35% 银，hover/聚焦点火到 92% + 金色序号 + 共享光层扫光；
 * 进入时该行被光灌满（hall-board 事件 → HallLight flood）后路由。
 */
export default function ModuleHall() {
  const router = useRouter();
  const boardingRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("laser-hall");
    return () => root.classList.remove("laser-hall");
  }, []);

  function board(e: React.MouseEvent, path: string) {
    if (boardingRef.current) return;
    boardingRef.current = true;
    const line = e.currentTarget as HTMLElement;
    line.classList.add("is-boarding");
    window.dispatchEvent(
      new CustomEvent(HALL_BOARD_EVENT, { detail: { rect: line.getBoundingClientRect() } })
    );
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      router.push(path);
      return;
    }
    setTimeout(() => router.push(path), 460);
  }

  return (
    <div className="laser-hall">
      <HallLight />
      <div className="hall-inner">
        <Link href="/" className="hall-back">
          <span>←</span>
          <span>返回封面</span>
        </Link>

        <p className="hall-kicker">Ninglo · Vault of Ink</p>
        <h1 className="hall-title">观墨宝阁</h1>
        <p className="hall-sub">一行一门。已点亮的可以进入，其余正待被写。</p>

        <nav className="hall-index" aria-label="模块目录">
          {siteModules.map((m, i) => {
            const live = m.status === "live";
            const delay = { "--d": `${240 + i * 80}ms` } as React.CSSProperties;
            const inner = (
              <>
                <span className="hl-no">BAY {String(i + 1).padStart(2, "0")}</span>
                <span className="hl-name">{m.title}</span>
                <span className="hl-en">{m.subtitle}</span>
                <span className="hl-state" aria-label={live ? "已点亮" : "待点亮"}>
                  {live ? (
                    <>
                      <i>STANDBY</i>
                      <b>LINKED</b>
                    </>
                  ) : (
                    <i>SEALED</i>
                  )}
                </span>
              </>
            );
            return live ? (
              <Link
                key={m.id}
                href={m.path}
                className="hall-line"
                style={delay}
                aria-label={`进入 ${m.title}`}
                onClick={(e) => {
                  e.preventDefault();
                  board(e, m.path);
                }}
              >
                {inner}
              </Link>
            ) : (
              <div key={m.id} className="hall-line is-sealed" style={delay} aria-disabled="true">
                {inner}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
