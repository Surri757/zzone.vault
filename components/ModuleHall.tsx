"use client";

import { useEffect } from "react";
import Link from "next/link";
import { siteModules } from "@/lib/site-modules";
import HallLight from "@/components/HallLight";

/**
 * 鎏金模块大厅 —— Enter 后的功能选择页。
 * 观墨（live）可进入 /quant，其余 sealed 占位锁定。
 * 光的行为（交接横条 / hover 扫光 / 卡内 specular）由 HallLight 统一负责；
 * 卡片入场错峰由 --d 变量驱动（组间 80ms）。
 */
export default function ModuleHall() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("laser-hall");
    return () => root.classList.remove("laser-hall");
  }, []);

  return (
    <div className="laser-hall">
      <div className="hall-grain" />
      <HallLight />
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
          {siteModules.map((m, i) => {
            const Icon = m.icon;
            const live = m.status === "live";
            const delay = { "--d": `${320 + i * 80}ms` } as React.CSSProperties;
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
                style={delay}
              >
                {body}
              </Link>
            ) : (
              <div key={m.id} className="module-card is-sealed" style={delay}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
