"use client";

import { useEffect, useRef } from "react";

/**
 * 大厅共享光层 —— 与封面同一盏灯的语法（v7/v8 纪律）：
 *   1) 入场交接：封面过桥的光落到大厅，一道 anamorphic 横条闪 260ms，仅一次
 *   2) hover 扫光：指针进入卡片的瞬间，一道对角金光一次性扫过该卡（300ms），不循环
 *   3) 卡内 specular：指针在卡内移动时，径向金光跟随；停 400ms 后 RAF 完全停止
 *
 * canvas 用 CSS mix-blend-mode: screen 叠在 DOM 之上，光只提亮、永不压暗。
 * reduced-motion / 粗指针：不渲染任何内容。
 */

const GOLD = "245, 215, 110";
const SWEEP_SEC = 0.3;
const IDLE_MS = 400;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function HallLight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (reduced || !fine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 1, H = 1, DPR = 1;
    let raf = 0;
    let running = false;
    let disposed = false;

    /** 入场横条 0..1（-1 表示已播完） */
    let entryT = 0;
    let entryDone = false;
    let entryY = 0;

    /** hover 扫光 */
    let sweepCard: HTMLElement | null = null;
    let sweepT = 0;
    let sweeping = false;

    /** 卡内 specular */
    let hoverCard: HTMLElement | null = null;
    let px = 0, py = 0;
    let lastMoveAt = -1e9;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas!.width = Math.round(W * DPR);
      canvas!.height = Math.round(H * DPR);
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      const title = document.querySelector(".hall-title");
      if (title) {
        const r = title.getBoundingClientRect();
        entryY = r.top + r.height / 2;
      } else {
        entryY = H * 0.38;
      }
    }

    function cardPath(g: CanvasRenderingContext2D, r: DOMRect) {
      const rad = 6;
      g.beginPath();
      if (typeof g.roundRect === "function") {
        g.roundRect(r.left, r.top, r.width, r.height, rad);
      } else {
        g.rect(r.left, r.top, r.width, r.height);
      }
      g.clip();
    }

    function drawEntry(k: number) {
      const half = W * 0.9;
      const cx = W / 2;
      const a = 0.85 * k * k;
      const g = ctx!.createLinearGradient(cx - half, entryY, cx + half, entryY);
      g.addColorStop(0, `rgba(${GOLD}, 0)`);
      g.addColorStop(0.5, `rgba(${GOLD}, ${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${GOLD}, 0)`);
      ctx!.fillStyle = g;
      ctx!.fillRect(cx - half, entryY - 1.5, half * 2, 3);
    }

    function drawSweep(card: HTMLElement, p: number) {
      const r = card.getBoundingClientRect();
      ctx!.save();
      cardPath(ctx!, r);
      const bandX = r.left - r.width * 0.3 + p * r.width * 1.6;
      ctx!.translate(bandX, r.top + r.height / 2);
      ctx!.rotate(-0.18);
      const bw = r.width * 0.14;
      const g = ctx!.createLinearGradient(-bw, 0, bw, 0);
      g.addColorStop(0, `rgba(${GOLD}, 0)`);
      g.addColorStop(0.5, `rgba(${GOLD}, 0.5)`);
      g.addColorStop(1, `rgba(${GOLD}, 0)`);
      ctx!.fillStyle = g;
      ctx!.fillRect(-bw, -r.height, bw * 2, r.height * 2);
      ctx!.restore();
    }

    function drawSpecular(card: HTMLElement) {
      const r = card.getBoundingClientRect();
      ctx!.save();
      cardPath(ctx!, r);
      const rad = Math.max(140, r.width * 0.5);
      const g = ctx!.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(${GOLD}, 0.3)`);
      g.addColorStop(0.55, `rgba(${GOLD}, 0.08)`);
      g.addColorStop(1, `rgba(${GOLD}, 0)`);
      ctx!.fillStyle = g;
      ctx!.fillRect(r.left, r.top, r.width, r.height);
      ctx!.restore();
    }

    let last = performance.now();
    function loop(now: number) {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      let alive = false;
      if (!entryDone) {
        entryT += dt;
        const k = clamp(1 - entryT / 0.26, 0, 1);
        if (k > 0) { drawEntry(k); alive = true; }
        else entryDone = true;
      }
      if (sweeping && sweepCard) {
        sweepT += dt;
        const p = easeInOut(clamp(sweepT / SWEEP_SEC, 0, 1));
        drawSweep(sweepCard, p);
        alive = true;
        if (sweepT >= SWEEP_SEC) { sweeping = false; sweepCard = null; }
      }
      if (hoverCard && now - lastMoveAt < IDLE_MS) {
        drawSpecular(hoverCard);
        alive = true;
      }

      if (alive) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
        ctx!.clearRect(0, 0, W, H);
      }
    }

    function ensureLoop() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      lastMoveAt = performance.now();
      const el = document.elementFromPoint(px, py);
      const card = (el?.closest(".module-card") as HTMLElement) || null;
      if (card !== hoverCard) {
        hoverCard = card;
        if (card) {
          sweepCard = card;
          sweepT = 0;
          sweeping = true;
        }
      }
      ensureLoop();
    };
    const onLeave = () => {
      hoverCard = null;
    };

    resize();
    ensureLoop();
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="hall-light" aria-hidden="true" />;
}
