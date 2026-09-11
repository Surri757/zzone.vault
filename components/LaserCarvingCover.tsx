"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 激光点火封面（v7 —— 机器 · 相机 · 重音）
 *
 * 时间轴与几何解耦，跨设备恒定 ~3.0s：
 *   0         首帧给出"未点亮蓝图"（轮廓 16% + 填充 5%），画布处于失焦态 scale(1.02)/blur(3px)
 *   0–0.70s   一束激光自顶垂下，沿轮廓一次扫过；熔池过曝余晖 + 1/4 降采样 bloom
 *   0.70s     熄刀：光束与光斑 120ms 内熄灭，anamorphic 横条闪 260ms
 *   0.70–1.26s 静默：熔池冷却回银
 *   1.26–2.16s 显影高潮：金属填充 900ms 扫入；同时画布 rack-focus 到 scale(1)/blur(0)
 *   2.16–2.96s 重音：横条 bookend + 一次整体光呼吸（300ms）
 *   2.16s+    UI 错峰浮现（0/150/300ms），RAF 停止；仅光标 specular 按需唤醒
 *
 * 任意 pointerdown / keydown / wheel 立即跳到终态。reduced-motion 直接终态。
 */

const EN_TEXT = "Welcome to Ninglo's World.";
const FONT_URL = "/inter-600-subset.ttf";

const T_ENGRAVE = 0.7;
const T_KILL = 0.26;
const T_COOL = 0.3;
const T_REVEAL = 0.9;
const T_CLIMAX = 0.8;
/** 熔池余晖衰减长度（像素）：激光头后方仍过曝的距离 */
const MOLTEN_PX = 64;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Newton 迭代求解 cubic-bezier，保证与 CSS 曲线逐帧一致 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-5) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return sampleY(clamp(t, 0, 1));
  };
}

const easeEngrave = cubicBezier(0.42, 0, 0.58, 1);
const easeReveal = cubicBezier(0.32, 0.72, 0, 1);

/** 采样一段贝塞尔/直线为密集点列 */
function samplePathCommands(
  commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[],
  tolerance: number
): { x: number; y: number; penUp: boolean }[] {
  const pts: { x: number; y: number; penUp: boolean }[] = [];
  let cx = 0, cy = 0;
  let subStartX = 0, subStartY = 0;

  const recCubic = (
    push: (x: number, y: number) => void,
    p0x: number, p0y: number, p1x: number, p1y: number,
    p2x: number, p2y: number, p3x: number, p3y: number, depth: number
  ) => {
    if (depth > 12) return;
    const chord = Math.hypot(p3x - p0x, p3y - p0y);
    const ctrl =
      Math.hypot(p1x - p0x, p1y - p0y) +
      Math.hypot(p2x - p1x, p2y - p1y) +
      Math.hypot(p3x - p2x, p3y - p2y);
    if (ctrl - chord < tolerance || depth > 8) {
      push(p3x, p3y);
      return;
    }
    const m01x = (p0x + p1x) / 2, m01y = (p0y + p1y) / 2;
    const m12x = (p1x + p2x) / 2, m12y = (p1y + p2y) / 2;
    const m23x = (p2x + p3x) / 2, m23y = (p2y + p3y) / 2;
    const m012x = (m01x + m12x) / 2, m012y = (m01y + m12y) / 2;
    const m123x = (m12x + m23x) / 2, m123y = (m12y + m23y) / 2;
    const m0123x = (m012x + m123x) / 2, m0123y = (m012y + m23y) / 2;
    recCubic(push, p0x, p0y, m01x, m01y, m012x, m012y, m0123x, m0123y, depth + 1);
    recCubic(push, m0123x, m0123y, m123x, m123y, m23x, m23y, p3x, p3y, depth + 1);
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": {
        cx = cmd.x!;
        cy = cmd.y!;
        subStartX = cx;
        subStartY = cy;
        pts.push({ x: cx, y: cy, penUp: true });
        break;
      }
      case "L": {
        const steps = Math.max(1, Math.ceil(Math.hypot(cmd.x! - cx, cmd.y! - cy) / tolerance));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          pts.push({ x: lerp(cx, cmd.x!, t), y: lerp(cy, cmd.y!, t), penUp: false });
        }
        cx = cmd.x!;
        cy = cmd.y!;
        break;
      }
      case "C": {
        const x1 = cmd.x1!, y1 = cmd.y1!, x2 = cmd.x2!, y2 = cmd.y2!, x = cmd.x!, y = cmd.y!;
        recCubic((px, py) => pts.push({ x: px, y: py, penUp: false }), cx, cy, x1, y1, x2, y2, x, y, 0);
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const x1 = cmd.x1!, y1 = cmd.y1!, ex = cmd.x!, ey = cmd.y!;
        const cx1 = cx + (2 / 3) * (x1 - cx);
        const cy1 = cy + (2 / 3) * (y1 - cy);
        const cx2 = ex + (2 / 3) * (x1 - ex);
        const cy2 = ey + (2 / 3) * (y1 - ey);
        recCubic((px, py) => pts.push({ x: px, y: py, penUp: false }), cx, cy, cx1, cy1, cx2, cy2, ex, ey, 0);
        cx = ex;
        cy = ey;
        break;
      }
      case "Z": {
        const steps = Math.max(1, Math.ceil(Math.hypot(subStartX - cx, subStartY - cy) / tolerance));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          pts.push({ x: lerp(cx, subStartX, t), y: lerp(cy, subStartY, t), penUp: false });
        }
        cx = subStartX;
        cy = subStartY;
        break;
      }
    }
  }
  return pts;
}

interface TextLine {
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  outline: HTMLCanvasElement;
  fill: HTMLCanvasElement;
  baseY: number;
  /** 描边点序列（行内局部坐标） */
  strokePath: { x: number; y: number; penUp: boolean }[];
  strokeLen: number;
}

export default function LaserCarvingCover() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [fontReady, setFontReady] = useState(false);
  const [fontError, setFontError] = useState(false);

  useEffect(() => {
    const canvas0 = canvasRef.current;
    if (!canvas0) return;
    const ctx0 = canvas0.getContext("2d");
    if (!ctx0) return;
    const canvas: HTMLCanvasElement = canvas0;
    const ctx: CanvasRenderingContext2D = ctx0;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    document.documentElement.classList.add("laser-forge");

    let W = 1, H = 1, DPR = 1;
    let raf = 0;
    let running = false;
    let disposed = false;
    let font: any = null;

    type Phase = "loading" | "engrave" | "cool" | "reveal" | "settled";
    let phase: Phase = "loading";
    let phaseT = 0;

    let line: TextLine | null = null;
    /** 描边累积遮罩（行内局部坐标） */
    let strokeMask: HTMLCanvasElement | null = null;
    let strokeMaskCtx: CanvasRenderingContext2D | null = null;
    let maskedScratch: HTMLCanvasElement | null = null;
    let maskedScratchCtx: CanvasRenderingContext2D | null = null;
    let sweepScratch: HTMLCanvasElement | null = null;
    let sweepScratchCtx: CanvasRenderingContext2D | null = null;
    let specScratch: HTMLCanvasElement | null = null;
    let specScratchCtx: CanvasRenderingContext2D | null = null;
    /** 1/4 分辨率 additive 辉光靶：降采样放大即免费高斯模糊 */
    let bloomC: HTMLCanvasElement | null = null;
    let bloomCtx: CanvasRenderingContext2D | null = null;
    let paintedDist = 0;
    let skipped = false;
    let released = false;

    let headX = 0, headY = 0;
    /** 光标 specular：目标/平滑位置（屏幕坐标），idle 超时后停止唤醒 */
    let specTX = 0, specTY = 0, specX = 0, specY = 0;
    let specAwake = false;
    let lastPointerAt = -1e9;

    function makeCanvas(w: number, h: number) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * DPR));
      c.height = Math.max(1, Math.round(h * DPR));
      const g = c.getContext("2d")!;
      g.scale(DPR, DPR);
      return { c, g };
    }

    // ===== 离屏文字层（opentype 路径绘制，与雕刻路径完全对齐）=====
    function renderLineLayer(text: string, size: number, layer: "outline" | "fill") {
      const upem = font?.unitsPerEm ?? 1000;
      const asc = ((font?.ascender ?? 800) / upem) * size;
      const desc = (-(font?.descender ?? -200) / upem) * size;
      const textW = font ? font.getAdvanceWidth(text, size) : size * text.length * 0.5;
      const pad = Math.ceil(size * 0.4);

      const cw = Math.ceil(textW + pad * 2);
      const ch = Math.ceil(asc + desc + pad * 2);
      const { c, g } = makeCanvas(cw, ch);

      const path = font?.getPath(text, pad, pad + asc, size);
      if (path) {
        if (layer === "fill") {
          // 车削钛反射带：亮带压在 42–52%，暗部推到 80% 之后（不对称 = 金属感）
          const grd = g.createLinearGradient(0, pad, 0, pad + asc + desc);
          grd.addColorStop(0, "#b9bcc2");
          grd.addColorStop(0.3, "#e8e8ec");
          grd.addColorStop(0.46, "#ffffff");
          grd.addColorStop(0.58, "#dcdfe3");
          grd.addColorStop(0.82, "#a7abb1");
          grd.addColorStop(1, "#8e9196");
          path.fill = grd;
          path.draw(g);
        } else {
          path.stroke = "rgba(232, 232, 236, 0.85)";
          path.strokeWidth = Math.max(1, size * 0.012);
          g.lineJoin = "round";
          g.lineCap = "round";
          path.draw(g);
        }
      }
      return { canvas: c, w: cw, h: ch, pad, asc };
    }

    function buildStrokePath(text: string, size: number, ox: number, oy: number, pad: number, asc: number) {
      const baseY = oy + pad + asc;
      let cursorX = ox + pad;
      const allPts: { x: number; y: number; penUp: boolean }[] = [];
      let totalLen = 0;
      const tolerance = Math.max(0.8, size * 0.012);

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const glyph = font.charToGlyph(ch);
        if (!glyph || !glyph.path) {
          cursorX += font.getAdvanceWidth(ch, size);
          continue;
        }
        const glyphPath = glyph.getPath(cursorX, baseY, size);
        const pts = samplePathCommands(glyphPath.commands, tolerance);
        for (let j = 0; j < pts.length; j++) {
          const p = pts[j];
          if (!p.penUp && j > 0) {
            const prev = pts[j - 1];
            totalLen += Math.hypot(p.x - prev.x, p.y - prev.y);
          }
          allPts.push({ x: p.x - ox, y: p.y - oy, penUp: p.penUp });
        }
        cursorX += glyph.advanceWidth ? glyph.advanceWidth * (size / font.unitsPerEm) : 0;
      }
      return { pts: allPts, totalLen };
    }

    function buildLine(text: string, maxSize: number, maxW: number, centerY: number): TextLine {
      let size = Math.min(maxSize, 128);
      const PAD_RATIO = 0.4;
      const measure = (s: number) => {
        const pad = Math.ceil(s * PAD_RATIO);
        return (font ? font.getAdvanceWidth(text, s) : s * text.length * 0.5) + pad * 2;
      };
      while (measure(size) > maxW && size > 8) size -= 1;

      const out = renderLineLayer(text, size, "outline");
      const fl = renderLineLayer(text, size, "fill");
      const x = Math.round((W - out.w) / 2);
      const y = Math.round(centerY - out.h / 2);
      const baseY = y + out.pad + out.asc;
      const { pts, totalLen } = font
        ? buildStrokePath(text, size, x, y, out.pad, out.asc)
        : { pts: [], totalLen: 0 };

      return { size, x, y, w: out.w, h: out.h, outline: out.canvas, fill: fl.canvas, baseY, strokePath: pts, strokeLen: totalLen };
    }

    function initLayout() {
      line = buildLine(EN_TEXT, H * 0.115, W * 0.86, H * 0.46);
      const m = makeCanvas(line.w, line.h);
      strokeMask = m.c;
      strokeMaskCtx = m.g;
      const s1 = makeCanvas(line.w, line.h);
      maskedScratch = s1.c;
      maskedScratchCtx = s1.g;
      const s2 = makeCanvas(line.w, line.h);
      sweepScratch = s2.c;
      sweepScratchCtx = s2.g;
      const s3 = makeCanvas(line.w, line.h);
      specScratch = s3.c;
      specScratchCtx = s3.g;
      const bl = makeCanvas(W / 4, H / 4);
      bloomC = bl.c;
      bloomCtx = bl.g;
      paintedDist = 0;
    }

    function resetStrokeMask() {
      if (!strokeMaskCtx) return;
      strokeMaskCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      strokeMaskCtx.clearRect(0, 0, line!.w, line!.h);
      paintedDist = 0;
    }

    // ===== 路径行走 =====
    function posAt(dist: number): { x: number; y: number; active: boolean } {
      const pts = line!.strokePath;
      if (pts.length === 0) return { x: line!.w / 2, y: line!.baseY - line!.y, active: false };
      let remain = dist;
      let last: { x: number; y: number } | null = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.penUp) {
          if (remain <= 0 && last) return { x: last.x, y: last.y, active: false };
          last = null;
          continue;
        }
        if (last) {
          const seg = Math.hypot(p.x - last.x, p.y - last.y);
          if (remain <= seg) {
            const t = seg === 0 ? 0 : remain / seg;
            return { x: lerp(last.x, p.x, t), y: lerp(last.y, p.y, t), active: true };
          }
          remain -= seg;
        }
        last = { x: p.x, y: p.y };
      }
      const end = pts[pts.length - 1];
      return { x: end.x, y: end.y, active: true };
    }

    /** 把 [from,to] 区间的路径分段回调（行内局部坐标） */
    function walk(from: number, to: number, cb: (sx: number, sy: number, ex: number, ey: number, d: number) => void) {
      const pts = line!.strokePath;
      let r = 0;
      let last: { x: number; y: number } | null = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.penUp) { last = null; continue; }
        if (last) {
          const seg = Math.hypot(p.x - last.x, p.y - last.y);
          const s0 = r, s1 = r + seg;
          if (s1 > from && s0 < to) {
            const t0 = clamp((from - s0) / seg, 0, 1);
            const t1 = clamp((to - s0) / seg, 0, 1);
            cb(
              lerp(last.x, p.x, t0), lerp(last.y, p.y, t0),
              lerp(last.x, p.x, t1), lerp(last.y, p.y, t1),
              s0
            );
          }
          r = s1;
          if (r >= to) break;
        }
        last = { x: p.x, y: p.y };
      }
    }

    /** 冷却后的刻痕：增量写入行内遮罩 */
    function paintCooled(dist: number) {
      const g = strokeMaskCtx;
      if (!g || dist <= paintedDist) return;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.lineCap = "round";
      g.lineJoin = "round";
      walk(paintedDist, dist, (sx, sy, ex, ey) => {
        g.strokeStyle = "rgba(232,232,236,0.14)";
        g.lineWidth = Math.max(3, line!.size * 0.055);
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
        g.strokeStyle = "rgba(240,240,244,0.9)";
        g.lineWidth = Math.max(1.1, line!.size * 0.014);
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
      });
      paintedDist = dist;
    }

    // ===== 各层绘制 =====
    function drawGhost() {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 0.05;
      ctx.drawImage(line!.fill, line!.x, line!.y, line!.w, line!.h);
      ctx.globalAlpha = 0.16;
      ctx.drawImage(line!.outline, line!.x, line!.y, line!.w, line!.h);
      ctx.restore();
    }

    function drawCooled(alpha: number) {
      if (!maskedScratchCtx || !maskedScratch || !strokeMask || alpha <= 0) return;
      const g = maskedScratchCtx;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, line!.w, line!.h);
      g.drawImage(line!.outline, 0, 0, line!.w, line!.h);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(strokeMask, 0, 0, line!.w, line!.h);
      g.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(maskedScratch, line!.x, line!.y, line!.w, line!.h);
      ctx.restore();
    }

    /** 熔池余晖：激光头后方 MOLTEN_PX 内过曝，按 exp(-d/MOLTEN_PX) 冷却 */
    function drawMolten(headDist: number, scale: number) {
      if (scale <= 0) return;
      const from = Math.max(0, headDist - MOLTEN_PX);
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.translate(line!.x, line!.y);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const passes: [number, number][] = [
        [line!.size * 0.2, 0.3],
        [line!.size * 0.06, 0.95]
      ];
      for (const [width, amp] of passes) {
        ctx.lineWidth = width;
        walk(from, headDist, (sx, sy, ex, ey, d) => {
          const mid = (d + from) * 0.5;
          const k = Math.exp(-(headDist - mid) / MOLTEN_PX) * amp * scale;
          if (k < 0.01) return;
          ctx.strokeStyle = `rgba(255,255,255,${k.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        });
      }
      ctx.restore();

      // 降采样 bloom：1/4 靶上画宽软笔触，放大回主屏即免费高斯
      if (!bloomCtx || !bloomC) return;
      const g = bloomCtx;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, W / 4, H / 4);
      g.save();
      g.scale(0.25, 0.25);
      g.translate(line!.x, line!.y);
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = line!.size * 0.55;
      walk(from, headDist, (sx, sy, ex, ey, d) => {
        const mid = (d + from) * 0.5;
        const k = Math.exp(-(headDist - mid) / MOLTEN_PX) * 0.5 * scale;
        if (k < 0.01) return;
        g.strokeStyle = `rgba(255,255,255,${k.toFixed(3)})`;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
      });
      g.restore();
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(bloomC, 0, 0, W, H);
      ctx.restore();
    }

    /** 一束从顶垂下的激光：机器感的全部来源 */
    function drawBeam(x: number, y: number, alpha: number) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(0, 0, 0, y);
      g.addColorStop(0, "rgba(226,236,255,0)");
      g.addColorStop(0.72, `rgba(226,236,255,${(0.05 * alpha).toFixed(3)})`);
      g.addColorStop(1, `rgba(236,242,255,${(0.16 * alpha).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.75, 0, 1.5, y);
      ctx.restore();
    }

    /** 光学三层光斑：白热核 + 紧贴 bloom + 环境散射，无 shadowBlur */
    function drawHead(x: number, y: number, alpha: number) {
      if (alpha <= 0) return;
      const r = Math.max(1.2, line!.size * 0.016);
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      const ambient = ctx.createRadialGradient(x, y, 0, x, y, r * 22);
      ambient.addColorStop(0, `rgba(226,232,244,${(0.06 * alpha).toFixed(3)})`);
      ambient.addColorStop(1, "rgba(226,232,244,0)");
      ctx.fillStyle = ambient;
      ctx.beginPath(); ctx.arc(x, y, r * 22, 0, Math.PI * 2); ctx.fill();
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
      bloom.addColorStop(0, `rgba(255,255,255,${(0.34 * alpha).toFixed(3)})`);
      bloom.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = bloom;
      ctx.beginPath(); ctx.arc(x, y, r * 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /** 熄刀 anamorphic 横条：只在 kill 窗口出现一次 */
    function drawStreak(k: number) {
      if (k <= 0 || !line) return;
      const y = line.baseY - line.size * 0.32;
      const half = W * 0.9;
      const cx = W / 2;
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(cx - half, y, cx + half, y);
      const a = 0.42 * k * k;
      g.addColorStop(0, "rgba(214,228,255,0)");
      g.addColorStop(0.5, `rgba(226,236,255,${a.toFixed(3)})`);
      g.addColorStop(1, "rgba(214,228,255,0)");
      ctx.fillStyle = g;
      const h = 2.5;
      ctx.fillRect(cx - half, y - h / 2, half * 2, h);
      ctx.restore();
    }

    /** 显影：金属填充沿 X 扫入，软边 + 前缘光 */
    function drawReveal(prog: number) {
      if (!sweepScratchCtx || !sweepScratch) return;
      const g = sweepScratchCtx;
      const lw = line!.w, lh = line!.h;
      const edgeX = lerp(-lw * 0.12, lw * 1.12, prog);
      const soft = lw * 0.1;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, lw, lh);
      g.drawImage(line!.fill, 0, 0, lw, lh);
      g.globalCompositeOperation = "destination-in";
      const grad = g.createLinearGradient(edgeX - soft, 0, edgeX, 0);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, lw, lh);
      // 前缘光锁在已显影的字形内，避免露出矩形光板
      g.globalCompositeOperation = "source-atop";
      const band = g.createLinearGradient(edgeX - line!.size * 0.34, 0, edgeX, 0);
      band.addColorStop(0, "rgba(255,255,255,0)");
      band.addColorStop(0.75, "rgba(255,255,255,0.5)");
      band.addColorStop(1, "rgba(255,255,255,0.85)");
      g.fillStyle = band;
      g.fillRect(edgeX - line!.size * 0.34, 0, line!.size * 0.34, lh);
      g.globalCompositeOperation = "source-over";

      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.drawImage(sweepScratch, line!.x, line!.y, lw, lh);
      ctx.restore();
    }

    /** 收尾重音：横条 bookend + 一次整体光呼吸，播完即止 */
    function drawClimax(t: number) {
      if (t < T_KILL) drawStreak(1 - t / T_KILL);

      const pp = clamp(t / 0.3, 0, 1);
      if (pp < 1) {
        const k = Math.sin(pp * Math.PI);
        ctx.save();
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.2 * k;
        ctx.drawImage(line!.fill, line!.x, line!.y, line!.w, line!.h);
        ctx.restore();
      }
    }

    /** 光标 specular：会响应的光才是金属。仅指针活动帧绘制 */
    function drawSpecular() {
      const g = specScratchCtx;
      if (!g) return;
      const lw = line!.w, lh = line!.h;
      const lx = specX - line!.x;
      const ly = specY - line!.y;
      const r = line!.size * 1.4;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, lw, lh);
      const rg = g.createRadialGradient(lx, ly, 0, lx, ly, r);
      rg.addColorStop(0, "rgba(255,255,255,0.85)");
      rg.addColorStop(0.5, "rgba(255,255,255,0.28)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(line!.fill, 0, 0, lw, lh);
      g.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      // overlay：只提亮中间调，亮部不截断，金属才会"响应"光
      ctx.globalCompositeOperation = "overlay";
      ctx.drawImage(specScratch!, line!.x, line!.y, lw, lh);
      ctx.restore();
    }

    function drawSettled(withSpec: boolean) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!line) return;
      ctx.drawImage(line.fill, line.x, line.y, line.w, line.h);
      if (withSpec) drawSpecular();
    }

    // ===== 阶段编排 =====
    function revealUi() {
      const at = (ms: number, fn: () => void) => setTimeout(() => { if (!disposed) fn(); }, ms);
      at(0, () => eyebrowRef.current?.classList.add("is-visible"));
      at(150, () => subRef.current?.classList.add("is-visible"));
      at(300, () => enterRef.current?.classList.add("is-visible"));
    }

    function finishNow() {
      skipped = true;
      phase = "settled";
      phaseT = 0;
      canvas.classList.add("is-focusing");
      revealUi();
      drawSettled(false);
    }

    /** 重音播完即销毁：描边遮罩与合成 scratch 此后无人读取 */
    function releaseScratch() {
      strokeMask = null;
      strokeMaskCtx = null;
      maskedScratch = null;
      maskedScratchCtx = null;
      sweepScratch = null;
      sweepScratchCtx = null;
      bloomC = null;
      bloomCtx = null;
    }

    function advance(dt: number) {
      phaseT += dt;
      switch (phase) {
        case "engrave": {
          if (phaseT >= T_ENGRAVE) { phase = "cool"; phaseT = 0; paintCooled(line!.strokeLen); }
          break;
        }
        case "cool": {
          if (phaseT >= T_KILL + T_COOL) {
            phase = "reveal";
            phaseT = 0;
            canvas.classList.add("is-focusing");
          }
          break;
        }
        case "reveal": {
          if (phaseT >= T_REVEAL) { phase = "settled"; phaseT = 0; revealUi(); }
          break;
        }
        case "settled": {
          if (phaseT >= T_CLIMAX) {
            // 重音播完：进入静止。仅 specular 活动时才继续跑帧
            specAwake = finePointer && !reduced && performance.now() - lastPointerAt < 400;
            if (!released) {
              released = true;
              releaseScratch();
            }
          }
          break;
        }
        default: break;
      }
    }

    function drawScene() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!line) return;

      if (phase === "engrave") {
        const p = easeEngrave(clamp(phaseT / T_ENGRAVE, 0, 1));
        const dist = p * line.strokeLen;
        paintCooled(dist);
        drawGhost();
        drawCooled(1);
        drawMolten(dist, 1);
        const pos = posAt(dist);
        headX = line.x + pos.x;
        headY = line.y + pos.y;
        drawBeam(headX, headY, pos.active ? 1 : 0.4);
        drawHead(headX, headY, pos.active ? 1 : 0.35);
      } else if (phase === "cool") {
        const coolP = clamp(phaseT / (T_KILL + T_COOL), 0, 1);
        const dieK = clamp(1 - phaseT / 0.12, 0, 1);
        drawGhost();
        drawCooled(1);
        drawMolten(line.strokeLen, (1 - coolP) * (1 - coolP));
        drawBeam(headX, headY, dieK);
        drawHead(headX, headY, dieK);
        drawStreak(clamp(1 - phaseT / T_KILL, 0, 1));
      } else if (phase === "reveal") {
        const prog = easeReveal(clamp(phaseT / T_REVEAL, 0, 1));
        drawReveal(prog);
        drawCooled(1 - clamp(prog / 0.35, 0, 1));
      } else if (phase === "settled") {
        drawSettled(specAwake);
        if (phaseT < T_CLIMAX) drawClimax(phaseT);
      }
    }

    function shouldContinue() {
      if (phase !== "settled") return true;
      if (phaseT < T_CLIMAX) return true;
      return specAwake;
    }

    let last = performance.now();
    function loop(now: number) {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (specAwake) {
        specX += (specTX - specX) * 0.22;
        specY += (specTY - specY) * 0.22;
        if (now - lastPointerAt > 400) specAwake = false;
      }
      advance(dt);
      drawScene();
      if (shouldContinue()) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
        drawSettled(false);
      }
    }

    function ensureLoop() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!font) return;
      initLayout();
      if (phase === "settled") {
        drawSettled(false);
      } else if (phase !== "loading") {
        phase = "engrave";
        phaseT = 0;
        resetStrokeMask();
      }
    }

    function startFallbackMode() {
      setFontError(true);
      resize();
      setFontReady(true);
      finishNow();
    }

    // 与 disposed 同作用域，cleanup 才能取消在途的字体请求。
    const fontController = new AbortController();
    async function loadFont() {
      const timeout = setTimeout(() => fontController.abort(), 4000);
      try {
        const res = await fetch(FONT_URL, { signal: fontController.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        // @ts-ignore - opentype.js has no types published
        const opentype = await import("opentype.js");
        font = opentype.parse(buf);
        if (disposed) return;
        resize();
        setFontReady(true);
        if (reduced || skipped) {
          finishNow();
        } else {
          phase = "engrave";
          phaseT = 0;
          ensureLoop();
        }
      } catch (err) {
        // 卸载会 abort 这次 fetch；没有这个守卫，回退路径会在已卸载的组件上
        // setState 并重启 RAF 循环。
        if (disposed) return;
        console.error("Failed to load opentype font, falling back to simple mode", err);
        startFallbackMode();
      } finally {
        clearTimeout(timeout);
      }
    }
    loadFont();

    const onPointerMove = (e: PointerEvent) => {
      specTX = e.clientX;
      specTY = e.clientY;
      lastPointerAt = performance.now();
      if (phase === "settled" && phaseT >= T_CLIMAX && finePointer && !reduced) {
        if (!specAwake) { specX = specTX; specY = specTY; }
        specAwake = true;
        ensureLoop();
      }
    };
    const onSkip = () => {
      if (phase !== "settled") finishNow();
    };
    if (!reduced) window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onSkip, { passive: true });
    window.addEventListener("keydown", onSkip);
    window.addEventListener("wheel", onSkip, { passive: true });

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { resize(); ensureLoop(); }, 180);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      fontController.abort();
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("keydown", onSkip);
      window.removeEventListener("wheel", onSkip);
      document.documentElement.classList.remove("laser-forge");
    };
  }, []);

  function handleEnter() {
    canvasRef.current?.parentElement?.classList.add("is-exiting");
    tintRef.current?.classList.add("is-active");
    setTimeout(() => router.push("/modules"), 460);
  }

  return (
    <div ref={containerRef} className="laser-forge">
      <canvas ref={canvasRef} className="forge-canvas" />
      <div ref={tintRef} className="exit-tint" aria-hidden="true" />
      {!fontReady && !fontError && <div className="forge-loading">Zz.one</div>}

      <div ref={eyebrowRef} className="forge-eyebrow">Ninglo · Vault of Ink</div>
      <div ref={subRef} className="forge-sub">以墨观势 · 驭数入墨</div>
      <button ref={enterRef} className="enter-gate" onClick={handleEnter} aria-label="进入 Zz.one 模块大厅">
        Enter
      </button>
    </div>
  );
}
