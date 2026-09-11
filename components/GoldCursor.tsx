"use client";

import { useEffect, useRef } from "react";

/**
 * 自定义光标：圆点 + 外圈环，hover 可交互元素时放大。
 * tone="gold" 鎏金（默认，模块大厅）；tone="mono" 银白单色（极简封面）。
 * 仅在桌面端（pointer: fine）启用，reduced-motion 下自动隐藏。
 */
export default function GoldCursor({ tone = "gold" }: { tone?: "gold" | "mono" }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const mono = tone === "mono";

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let raf = 0;
    let active = false;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    };

    const onOver = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      active = !!t.closest("a, button, .module-card, .enter-gate");
      ring.classList.toggle("is-active", active);
    };

    const onLeave = () => {
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    };

    const onEnter = () => {
      dot.style.opacity = "1";
      ring.style.opacity = "1";
    };

    const loop = () => {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className={mono ? "gold-cursor cursor-mono" : "gold-cursor"} aria-hidden="true" />
      <div ref={ringRef} className={mono ? "gold-cursor-ring cursor-mono" : "gold-cursor-ring"} aria-hidden="true" />
    </>
  );
}