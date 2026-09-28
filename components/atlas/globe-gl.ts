/**
 * 舆图卫星球 —— 零依赖手写 WebGL 光线投射球（fullscreen quad + 片元着色器求交）。
 * 与 2D 覆盖层共用同一套正交投影参数（R/cx/cy/视角基向量/太阳向量），像素级对齐：
 * 屏幕偏移 p（y 向上）→ 世界方向 v = p.x·Rt + p.y·N + sqrt(1-|p|²)·E，与 AtlasMap 的
 * 逐点投影公式同源。日面/夜灯双纹理按真实太阳高度混合（晨昏带 smoothstep），
 * 内侧菲涅尔 rim + 外圈包浆辉光，夜灯 γ 提亮成「文明弧」。
 *
 * 失败纪律：上下文创建 / 着色器编译 / 纹理加载任一失败 → ok=false 或 ready=false，
 * 调用方回退点阵水墨球（2D 路径永不删除，即回退层本身）。纹理资产来自
 * three.js 示例（earth_day_4096 / earth_night_4096，仓库 MIT，源自 NASA 公有领域影像）。
 */

export interface GlobeGLView {
  W: number;
  H: number;
  DPR: number;
  cx: number; // CSS px
  cy: number; // CSS px（top-down）
  R: number; // CSS px（含 zoom）
  Ex: number; Ey: number; Ez: number;
  Nx: number; Ny: number; Nz: number;
  Rx: number; Ry: number; Rz: number;
  Sx: number; Sy: number; Sz: number; // 太阳方向（地理系）
  k: number; // 整体亮度（boot ramp）
  nightK: number; // 夜灯系数（boot settle 过冲）
}

export interface GlobeGL {
  ok: boolean;
  ready: () => boolean;
  render: (v: GlobeGLView) => void;
  resize: (wDev: number, hDev: number) => void;
  dispose: () => void;
}

const VERT = `
attribute vec2 aP;
void main() { gl_Position = vec4(aP, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;   // 设备像素（y 已翻转为 bottom-up 原点）
uniform float uRadius;  // 设备像素
uniform vec3 uRt;
uniform vec3 uN;
uniform vec3 uE;
uniform vec3 uSun;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform float uK;
uniform float uNightK;

void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uRadius; // 屏幕平面偏移，y 向上
  float r2 = dot(p, p);
  if (r2 > 1.1488) { gl_FragColor = vec4(0.0); return; } // 1.072² 外辉光止境
  if (r2 > 1.0) {
    // 外圈包浆辉光（冷银，克制）；吃 uK——boot 前半程不先有光环后有球
    float t = (sqrt(r2) - 1.0) / 0.072;
    float a = (1.0 - t) * (1.0 - t) * 0.11 * uK;
    gl_FragColor = vec4(0.789, 0.831, 0.894, a);
    return;
  }
  float z = sqrt(1.0 - r2);
  vec3 v = p.x * uRt + p.y * uN + z * uE;
  float lon = atan(v.y, v.x);
  float lat = asin(clamp(v.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 + lon * 0.15915494, 0.5 + lat * 0.31830989); // flipY 后 v=0 为 -90°
  float sun = dot(v, uSun);
  float dayK = smoothstep(-0.13, 0.17, sun); // 晨昏带（约 -7.5°→+9.8°，照片上略放宽才不显硬）
  vec3 day = texture2D(uDay, uv).rgb;
  vec3 nightRaw = texture2D(uNight, uv).rgb;
  // 夜灯提亮 + 轻暖调：城市灯光读作「文明弧」而非灰色噪声
  vec3 nightLit = pow(nightRaw, vec3(0.82)) * vec3(1.30, 1.08, 0.78) * uNightK;
  // 日面随太阳高度做轻微朗伯，避免晨昏带内死白
  vec3 dayLit = day * (0.78 + 0.22 * clamp(sun, 0.0, 1.0));
  vec3 col = mix(nightLit, dayLit, dayK);
  // 冷灰 grade：照片向银蓝墨色靠半步，灯与芯片的金/朱坐回同一张纸
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma) * vec3(0.88, 0.93, 1.05), 0.10);
  // 内侧菲涅尔 rim：日照侧银蓝边光，夜侧让给灯
  float fres = pow(1.0 - z, 3.0);
  col += vec3(0.789, 0.831, 0.894) * fres * (0.05 + 0.14 * max(sun, 0.0));
  gl_FragColor = vec4(col * uK, 1.0);
}
`;

export function createGlobeGL(canvas: HTMLCanvasElement, dayUrl: string, nightUrl: string): GlobeGL {
  const fail: GlobeGL = { ok: false, ready: () => false, render: () => {}, resize: () => {}, dispose: () => {} };
  let gl: WebGLRenderingContext | null = null;
  try {
    // antialias:false——球轮廓由片元着色器算出，MSAA 对无几何边缘无效，只耗带宽
    gl = canvas.getContext("webgl", { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: false });
  } catch {
    return fail;
  }
  if (!gl) return fail;
  const g = gl;

  function compile(type: number, src: string): WebGLShader | null {
    const sh = g.createShader(type);
    if (!sh) return null;
    g.shaderSource(sh, src);
    g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
      g.deleteShader(sh);
      return null;
    }
    return sh;
  }

  const vs = compile(g.VERTEX_SHADER, VERT);
  const fs = compile(g.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return fail;
  const prog = g.createProgram();
  if (!prog) return fail;
  g.attachShader(prog, vs);
  g.attachShader(prog, fs);
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) return fail;
  g.useProgram(prog);

  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const aP = g.getAttribLocation(prog, "aP");
  g.enableVertexAttribArray(aP);
  g.vertexAttribPointer(aP, 2, g.FLOAT, false, 0, 0);

  const U = {
    res: g.getUniformLocation(prog, "uRes"),
    center: g.getUniformLocation(prog, "uCenter"),
    radius: g.getUniformLocation(prog, "uRadius"),
    rt: g.getUniformLocation(prog, "uRt"),
    n: g.getUniformLocation(prog, "uN"),
    e: g.getUniformLocation(prog, "uE"),
    sun: g.getUniformLocation(prog, "uSun"),
    day: g.getUniformLocation(prog, "uDay"),
    night: g.getUniformLocation(prog, "uNight"),
    k: g.getUniformLocation(prog, "uK"),
    nightK: g.getUniformLocation(prog, "uNightK"),
  };

  g.enable(g.BLEND);
  g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);

  let texturesReady = false;
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    // GPU 驱动重置后重传纹理（program/buffer 在 restored 后仍有效，纹理内容丢失）
    lost = false;
    texturesReady = false;
    dayOk = false;
    nightOk = false;
    reloadTextures();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function loadTex(url: string, unit: number, cb: (ok: boolean) => void) {
    const tex = g.createTexture();
    if (tex) textures.push(tex);
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([10, 14, 22, 255])); // 1px 墨底占位
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT); // 经度环绕接缝
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (lost || !tex) {
        cb(false);
        return;
      }
      try {
        // 纹理上限校验：老 GPU（MAX_TEXTURE_SIZE<4096）静默渲染黑球——把静默错变成回退
        if (g.getParameter(g.MAX_TEXTURE_SIZE) < Math.min(img.width, img.height)) {
          cb(false);
          return;
        }
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, tex);
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
        g.generateMipmap(g.TEXTURE_2D);
        if (g.getError() !== g.NO_ERROR) {
          cb(false);
          return;
        }
        cb(true);
      } catch {
        cb(false);
      }
    };
    img.onerror = () => cb(false);
    img.src = url;
  }

  let dayOk = false;
  let nightOk = false;
  const check = () => {
    texturesReady = dayOk && nightOk;
    if (texturesReady) {
      // 纹理就绪广播：让引擎立刻重画一帧切换到卫星模式（静止帧可能已停）
      try {
        window.dispatchEvent(new CustomEvent("atlas:gl-ready"));
      } catch {
        /* SSR/无 window 环境忽略 */
      }
    }
  };
  const textures: WebGLTexture[] = [];
  function reloadTextures() {
    textures.length = 0;
    dayOk = false;
    nightOk = false;
    texturesReady = false;
    loadTex(dayUrl, 0, (ok) => {
      dayOk = ok;
      check();
    });
    loadTex(nightUrl, 1, (ok) => {
      nightOk = ok;
      check();
    });
  }
  reloadTextures();
  if (process.env.NODE_ENV !== "production") {
    (canvas as unknown as Record<string, unknown>).__glDebug = { get ready() { return texturesReady && !lost; } };
  }

  return {
    ok: true,
    ready: () => texturesReady && !lost,
    resize(wDev: number, hDev: number) {
      if (lost) return;
      canvas.width = wDev;
      canvas.height = hDev;
      g.viewport(0, 0, wDev, hDev);
    },
    render(v: GlobeGLView) {
      if (lost || !texturesReady) return;
      g.useProgram(prog);
      g.uniform2f(U.res, v.W * v.DPR, v.H * v.DPR);
      g.uniform2f(U.center, v.cx * v.DPR, (v.H - v.cy) * v.DPR); // gl_FragCoord y 向上
      g.uniform1f(U.radius, Math.max(4, v.R * v.DPR));
      g.uniform3f(U.rt, v.Rx, v.Ry, v.Rz);
      g.uniform3f(U.n, v.Nx, v.Ny, v.Nz);
      g.uniform3f(U.e, v.Ex, v.Ey, v.Ez);
      g.uniform3f(U.sun, v.Sx, v.Sy, v.Sz);
      g.uniform1i(U.day, 0);
      g.uniform1i(U.night, 1);
      g.uniform1f(U.k, v.k);
      g.uniform1f(U.nightK, v.nightK);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // StrictMode 安全：只删资源不 loseContext（同 canvas 二次 getContext 会拿到已丢上下文，
      // dev 下卫星球从此永久回退）；上下文交 GC/页面卸载回收
      try {
        for (const t of textures) g.deleteTexture(t);
        textures.length = 0;
        g.deleteBuffer(buf);
        g.deleteProgram(prog);
        g.deleteShader(vs);
        g.deleteShader(fs);
      } catch {
        /* 忽略 */
      }
    },
  };
}
