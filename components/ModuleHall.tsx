"use client";

import { useEffect } from "react";
import Link from "next/link";
import { siteModules } from "@/lib/site-modules";

/**
 * 鎏金模块大厅 —— Enter 后的功能选择页。
 * 观墨（live）可进入 /quant，其余 sealed 占位锁定。
 * 卡片 3D tilt 跟随光标，发光随鼠标位置移动。
 */
export default function ModuleHall() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("laser-hall");
    return () => root.classList.remove("laser-hall");
  }, []);

  // 卡片 tilt + 发光跟随
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".module-card"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = (e.clientX - cx) / (r.width / 2);
        const dy = (e.clientY - cy) / (r.height / 2);
        const rx = dy * -6;
        const ry = dx * 9;
        const mx = ((e.clientX - r.left) / r.width) * 100;
        const my = ((e.clientY - r.top) / r.height) * 100;
        card.style.setProperty("--mx", `${mx}%`);
        card.style.setProperty("--my", `${my}%`);
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
      }
    };
    const onLeave = () => {
      for (const card of cards) card.style.transform = "";
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div className="laser-hall">
      <div className="hall-grain" />
      <div className="hall-inner">
        <Link href="/" className="hall-back">
          <span>←</span>
          <span>返回封面</span>
        </Link>

        <p className="hall-kicker">Zz.one · Vault of Ink</p>
        <h1 className="hall-title">
          观墨<span className="gold">宝阁</span>
        </h1>
        <p className="hall-sub">
          每一扇门都是一件法器。选择你欲探的模块 —— 金色之门已为君开，墨色之门正待点亮。
        </p>

        <div className="hall-grid">
          {siteModules.map((m) => {
            const Icon = m.icon;
            const live = m.status === "live";
            const body = (
              <>
                <span className={`mc-status ${live ? "is-live" : "is-sealed"}`}>
                  {live ? "已点亮" : "即将点亮"}
                </span>
                <div className="mc-icon">
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <div className="mc-title">{m.title}</div>
                <div className="mc-sub">{m.subtitle}</div>
                <p className="mc-desc">{m.description}</p>
              </>
            );
            return live ? (
              <Link
                key={m.id}
                href={m.path}
                aria-label={`进入 ${m.title}`}
                className="module-card"
              >
                {body}
              </Link>
            ) : (
              <div key={m.id} className="module-card is-sealed">
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}