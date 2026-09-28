"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 激光点火封面（v10 —— 火花 · 热浪 · 相机 · 挂字猫）
 *
 * 时间轴与几何解耦，跨设备恒定 ~3.1s：
 *   0         首帧给出"未点亮蓝图"（轮廓 16% + 填充 5%），画布失焦 scale(1.02)/blur(3px)，
 *             相机停在推入起点 scale(1.035)
 *   0–0.70s   一束激光自顶垂下，沿轮廓一次扫过；熔池过曝余晖 + 1/4 降采样 bloom；
 *             激光头持续飞溅火花（加法混合 + 重力），热区按行水平扭动（热浪）
 *   0.70s     熄刀：光束 120ms 内熄灭 + 头部暖白闪 + 一次径向爆花，anamorphic 横条闪 260ms
 *   0.70–1.26s 静默：熔池冷却回银，热浪幅度随温度衰减归零
 *   1.26–2.16s 显影高潮：金属填充 900ms 扫入；rack-focus 到 scale(1)/blur(0)，相机归位
 *   2.16–3.11s 重音：横条 bookend + 光呼吸（300ms）+ 一道掠面高光扫过金属字面
 *   2.16s+    UI 错峰浮现（0/150/300ms，字距从宽收拢 + 去模糊）；RAF 空闲即停
 *   settle 后  每 5.5–8.5s 一道待机微光掠过字面，金属保持"活着"；光标 specular 照旧按需唤醒
 *   3.11s+    coda·挂字猫：小猫斜抛坠落咬住句尾 "d"，咬合白闪 + 微火花 + 文字下陷回弹（重量），
 *             阻尼单摆两三个来回收敛，异瞳点亮（近蓝远金），慢眨 → 微风接管常驻：
 *             悬挂微摆 / 三关节尾巴欢快摇 / 随待机微光眨眼 / 四芒星眼神偶发；
 *             Enter 给摆一个冲量（鞠躬告别）+ 右眼香槟金
 *   荧幕感工艺：engrave–cool 期上下 letterbox 黑边 + 胶片颗粒（fx 层，reveal 后渐退归零）
 *
 * 任意 pointerdown / keydown / wheel 立即跳到终态（coda 则猫一步挂稳）。reduced-motion 直接终态含挂猫。
 */

const EN_TEXT = "Welcome to Ninglo's World.";
const FONT_URL = "/inter-600-subset.ttf";

const T_ENGRAVE = 0.7;
const T_KILL = 0.26;
const T_COOL = 0.3;
const T_REVEAL = 0.9;
const T_CLIMAX = 0.95;
/** 熔池余晖衰减长度（像素）：激光头后方仍过曝的距离 */
const MOLTEN_PX = 64;
/** 掠面高光在重音窗口内的起点与时长（秒） */
const SHEEN_AT = 0.3;
const SHEEN_LEN = 0.55;
/** 待机微光单次时长（秒） */
const IDLE_SHEEN_LEN = 1.6;

// ===== v10：挂字猫 coda（秒；catT 自猫幕起算） =====
const CAT_FALL_AT = 0.15;   // 坠落起跳前的静默拍
const CAT_FALL = 0.38;      // 斜抛坠落时长（→ 咬合）
const CAT_CATCH_T = CAT_FALL_AT + CAT_FALL;
const CAT_SQUASH = 0.28;    // 咬合挤压回弹窗口
const CAT_POWER_AT = CAT_CATCH_T + 0.15;  // 异瞳点亮
const CAT_POWER_LEN = 0.26;
const CAT_BLINK_AT = CAT_CATCH_T + 0.42;  // 落成慢眨
const CAT_BREEZE_AT = CAT_CATCH_T + 1.55; // 物理 → 微风接管
const CAT_BREEZE_BLEND = 0.4;
const CAT_BREATH_PERIOD = 3.4;
const CAT_TAIL_PERIOD = 0.85;
/** 单摆：T≈0.75s（ωn≈8.4）、ζ≈0.24（g/L=ωn²，c=2ζωn） */
const CAT_OMEGA_N = 8.4;
const CAT_DAMP = 4.0;
/** 坠落弹道：起点枢轴右上，落点恰为咬合点 */
const CAT_FALL_VX = -420;
const CAT_FALL_G = 4200;
/** 异瞳稳态/点亮色（近眼蓝、远眼金绿——全片唯二彩色，只在事件时刻升温） */
const CAT_EYE_L = { core: [157, 184, 212], edge: [78, 112, 147], hot: [207, 228, 247] } as const;
const CAT_EYE_R = { core: [214, 201, 138], edge: [138, 124, 58], hot: [242, 227, 168] } as const;
const CAT_GOLD = [201, 150, 47] as const;

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
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  /** v9：effect 内注册的猫目送回调（Enter 时慢眨 + 右眼金闪） */
  const catApiRef = useRef<{ farewell?: () => void }>({});
  const [fontReady, setFontReady] = useState(false);
  const [fontError, setFontError] = useState(false);

  useEffect(() => {
    const canvas0 = canvasRef.current;
    if (!canvas0) return;
    const ctx0 = canvas0.getContext("2d");
    if (!ctx0) return;
    const canvas: HTMLCanvasElement = canvas0;
    const ctx: CanvasRenderingContext2D = ctx0;
    const stage = stageRef.current;

    // fx 层：火花与熄刀闪白画在这块无模糊画布上——背景失焦时前景依然锐利，景深感所在
    const fx0 = fxCanvasRef.current;
    if (!fx0) return;
    const fxCanvas: HTMLCanvasElement = fx0;
    const fxCtx0 = fx0.getContext("2d");
    if (!fxCtx0) return;
    const fxCtx: CanvasRenderingContext2D = fxCtx0;

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
    /** 热浪扭曲带：冷却中的刻痕与熔池先渲进这条带，再按行加水平位移贴回 */
    let bandC: HTMLCanvasElement | null = null;
    let bandCtx: CanvasRenderingContext2D | null = null;
    let bandY = 0, bandH = 0;
    /** 掠面高光靶（常驻：重音一次 + 待机微光复用） */
    let sheenC: HTMLCanvasElement | null = null;
    let sheenCtx: CanvasRenderingContext2D | null = null;
    /** 火花：雕刻期持续飞溅，熄刀一次性爆花 */
    interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; warm: number; }
    let sparks: Spark[] = [];
    let spawnAcc = 0;
    /** 激光头行进方向（单位向量），火花反向喷出 */
    let headDirX = 1, headDirY = 0;
    /** 相机：全程缓推 + 随激光头微漂，显影落焦时归位 */
    let camX = 0, camY = 0;
    /** 全局时钟：热浪波形的相位源 */
    let clock = 0;
    /** 待机微光：settle 后每 5.5–8.5s 一道弱光掠过字面 */
    let idleTimer = 0;
    let idleSheenT = -1;
    let paintedDist = 0;
    let skipped = false;
    let released = false;

    let headX = 0, headY = 0;
    /** 光标 specular：目标/平滑位置（屏幕坐标），idle 超时后停止唤醒 */
    let specTX = 0, specTY = 0, specX = 0, specY = 0;
    let specAwake = false;
    let lastPointerAt = -1e9;

    // ===== v10：挂字猫 + 荧幕感工艺 =====
    type CatPhase = "off" | "coda" | "live";
    let catPhase: CatPhase = "off";
    let catT = 0;
    let catClock = 0;        // 生命感时钟（呼吸/尾摆相位源）
    let catBlinked = false;
    let catBlinkT = -1;
    let catGoldT = -1;
    /** 单摆状态：θ（屏幕弧度，+ 为向画面中心摆）、ω；physActive=false 时走微风正弦 */
    let catTheta = 0, catOmega = 0;
    let catPhys = false;
    let catCaught = false;
    let catBreezePhase = 0;
    let catBreezeAmp = 0.035;
    /** 咬合冲量后的文字下陷（drawSettled 消费） */
    let catDipK = 0;
    /** 咬合白闪（fx 层）与冲量回摆的静息计时 */
    let catchFlashT = 0;
    let catSettleAcc = 0;
    /** 四芒星闪眼 */
    let catGlintT = -1;
    let catGlintTimer = 0;
    let catPupilBoost = 0;
    /** 咬合枢轴（句尾 "d" 基线处）与猫身比例尺（局部单位→px，全身 112 单位） */
    let catPX = 0, catPY = 0, catScale = 1, catLen = 0;
    /** live 常驻期隔帧降耗（~30fps），事件帧恢复满帧 */
    let frameParity = 0;
    /** 胶片颗粒：96px 双色噪声 tile，每 90ms 换随机偏移 */
    let grainC: HTMLCanvasElement | null = null;
    let grainOx = 0, grainOy = 0, grainClock = 0;

    function makeCanvas(w: number, h: number) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * DPR));
      c.height = Math.max(1, Math.round(h * DPR));
      const g = c.getContext("2d")!;
      g.scale(DPR, DPR);
      return { c, g };
    }

    /** v9 胶片颗粒 tile：双色（黑/白）稀疏像素，α 直接烘焙进位图，运行时零逐像素成本 */
    function buildGrain() {
      const s = 96;
      const c = document.createElement("canvas");
      c.width = s;
      c.height = s;
      const g = c.getContext("2d");
      if (!g) return;
      const img = g.createImageData(s, s);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 255 : 0;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = Math.random() < 0.22 ? Math.round(50 + Math.random() * 90) : 0;
      }
      g.putImageData(img, 0, 0);
      grainC = c;
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
      const bandPad = line.size * 0.35;
      bandY = Math.max(0, line.y - bandPad);
      bandH = Math.min(H - bandY, line.h + bandPad * 2);
      const bd = makeCanvas(W, bandH);
      bandC = bd.c;
      bandCtx = bd.g;
      const sh = makeCanvas(line.w, line.h);
      sheenC = sh.c;
      sheenCtx = sh.g;
      paintedDist = 0;
      buildCatLayout();
    }

    /** v10 猫布局：咬合枢轴钉在句尾 "d" 的基线处（句点留在猫脸旁）；猫长按视口分档 */
    function buildCatLayout() {
      if (!line) return;
      const portrait = W < 640;
      catLen = portrait ? clamp(H * 0.13, 95, 125) : clamp(H * 0.185, 125, 175);
      catScale = catLen / 112;
      const advDot = font ? font.getAdvanceWidth(".", line.size) : line.size * 0.3;
      const advD = font ? font.getAdvanceWidth("d", line.size) : line.size * 0.55;
      const pad = Math.ceil(line.size * 0.4); // buildLine 同源的 PAD_RATIO
      const textW = font ? font.getAdvanceWidth(EN_TEXT, line.size) : line.w - pad * 2;
      catPX = line.x + pad + textW - advDot - advD * 0.55;
      catPY = line.baseY + 1;
    }

    function resetStrokeMask() {
      if (!strokeMaskCtx) return;
      strokeMaskCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      strokeMaskCtx.clearRect(0, 0, line!.w, line!.h);
      paintedDist = 0;
    }

    // ===== 路径行走 =====
    function posAtPts(pts: { x: number; y: number; penUp: boolean }[], dist: number): { x: number; y: number; active: boolean } {
      if (pts.length === 0) return { x: 0, y: 0, active: false };
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

    /** 把 [from,to] 区间的路径分段回调（接收方坐标系） */
    function walkPts(
      pts: { x: number; y: number; penUp: boolean }[],
      from: number,
      to: number,
      cb: (sx: number, sy: number, ex: number, ey: number, d: number) => void
    ) {
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

    function posAt(dist: number): { x: number; y: number; active: boolean } {
      const pts = line!.strokePath;
      if (pts.length === 0) return { x: line!.w / 2, y: line!.baseY - line!.y, active: false };
      return posAtPts(pts, dist);
    }

    /** 把 [from,to] 区间的路径分段回调（行内局部坐标） */
    function walk(from: number, to: number, cb: (sx: number, sy: number, ex: number, ey: number, d: number) => void) {
      walkPts(line!.strokePath, from, to, cb);
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

    function drawCooled(alpha: number, out: CanvasRenderingContext2D = ctx, dy = 0) {
      if (!maskedScratchCtx || !maskedScratch || !strokeMask || alpha <= 0) return;
      const g = maskedScratchCtx;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, line!.w, line!.h);
      g.drawImage(line!.outline, 0, 0, line!.w, line!.h);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(strokeMask, 0, 0, line!.w, line!.h);
      g.globalCompositeOperation = "source-over";
      out.save();
      out.setTransform(DPR, 0, 0, DPR, 0, dy * DPR);
      out.globalAlpha = alpha;
      out.drawImage(maskedScratch, line!.x, line!.y, line!.w, line!.h);
      out.restore();
    }

    /** 熔池余晖主体：激光头后方 MOLTEN_PX 内过曝，按 exp(-d/MOLTEN_PX) 冷却；out/dy 允许渲进热浪带 */
    function moltenStrokes(headDist: number, scale: number, out: CanvasRenderingContext2D = ctx, dy = 0) {
      if (scale <= 0) return;
      const from = Math.max(0, headDist - MOLTEN_PX);
      out.save();
      out.setTransform(DPR, 0, 0, DPR, 0, dy * DPR);
      out.translate(line!.x, line!.y);
      out.globalCompositeOperation = "lighter";
      out.lineCap = "round";
      out.lineJoin = "round";
      const passes: [number, number][] = [
        [line!.size * 0.2, 0.3],
        [line!.size * 0.06, 0.95]
      ];
      for (const [width, amp] of passes) {
        out.lineWidth = width;
        walk(from, headDist, (sx, sy, ex, ey, d) => {
          const mid = (d + from) * 0.5;
          const k = Math.exp(-(headDist - mid) / MOLTEN_PX) * amp * scale;
          if (k < 0.01) return;
          out.strokeStyle = `rgba(255,255,255,${k.toFixed(3)})`;
          out.beginPath(); out.moveTo(sx, sy); out.lineTo(ex, ey); out.stroke();
        });
      }
      out.restore();
    }

    /** 熔池 bloom：1/4 靶上画宽软笔触，放大回主屏即免费高斯（始终合成在主画布） */
    function moltenBloom(headDist: number, scale: number) {
      if (scale <= 0 || !bloomCtx || !bloomC) return;
      const from = Math.max(0, headDist - MOLTEN_PX);
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

    // ===== v8：火花（画在 fx 层，不受场景失焦影响）=====
    function spawnSpark(x: number, y: number, vx: number, vy: number) {
      if (sparks.length >= 160) return;
      sparks.push({ x, y, vx, vy, age: 0, life: 0.3 + Math.random() * 0.35, size: 0.7 + Math.random() * 1.2, warm: Math.random() });
    }

    /** 熄刀爆花：光束死掉的一瞬向外抛一小把火星 */
    function killBurst() {
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 50 + Math.random() * 200;
        spawnSpark(headX, headY, Math.cos(a) * sp, Math.sin(a) * sp - 40 - Math.random() * 60);
      }
    }

    function updateSparks(dt: number) {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) { sparks.splice(i, 1); continue; }
        s.vy += 320 * dt;
        s.vx *= Math.exp(-1.6 * dt);
        s.vy *= Math.exp(-0.6 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
    }

    function drawSparks() {
      fxCtx.globalCompositeOperation = "lighter";
      for (const s of sparks) {
        const k = 1 - s.age / s.life;
        fxCtx.fillStyle = s.warm > 0.5
          ? `rgba(255,236,200,${(k * (0.4 + 0.6 * k)).toFixed(3)})`
          : `rgba(255,255,255,${(k * (0.4 + 0.6 * k)).toFixed(3)})`;
        fxCtx.beginPath();
        fxCtx.arc(s.x, s.y, s.size * (0.5 + 0.5 * k), 0, Math.PI * 2);
        fxCtx.fill();
      }
    }

    /** fx 层每帧重绘：火花 + 熄刀闪白 + 荧幕感工艺（背景失焦时这里保持锐利） */
    function drawFx() {
      fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      fxCtx.clearRect(0, 0, W, H);
      if (sparks.length > 0) drawSparks();
      if (phase === "cool" && phaseT < 0.09 && line) {
        const fk = 1 - phaseT / 0.09;
        fxCtx.globalCompositeOperation = "lighter";
        const fr = line.size * (0.5 + 0.8 * fk);
        const fg = fxCtx.createRadialGradient(headX, headY, 0, headX, headY, fr);
        fg.addColorStop(0, `rgba(255,244,224,${(0.34 * fk * fk).toFixed(3)})`);
        fg.addColorStop(1, "rgba(255,244,224,0)");
        fxCtx.fillStyle = fg;
        fxCtx.beginPath(); fxCtx.arc(headX, headY, fr, 0, Math.PI * 2); fxCtx.fill();
      }
      fxCtx.globalCompositeOperation = "source-over";
      // 挂字猫咬合白闪（60ms 内衰减）
      if (catchFlashT > 0) {
        const k = clamp(catchFlashT / 0.06, 0, 1);
        fxCtx.globalCompositeOperation = "lighter";
        const fr = 18 + 26 * (1 - k);
        const fg = fxCtx.createRadialGradient(catPX, catPY, 0, catPX, catPY, fr);
        fg.addColorStop(0, `rgba(255,255,255,${(0.9 * k * k).toFixed(3)})`);
        fg.addColorStop(0.5, `rgba(240,244,252,${(0.3 * k * k).toFixed(3)})`);
        fg.addColorStop(1, "rgba(240,244,252,0)");
        fxCtx.fillStyle = fg;
        fxCtx.beginPath();
        fxCtx.arc(catPX, catPY, fr, 0, Math.PI * 2);
        fxCtx.fill();
        fxCtx.globalCompositeOperation = "source-over";
      }
      drawCinema();
    }

    /** v9 荧幕感工艺：letterbox 上下黑边（settled 首 0.8s 退出）+ 胶片颗粒（暗期强、显影渐隐归零） */
    function drawCinema() {
      const barH = W >= 640 ? clamp(Math.min(H * 0.09, W * 0.14), 44, 110) : 0;
      if (barH > 0) {
        let kb = 0;
        if (phase === "engrave" || phase === "cool" || phase === "reveal") kb = 1;
        else if (phase === "settled" && phaseT < 0.8) {
          const q = phaseT / 0.8;
          const iq = 1 - q;
          kb = 1 - iq * iq * iq * iq * iq; // quint-out：张开慢于合拢，揭示心理
        }
        if (kb > 0.002) {
          const h = barH * kb;
          fxCtx.fillStyle = "#000";
          fxCtx.fillRect(0, 0, W, h);
          fxCtx.fillRect(0, H - h, W, h);
        }
      }
      let ga = 0;
      if (phase === "engrave") ga = 1;
      else if (phase === "cool") ga = 0.7;
      else if (phase === "reveal") ga = 1 - clamp(phaseT / T_REVEAL, 0, 1);
      if (ga > 0.01 && grainC) {
        fxCtx.globalAlpha = 0.085 * ga;
        for (let gx = grainOx; gx < W; gx += 96) {
          for (let gy = grainOy; gy < H; gy += 96) fxCtx.drawImage(grainC, gx, gy);
        }
        fxCtx.globalAlpha = 1;
      }
    }

    /** 热浪：冷却中的刻痕与熔池渲进窄带，再按行加水平正弦位移贴回（高斯加权，随温度衰减） */
    function drawHotLayers(dist: number, moltenScale: number, heat: number) {
      const shimmerAmp = heat * Math.max(0.5, line!.size * 0.02);
      if (bandCtx && bandC && shimmerAmp >= 0.12) {
        const g = bandCtx;
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        g.clearRect(0, 0, W, bandH);
        drawCooled(1, g, -bandY);
        moltenStrokes(dist, moltenScale, g, -bandY);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const SLICE = 2;
        const mid = bandH / 2;
        const sigma = Math.max(24, line!.size * 0.62);
        for (let y = 0; y < bandH; y += SLICE) {
          const sh = Math.min(SLICE, bandH - y);
          const wgt = Math.exp(-((y - mid) * (y - mid)) / (2 * sigma * sigma));
          const off = Math.sin(y * 0.05 + clock * 11) * shimmerAmp * wgt;
          ctx.drawImage(bandC, 0, y * DPR, W * DPR, sh * DPR, off, bandY + y, W, sh);
        }
      } else {
        drawCooled(1);
        moltenStrokes(dist, moltenScale);
      }
      moltenBloom(dist, moltenScale);
    }

    /** 掠面高光：一道软光带沿金属字面扫过，mask 锁在字形内 */
    function drawSheen(p: number, alpha: number) {
      if (!line || !sheenCtx || !sheenC || alpha <= 0) return;
      const g = sheenCtx;
      const lw = line.w, lh = line.h;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, lw, lh);
      const c = lerp(-0.3, 1.3, p) * lw;
      const half = line.size * 0.9;
      const grad = g.createLinearGradient(c - half, 0, c + half, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(line.fill, 0, 0, lw, lh);
      g.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha;
      ctx.drawImage(sheenC, line.x, line.y, lw, lh);
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

    /** 收尾重音：横条 bookend + 一次整体光呼吸 + 一道掠面高光，播完即止 */
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

      if (t >= SHEEN_AT) {
        const sp = clamp((t - SHEEN_AT) / SHEEN_LEN, 0, 1);
        if (sp < 1) drawSheen(sp, 0.34 * Math.sin(sp * Math.PI));
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

    // ===== v10：挂字猫绘制（局部坐标：原点=咬合点，+y 沿身体下垂；单位×catScale 成像素） =====
    function blinkK() {
      if (catBlinkT < 0) return 0;
      if (catBlinkT < 0.08) return catBlinkT / 0.08;
      if (catBlinkT < 0.14) return 1;
      return 1 - (catBlinkT - 0.14) / 0.14;
    }

    function mixC(a: readonly number[], b: readonly number[], t: number) {
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }

    /** 双笔触猫线：宽柔 + 细亮，与文字刻痕同语言（局部单位线宽） */
    function catStroke(path: (g: CanvasRenderingContext2D) => void, wScale = 1) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(232,232,236,0.18)";
      ctx.lineWidth = 4.4 * wScale;
      ctx.beginPath(); path(ctx); ctx.stroke();
      ctx.strokeStyle = "rgba(240,240,244,0.92)";
      ctx.lineWidth = Math.max(1.2, 1.6 * wScale);
      ctx.beginPath(); path(ctx); ctx.stroke();
    }

    /** 挂猫躯体：头（婴儿比，咬合点在头顶）→ 胸腹下坠 → 一搭一垂的前爪 → 一伸一缩的后腿 */
    function drawCatBody() {
      // 极淡体积底（幽灵蓝图同族），让线稿有"身体"
      ctx.fillStyle = "rgba(234,236,240,0.07)";
      ctx.beginPath();
      ctx.moveTo(-7, 3);
      ctx.quadraticCurveTo(-20, -3, -25, 8);
      ctx.quadraticCurveTo(-29, 19, -21, 27);
      ctx.quadraticCurveTo(-12, 33, -1, 30);
      ctx.quadraticCurveTo(10, 25, 11, 12);
      ctx.quadraticCurveTo(9, 4, -7, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-16, 29);
      ctx.quadraticCurveTo(-23, 42, -22, 56);
      ctx.quadraticCurveTo(-21, 72, -14, 84);
      ctx.quadraticCurveTo(-8, 93, 1, 93);
      ctx.quadraticCurveTo(10, 90, 12, 78);
      ctx.quadraticCurveTo(16, 58, 13, 42);
      ctx.quadraticCurveTo(11, 31, 2, 29);
      ctx.closePath();
      ctx.fill();
      // 耳（先画，头线自然切过耳根）：近耳大、远耳小
      catStroke((g) => {
        g.moveTo(-21, 0);
        g.quadraticCurveTo(-27, -8, -30, -17);
        g.quadraticCurveTo(-23.5, -13, -19.5, -6);
      });
      catStroke((g) => {
        g.moveTo(-9, -2);
        g.quadraticCurveTo(-11, -12, -16, -22);
        g.quadraticCurveTo(-16, -13, -12.5, -5);
      });
      // 头轮廓（嘴部卡在 y≈0 的字缘上）
      catStroke((g) => {
        g.moveTo(-7, 3);
        g.quadraticCurveTo(-20, -3, -25, 8);
        g.quadraticCurveTo(-29, 19, -21, 27);
        g.quadraticCurveTo(-12, 33, -1, 30);
        g.quadraticCurveTo(10, 25, 11, 12);
        g.quadraticCurveTo(9, 4, -7, 3);
      });
      // 躯干（左腹饱、右背直，锥形下坠）
      catStroke((g) => {
        g.moveTo(-16, 29);
        g.quadraticCurveTo(-23, 42, -22, 56);
        g.quadraticCurveTo(-21, 72, -14, 84);
        g.quadraticCurveTo(-8, 93, 1, 93);
        g.quadraticCurveTo(10, 90, 12, 78);
        g.quadraticCurveTo(16, 58, 13, 42);
        g.quadraticCurveTo(11, 31, 2, 29);
      });
      // 近前爪：自然垂落
      catStroke((g) => {
        g.moveTo(-13, 38);
        g.quadraticCurveTo(-17, 50, -15, 60);
      });
      catStroke((g) => {
        g.ellipse(-14.5, 63, 5, 4, 0, 0, Math.PI * 2);
      }, 0.8);
      // 远前爪：搭在字的右下角
      catStroke((g) => {
        g.moveTo(8, 34);
        g.quadraticCurveTo(15, 22, 17, 10);
      }, 0.8);
      catStroke((g) => {
        g.ellipse(17.5, 7, 4.5, 3.5, 0, 0, Math.PI * 2);
      }, 0.7);
      // 后腿：一伸一缩
      catStroke((g) => {
        g.moveTo(9, 88);
        g.quadraticCurveTo(7, 100, 2, 109);
      }, 0.8);
      catStroke((g) => {
        g.ellipse(1.5, 111, 5, 4, 0, 0, Math.PI * 2);
      }, 0.7);
      catStroke((g) => {
        g.moveTo(-6, 90);
        g.quadraticCurveTo(-8, 97, -5, 103);
      }, 0.7);
      catStroke((g) => {
        g.ellipse(-4.5, 105, 4.5, 3.5, 0, 0, Math.PI * 2);
      }, 0.6);
    }

    /** 尾：右髋出发的三节链，基角成问号钩；欢快摇 = 相位滞后行波 + 身体角速度耦合 */
    function drawCatTail() {
      const base = [-75, -30, 15];
      const amp = [0.17, 0.35, 0.56];
      const ramp = catCaught ? clamp((catT - CAT_CATCH_T) / 1.0, 0, 1) : 0;
      const sway = (i: number) =>
        reduced ? 0 :
        ramp * amp[i] * Math.sin((catClock * Math.PI * 2) / CAT_TAIL_PERIOD - 0.8 * i) -
        clamp(catOmega, -6, 6) * 0.045 * (3 - i) * 0.5;
      const pts: [number, number][] = [[11, 82]];
      let a = 0, x = 11, y = 82;
      for (let i = 0; i < 3; i++) {
        a = (base[i] * Math.PI) / 180 + sway(i);
        x += Math.cos(a) * 13;
        y += Math.sin(a) * 13;
        pts.push([x, y]);
      }
      const widths = [1.0, 0.82, 0.66];
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? "rgba(232,232,236,0.18)" : "rgba(240,240,244,0.92)";
        for (let i = 0; i < 3; i++) {
          ctx.lineWidth = (pass === 0 ? 4.2 : Math.max(1.2, 1.6)) * widths[i];
          ctx.beginPath();
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
          ctx.stroke();
        }
      }
    }

    /** 四芒星闪眼（参数化星芒：竖长芒 + 横短芒 + 柔光核，lighter） */
    function drawCatGlint(cx: number, cy: number, R: number) {
      if (R <= 0.2) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(cx, cy);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.6);
      glow.addColorStop(0, "rgba(255,255,240,0.55)");
      glow.addColorStop(1, "rgba(255,255,240,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,248,0.95)";
      for (let k = 0; k < 2; k++) {
        const r = k === 0 ? R : R * 0.62;
        const w = r * 0.15;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(w, -w, r, 0);
        ctx.quadraticCurveTo(w, w, 0, r);
        ctx.quadraticCurveTo(-w, w, -r, 0);
        ctx.quadraticCurveTo(-w, -w, 0, -r);
        ctx.fill();
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
    }

    /** 脸：近眼大（蓝）、远眼小（金绿）、立缝瞳 + 眼神光 + 鼻 + 短须；眨眼成笑弧 */
    function drawCatFace() {
      const k = blinkK();
      const powerK = catT >= CAT_POWER_AT
        ? Math.sin(Math.PI * clamp((catT - CAT_POWER_AT) / CAT_POWER_LEN, 0, 1))
        : 0;
      const goldK = catGoldT >= 0 ? Math.sin((Math.PI * catGoldT) / 0.24) : 0;
      let bright = 0;
      if (catBlinkT >= 0.14) bright = Math.max(bright, 0.25 * (1 - clamp((catBlinkT - 0.14) / 0.14, 0, 1)));
      // 眼白底：杏仁轮廓（细银线）
      const eyeLid = (cx: number, cy: number, w: number, h: number) => {
        catStroke((g) => {
          g.moveTo(cx - w, cy);
          g.quadraticCurveTo(cx, cy - h, cx + w, cy);
          g.quadraticCurveTo(cx, cy + h * 0.9, cx - w, cy);
        }, 0.55);
      };
      const drawIris = (cx: number, cy: number, r: number, pal: { core: readonly number[]; edge: readonly number[]; hot: readonly number[] }, isNear: boolean) => {
        const core = pal.core, edge = pal.edge, hot = pal.hot;
        let cCol = mixC(core, hot, powerK);
        let eCol = mixC(edge, hot, powerK * 0.7);
        if (!isNear && goldK > 0) {
          cCol = mixC(core, CAT_GOLD, goldK);
          eCol = mixC(edge, CAT_GOLD, goldK * 0.8);
        }
        const iris = ctx.createRadialGradient(cx, cy - r * 0.18, r * 0.12, cx, cy, r);
        iris.addColorStop(0, cCol);
        iris.addColorStop(1, eCol);
        ctx.fillStyle = iris;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        const pb = 1 + 0.3 * catPupilBoost;
        ctx.fillStyle = "#101216";
        ctx.beginPath();
        ctx.ellipse(cx, cy, (isNear ? 0.95 : 0.62) * pb, (isNear ? 1.9 : 1.35) * pb, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.32, isNear ? 0.5 : 0.35, 0, Math.PI * 2); ctx.fill();
        if (bright > 0.01) {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `rgba(255,255,255,${bright.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
      };
      if (catT >= CAT_POWER_AT - 0.12) {
        // 近眼（蓝，大）
        if (k > 0.75) {
          catStroke((g) => { g.moveTo(-18, 12); g.quadraticCurveTo(-14, 15.5, -10, 12); }, 0.55);
        } else {
          eyeLid(-14, 12, 4, 3);
          ctx.save();
          ctx.translate(-14, 12);
          ctx.scale(1, Math.max(0.08, 1 - k));
          ctx.translate(14, -12);
          drawIris(-14, 12, 2.8, CAT_EYE_L, true);
          ctx.restore();
          // 星芒：眨眼后偶发，瞳孔右上
          if (catGlintT >= 0) {
            const s = Math.pow(Math.sin(Math.PI * clamp(catGlintT / 0.32, 0, 1)), 0.6);
            drawCatGlint(-11, 8.5, 5 * s);
          }
        }
        // 远眼（金绿，小）
        if (k > 0.75) {
          catStroke((g) => { g.moveTo(-2, 10); g.quadraticCurveTo(1, 12.5, 4, 10); }, 0.5);
        } else {
          eyeLid(1, 10, 2.6, 2.1);
          ctx.save();
          ctx.translate(1, 10);
          ctx.scale(1, Math.max(0.08, 1 - k));
          ctx.translate(-1, -10);
          drawIris(1, 10, 1.9, CAT_EYE_R, false);
          ctx.restore();
        }
      }
      // 鼻（小三角）
      catStroke((g) => {
        g.moveTo(-6, 17);
        g.lineTo(-2.6, 17);
        g.lineTo(-4.3, 19.2);
        g.closePath();
      }, 0.55);
      // 短须（贴颊后收）
      catStroke((g) => { g.moveTo(-27, 15); g.quadraticCurveTo(-31, 15.8, -33, 17.4); }, 0.45);
      catStroke((g) => { g.moveTo(-26, 19); g.quadraticCurveTo(-29.6, 20.8, -31, 22.8); }, 0.45);
      catStroke((g) => { g.moveTo(9, 17); g.quadraticCurveTo(12.6, 18.2, 14.4, 20); }, 0.45);
    }

    /** 咬合阴影：屏幕空间固定在枢轴（不随摆动旋转）——牙齿咬住字缘的可信接触 */
    function drawBiteShadow() {
      const x0 = catPX - 8 * catScale;
      const x1 = catPX + 10 * catScale;
      const y = catPY - 1;
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(10,12,16,0.55)";
      ctx.lineWidth = Math.max(1.5, 1.7 * catScale);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.lineWidth = Math.max(1.2, 1.3 * catScale);
      ctx.beginPath(); ctx.moveTo(x0 + 6 * catScale, y); ctx.lineTo(x0 + 6 * catScale, y + 2.2 * catScale); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 - 5 * catScale, y); ctx.lineTo(x1 - 5 * catScale, y + 2.2 * catScale); ctx.stroke();
      ctx.restore();
    }

    function drawCat() {
      if (catPhase === "off" || catLen <= 0) return;
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!catCaught) {
        // 坠落段：沿弹道 + 前倾 14° + 纵向拉伸；带一帧运动残影
        const tau = clamp((catT - CAT_FALL_AT) / CAT_FALL, 0, 1) * CAT_FALL;
        const pos = (t: number): [number, number] => [
          catPX + 159.6 + CAT_FALL_VX * t,
          catPY - 302.8 + 0.5 * CAT_FALL_G * t * t,
        ];
        ctx.save();
        ctx.globalAlpha = 0.22;
        const [gx, gy] = pos(Math.max(0, tau - 0.035));
        ctx.translate(gx, gy);
        ctx.rotate((14 * Math.PI) / 180);
        ctx.scale(catScale, catScale);
        drawCatBody();
        ctx.restore();
        const [fx, fy] = pos(tau);
        ctx.translate(fx, fy);
        ctx.rotate((14 * Math.PI) / 180);
        ctx.scale(0.92 * catScale, 1.15 * catScale);
        drawCatBody();
        drawCatTail();
        ctx.restore();
        return;
      }
      // 悬挂：绕咬合点摆动 + 呼吸 + 咬合挤压回弹
      let sx = 1, sy = 1;
      const cq = clamp((catT - CAT_CATCH_T) / CAT_SQUASH, 0, 1);
      if (cq < 1) {
        const comp = cq < 0.35 ? Math.sin((cq / 0.35) * (Math.PI / 2)) : Math.cos(((cq - 0.35) / 0.65) * Math.PI);
        sy *= 1 - 0.2 * comp;
        sx *= 1 + 0.14 * comp;
      }
      if (catPhase === "live" && !reduced) {
        sy *= 1 + 0.012 * Math.sin((catClock * Math.PI * 2) / CAT_BREATH_PERIOD);
      }
      ctx.translate(catPX, catPY);
      ctx.rotate(catTheta);
      ctx.scale(sx * catScale, sy * catScale);
      drawCatTail();
      drawCatBody();
      drawCatFace();
      ctx.restore();
      drawBiteShadow();
    }

    /** 物理归零 → 微风正弦接管：相位对齐当前 θ/ω（幅相双连续，无跳变） */
    function breezeHandoff() {
      const A = Math.min(Math.max(0.035, Math.abs(catTheta)), 0.12);
      catBreezeAmp = A;
      catBreezePhase = Math.asin(clamp(catTheta / A, -1, 1));
      if (Math.cos(catBreezePhase) * catOmega < 0) catBreezePhase = Math.PI - catBreezePhase;
      catPhys = false;
      catSettleAcc = 0;
    }

    function drawSettled(withSpec: boolean) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!line) return;
      // 挂字猫咬合/摆动的重量：文字绕咬合点微沉微倾后回弹
      if (catDipK > 0.001) {
        const q = 1 - catDipK;
        const dip = 2.2 * Math.sin(Math.PI * Math.min(1, q * 1.15)) * catDipK + 1.2 * catDipK;
        const tilt = 0.02 * Math.sin(Math.PI * Math.min(1, q * 1.15)) * catDipK;
        ctx.save();
        ctx.translate(catPX, catPY);
        ctx.rotate(tilt);
        ctx.translate(-catPX, -catPY);
        ctx.translate(0, dip);
      }
      ctx.drawImage(line.fill, line.x, line.y, line.w, line.h);
      if (catDipK > 0.001) ctx.restore();
      if (withSpec) drawSpecular();
    }

    // ===== 阶段编排 =====
    /** 相机：全程缓推 1.035→1.0，雕刻/冷却期随激光头微漂，显影落焦时归位 */
    function applyCamera() {
      if (!stage || !line || reduced) return;
      let s = 1, k = 1;
      if (phase === "engrave") {
        const q = clamp(phaseT / T_ENGRAVE, 0, 1);
        s = lerp(1.035, 1.022, 1 - (1 - q) * (1 - q));
      } else if (phase === "cool") {
        const q = clamp(phaseT / (T_KILL + T_COOL), 0, 1);
        s = lerp(1.022, 1.012, q);
      } else if (phase === "reveal") {
        const q = clamp(phaseT / T_REVEAL, 0, 1);
        s = lerp(1.012, 1, q * q * (3 - 2 * q));
        k = 1 - q;
      } else {
        stage.style.transform = "";
        return;
      }
      const tx = (headX - W / 2) * 0.014 * k;
      const ty = (headY - H * 0.46) * 0.012 * k;
      camX += (tx - camX) * 0.085;
      camY += (ty - camY) * 0.085;
      stage.style.transform = `translate3d(${(-camX * k).toFixed(2)}px, ${(-camY * k).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
    }

    /** 待机微光：settle 后每隔几秒让金属表面再掠过一道弱光 */
    function scheduleIdleSheen(delay?: number) {
      if (reduced) return;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (disposed || !line) return;
        if (document.hidden) { scheduleIdleSheen(3000); return; }
        idleSheenT = 0;
        // v9：金属掠光与猫眨眼同窗——整幅同呼吸
        if (catPhase === "live") catBlinkT = 0;
        ensureLoop();
      }, delay ?? 5500 + Math.random() * 3000);
    }

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
      if (stage) stage.style.transform = "";
      sparks = [];
      if (fxCanvas) {
        fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        fxCtx.clearRect(0, 0, W, H);
      }
      revealUi();
      // 落款永在：跳过/回退直接给出挂稳的小猫
      if (catPhase !== "live") {
        catPhase = "live";
        catCaught = true;
        catT = 3;
        catPhys = false;
        catTheta = 0.02;
        catBreezeAmp = 0.035;
        catBreezePhase = Math.PI / 6;
      }
      drawSettled(false);
      drawCat();
      scheduleIdleSheen(4200);
    }

    /** 重音播完即销毁：描边遮罩与合成 scratch 此后无人读取（sheen/spec 常驻） */
    function releaseScratch() {
      strokeMask = null;
      strokeMaskCtx = null;
      maskedScratch = null;
      maskedScratchCtx = null;
      sweepScratch = null;
      sweepScratchCtx = null;
      bloomC = null;
      bloomCtx = null;
      bandC = null;
      bandCtx = null;
    }

    function advance(dt: number) {
      phaseT += dt;
      switch (phase) {
        case "engrave": {
          if (phaseT >= T_ENGRAVE) {
            phase = "cool";
            phaseT = 0;
            paintCooled(line!.strokeLen);
            killBurst();
          }
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
            // 重音播完：进入静止。仅 specular / 待机微光时才继续跑帧
            specAwake = finePointer && !reduced && performance.now() - lastPointerAt < 400;
            if (!released) {
              released = true;
              releaseScratch();
              scheduleIdleSheen();
              // v10 coda：重音播完 RAF 不停——小猫自右上斜抛入场，咬住句尾
              catPhase = "coda";
              catT = 0;
              catClock = 0;
              catBlinked = false;
              catCaught = false;
              catPhys = false;
              catTheta = 0;
              catOmega = 0;
              catDipK = 0;
              catSettleAcc = 0;
              catGlintT = -1;
              catGlintTimer = 3 + Math.random() * 3;
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
        drawHotLayers(dist, 1, 0.85);
        const pos = posAt(dist);
        const nx = line.x + pos.x, ny = line.y + pos.y;
        if (pos.active) {
          const dx = nx - headX, ddy = ny - headY;
          const dl = Math.hypot(dx, ddy);
          if (dl > 0.01) { headDirX = dx / dl; headDirY = ddy / dl; }
        }
        headX = nx;
        headY = ny;
        drawBeam(headX, headY, pos.active ? 1 : 0.4);
        drawHead(headX, headY, pos.active ? 1 : 0.35);
      } else if (phase === "cool") {
        const coolP = clamp(phaseT / (T_KILL + T_COOL), 0, 1);
        const dieK = clamp(1 - phaseT / 0.12, 0, 1);
        drawGhost();
        drawHotLayers(line.strokeLen, (1 - coolP) * (1 - coolP), 0.85 * (1 - coolP));
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
        if (idleSheenT >= 0) {
          const p = clamp(idleSheenT / IDLE_SHEEN_LEN, 0, 1);
          drawSheen(p, 0.13 * Math.sin(p * Math.PI));
        }
        drawCat();
      }
    }

    function shouldContinue() {
      if (phase !== "settled") return true;
      if (phaseT < T_CLIMAX) return true;
      if (idleSheenT >= 0) return true;
      // v10：挂字猫在场（坠落/摆动或常驻生命感）则帧循环不熄火
      if (catPhase !== "off") return true;
      return specAwake;
    }

    let last = performance.now();
    function loop(now: number) {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      if (specAwake) {
        specX += (specTX - specX) * 0.22;
        specY += (specTY - specY) * 0.22;
        if (now - lastPointerAt > 400) specAwake = false;
      }
      // 雕刻期持续飞溅：火星逆行进方向喷出，带横向散布与上抛初速
      if (phase === "engrave") {
        spawnAcc += dt * 90;
        while (spawnAcc >= 1) {
          spawnAcc -= 1;
          const back = 30 + Math.random() * 110;
          const perp = (Math.random() - 0.5) * 100;
          const lift = 14 + Math.random() * 58;
          const px = -headDirY, py = headDirX;
          spawnSpark(
            headX + (Math.random() - 0.5) * 3,
            headY + (Math.random() - 0.5) * 3,
            -headDirX * back + px * perp,
            -headDirY * back + py * perp - lift
          );
        }
      }
      if (idleSheenT >= 0) {
        idleSheenT += dt;
        if (idleSheenT >= IDLE_SHEEN_LEN) {
          idleSheenT = -1;
          scheduleIdleSheen();
        }
      }
      updateSparks(dt);
      // ===== v10：挂字猫时钟、坠落到咬合、单摆积分与微风接管 =====
      if (catPhase !== "off") {
        catClock += dt;
        catT += dt;
        if (catBlinkT >= 0) {
          catBlinkT += dt;
          if (catBlinkT >= 0.28) catBlinkT = -1;
        }
        if (catGoldT >= 0) {
          catGoldT += dt;
          if (catGoldT >= 0.24) catGoldT = -1;
        }
        if (catGlintT >= 0) {
          catGlintT += dt;
          if (catGlintT >= 0.32) catGlintT = -1;
        }
        catPupilBoost = Math.max(0, catPupilBoost - dt / 0.5);
        catchFlashT = Math.max(0, catchFlashT - dt);
        catDipK = Math.max(0, catDipK - dt / 0.18);
        if (catPhase === "coda" && !catCaught && catT >= CAT_CATCH_T) {
          // 咬合：白闪 + 微火花 + 文字下陷 + 摆初值（掠过字面再荡出）
          catCaught = true;
          catPhys = true;
          catTheta = 0.24;
          catOmega = -8;
          catchFlashT = 0.06;
          catDipK = 1;
          for (let i = 0; i < 8; i++) {
            const a = -Math.PI * (0.15 + Math.random() * 0.7);
            const sp = 40 + Math.random() * 110;
            spawnSpark(catPX, catPY + 2, Math.cos(a) * sp, Math.sin(a) * sp - 30);
          }
        }
        if (!catBlinked && catCaught && catT >= CAT_BLINK_AT) {
          catBlinked = true;
          catBlinkT = 0;
        }
        if (catPhase === "coda" && catT >= CAT_BREEZE_AT) {
          catPhase = "live";
          breezeHandoff();
        }
        if (catCaught && catPhys) {
          // 半隐式欧拉 ×2 子步（辛积分，能量有界）
          const h = Math.min(dt, 0.05) / 2;
          for (let i = 0; i < 2; i++) {
            catOmega += (-(CAT_OMEGA_N * CAT_OMEGA_N) * Math.sin(catTheta) - CAT_DAMP * catOmega) * h;
            catTheta += catOmega * h;
          }
          catOmega = clamp(catOmega, -12, 12);
        }
        if (catPhase === "live") {
          if (!catPhys) {
            catTheta = catBreezeAmp * Math.sin((catClock * Math.PI * 2) / 5.2 + catBreezePhase);
            catGlintTimer -= dt;
            if (catGlintTimer <= 0) {
              catGlintTimer = 4 + Math.random() * 5;
              if (!reduced && Math.random() < 0.75) {
                catGlintT = 0;
                catPupilBoost = 1;
              }
            }
          } else if (Math.abs(catTheta) < 0.044 && Math.abs(catOmega) < 0.35) {
            // Enter 冲量摆动收敛 → 回微风
            catSettleAcc += dt;
            if (catSettleAcc >= 0.2) breezeHandoff();
          } else {
            catSettleAcc = 0;
          }
        }
      }
      // 胶片颗粒换步（~11fps 跳变，胶片感而非电视雪花）
      grainClock += dt;
      if (grainClock >= 0.09) {
        grainClock = 0;
        grainOx = -Math.floor(Math.random() * 96);
        grainOy = -Math.floor(Math.random() * 96);
      }
      advance(dt);
      applyCamera();
      // live 静息期隔帧绘制（~30fps 降耗）；任何事件帧恢复满帧
      const lazy = catPhase === "live" && phase === "settled" && phaseT >= T_CLIMAX &&
        !specAwake && idleSheenT < 0 && catBlinkT < 0 && catGoldT < 0 && catGlintT < 0 && !catPhys;
      frameParity ^= 1;
      if (!(lazy && frameParity === 1)) {
        drawScene();
        drawFx();
      }
      if (shouldContinue()) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
        drawSettled(false);
        if (catPhase !== "off") drawCat();
      }
    }

    function ensureLoop() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function resize() {
      // 同尺寸同 DPR 的假 resize（CDP 度量覆盖、移动端地址栏抖动的无变化回调）不重播动画；
      // DPR 量化到 2 位小数再比，避免 1.00000003 这类脏值击穿守卫
      const nDPR = Math.round(Math.min(window.devicePixelRatio || 1, 2) * 100) / 100;
      const nW = window.innerWidth;
      const nH = window.innerHeight;
      if (nDPR === DPR && nW === W && nH === H && line) return;
      DPR = nDPR;
      W = nW;
      H = nH;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      fxCanvas.width = canvas.width;
      fxCanvas.height = canvas.height;
      fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!font) return;
      initLayout();
      sparks = [];
      spawnAcc = 0;
      camX = 0;
      camY = 0;
      if (phase === "settled") {
        if (stage) stage.style.transform = "";
        // 坠落/摆动中改尺寸：猫一步挂稳；已 live：θ 与几何无关，照常在场
        if (catPhase === "coda") {
          catPhase = "live";
          catCaught = true;
          catT = 3;
          catPhys = false;
          catTheta = clamp(catTheta, -0.05, 0.05);
          catBreezeAmp = 0.035;
          catBreezePhase = Math.PI / 6;
        }
        drawSettled(false);
        drawCat();
      } else if (phase !== "loading") {
        phase = "engrave";
        phaseT = 0;
        resetStrokeMask();
        catPhase = "off";
        catT = 0;
        catCaught = false;
        catPhys = false;
        catBlinkT = -1;
        catGoldT = -1;
        catGlintT = -1;
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
    buildGrain();
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
      else if (catPhase === "coda") {
        // coda 同样可跳：猫一步挂稳
        catPhase = "live";
        catCaught = true;
        catT = 3;
        catPhys = false;
        catTheta = 0.02;
        catBreezeAmp = 0.035;
        catBreezePhase = Math.PI / 6;
        ensureLoop();
      }
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

    // v9：切后台暂停 RAF（呼吸/尾摆不空烧电池），回前台续跑
    const onVisibility = () => {
      if (document.hidden) {
        if (running) {
          cancelAnimationFrame(raf);
          running = false;
        }
      } else if (!reduced) {
        ensureLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Enter 目送：给摆一个冲量（向画面中心荡——鞠躬告别）+ 慢眨 + 右眼香槟金（handleEnter 在 effect 外，经 ref 桥接进来）
    catApiRef.current.farewell = () => {
      if (reduced || disposed) return;
      if (catPhase === "coda") {
        if (!catCaught) {
          catCaught = true;
          catchFlashT = 0.06;
          catTheta = 0.24;
          catOmega = -8;
        }
        catPhase = "live";
        catT = Math.max(catT, 3);
      }
      if (catPhase === "live") {
        if (!catPhys) {
          // 从微风正弦取当前角速度，接进物理积分
          catOmega = catBreezeAmp * ((Math.PI * 2) / 5.2) * Math.cos((catClock * Math.PI * 2) / 5.2 + catBreezePhase);
          catPhys = true;
        }
        catOmega += -2.4;
        catBlinkT = 0;
        catGoldT = 0;
      }
      ensureLoop();
    };

    return () => {
      disposed = true;
      fontController.abort();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(bootRafRef.current);
      clearTimeout(resizeTimer);
      window.clearTimeout(idleTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("keydown", onSkip);
      window.removeEventListener("wheel", onSkip);
      window.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.classList.remove("laser-forge");
    };
  }, []);

  const bootFillRef = useRef<HTMLElement>(null);
  const bootPctRef = useRef<HTMLSpanElement>(null);
  const bootStageRef = useRef<HTMLSpanElement>(null);
  const bootRafRef = useRef(0);

  /** 阶段色锚点：银 → 金 → 深金，百分比颜色沿其插值 */
  function bootColor(p: number) {
    const stops: [number, number, number][] = [
      [245, 245, 247],
      [245, 215, 110],
      [201, 150, 47]
    ];
    const t = clamp(p, 0, 1) * 2;
    const i = t < 1 ? 0 : 1;
    const k = t < 1 ? t : t - 1;
    const a = stops[i];
    const b = stops[i + 1];
    const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  /** 填充/百分比/阶段词同源驱动，节奏与 CSS 的 0.34s 延迟 + 1.05s 填充对齐 */
  function startBootDriver() {
    const fill = bootFillRef.current;
    const pct = bootPctRef.current;
    const stage = bootStageRef.current;
    if (!fill || !pct || !stage) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = easeReveal(clamp((now - t0 - 340) / 1050, 0, 1));
      fill.style.transform = `scaleX(${p})`;
      fill.style.backgroundPosition = `${(p * 100).toFixed(1)}% 0`;
      pct.textContent = `${Math.round(p * 100)}%`;
      pct.style.color = bootColor(p);
      stage.textContent = p < 0.34 ? "熄刀" : p < 0.72 ? "过桥" : "落厅";
      if (p < 1) bootRafRef.current = requestAnimationFrame(tick);
    };
    bootRafRef.current = requestAnimationFrame(tick);
  }

  const navigatingRef = useRef(false);

  function handleEnter() {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    catApiRef.current.farewell?.();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    canvasRef.current?.parentElement?.classList.add("is-exiting");
    tintRef.current?.classList.add("is-active");
    if (reduce) {
      setTimeout(() => router.push("/modules"), 460);
      return;
    }
    containerRef.current?.classList.add("is-booting");
    startBootDriver();
    router.prefetch("/modules");
    // 进度充满 → 徽标淡出 → 落入大厅；节奏对齐 CSS（fill 0.34s+1.05s，leave 1.38s）
    setTimeout(() => containerRef.current?.classList.add("is-leaving"), 1380);
    setTimeout(() => router.push("/modules"), 1700);
  }

  return (
    <div ref={containerRef} className="laser-forge">
      <div ref={stageRef} className="forge-stage" aria-hidden="true">
        <canvas ref={canvasRef} className="forge-canvas" />
        <canvas ref={fxCanvasRef} className="forge-fx" />
      </div>
      <div ref={tintRef} className="exit-tint" aria-hidden="true" />
      <div className="boot-layer" aria-hidden="true">
        <div className="boot-mark">N</div>
        <div className="boot-gauge">
          <div className="boot-progress"><i ref={bootFillRef} /></div>
          <div className="boot-meta">
            <span ref={bootStageRef} className="boot-stage">熄刀</span>
            <span ref={bootPctRef} className="boot-pct">0%</span>
          </div>
        </div>
      </div>
      {!fontReady && !fontError && <div className="forge-loading">Zz.one</div>}

      <div ref={eyebrowRef} className="forge-eyebrow">Ninglo · Vault of Ink</div>
      <div ref={subRef} className="forge-sub">以墨观势 · 驭数入墨</div>
      <button ref={enterRef} className="enter-gate" onClick={handleEnter} aria-label="进入 Zz.one 模块大厅">
        Enter
      </button>
    </div>
  );
}
