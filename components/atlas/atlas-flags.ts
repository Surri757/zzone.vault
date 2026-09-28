/**
 * 舆图旗帜 —— 27 座交易所对应 22 面简笔国旗，全部内联 SVG 数据 URI。
 * 零外部请求（Windows 不渲染旗帜 emoji、flagcdn 类 CDN 受网络墙约束，
 * 自绘是唯一稳态）；绘制精度服务于 19~26px 下的识别度，复杂纹章
 * （枫叶/太极/南十字/bauhinia）做了像素级简化，不构成主权声明。
 * 坏 cc 返回 null，调用方画双字母占位，永不抛异常。
 */

/** 交易所 MIC → ISO 3166 国家/地区码（小写） */
const MIC_CC: Record<string, string> = {
  XSHG: "cn",
  XSHE: "cn",
  XBSE: "cn",
  XHKG: "hk",
  XTAI: "tw",
  XJPX: "jp",
  XKRX: "kr",
  XSES: "sg",
  XNSE: "in",
  XASX: "au",
  XSAU: "sa",
  XDUB: "ae",
  XJSE: "za",
  XMSM: "ru",
  XETR: "de",
  XPAR: "fr",
  XAMS: "nl",
  XSWX: "ch",
  XMIL: "it",
  XMAD: "es",
  XSTO: "se",
  XIST: "tr",
  XLON: "gb",
  XNYS: "us",
  XNAS: "us",
  XTSE: "ca",
  XMEX: "mx",
  BVMF: "br",
};

const rad = (d: number) => (d * Math.PI) / 180;

/** 五角星（rot 为首尖角度，-90 = 朝上） */
function star5(cx: number, cy: number, r: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rad(rot + i * 36);
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}

/** 四芒细星（南十字/英联邦星在微尺寸下的替身） */
function star4(cx: number, cy: number, r: number): string {
  const w = r * 0.32;
  return `<polygon points="${cx},${cy - r} ${cx + w},${cy - w} ${cx + r},${cy} ${cx + w},${cy + w} ${cx},${cy + r} ${cx - w},${cy + w} ${cx - r},${cy} ${cx - w},${cy - w}"/>`;
}

/** 放射线（青天白日十二道光芒 / 印度法轮辐条） */
function rays(cx: number, cy: number, r0: number, r1: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const a = rad((i * 360) / n);
    s += `<line x1="${(cx + r0 * Math.cos(a)).toFixed(2)}" y1="${(cy + r0 * Math.sin(a)).toFixed(2)}" x2="${(cx + r1 * Math.cos(a)).toFixed(2)}" y2="${(cy + r1 * Math.sin(a)).toFixed(2)}"/>`;
  }
  return s;
}

/** 卦象三爻（broken = 阴爻断开） */
function trigram(cx: number, cy: number, broken: boolean): string {
  let s = "";
  for (let i = -1; i <= 1; i++) {
    const y = (cy + i * 2.6 - 0.8).toFixed(2);
    s += broken
      ? `<rect x="${cx - 3.4}" y="${y}" width="2.9" height="1.6"/><rect x="${cx + 0.5}" y="${y}" width="2.9" height="1.6"/>`
      : `<rect x="${cx - 3.4}" y="${y}" width="6.8" height="1.6"/>`;
  }
  return s;
}

const R = (fill: string, x = 0, y = 0, w = 60, h = 40) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60" height="40">${inner}</svg>`;

const FLAGS: Record<string, string> = {
  cn: wrap(
    R("#de2910") +
      `<g fill="#ffde00">${star5(10, 10, 6)}${star5(20, 4, 2)}${star5(24, 8, 2)}${star5(24, 14, 2)}${star5(20, 18, 2)}</g>`,
  ),
  hk: wrap(
    R("#de2910") +
      `<g fill="#fff">${[0, 72, 144, 216, 288]
        .map((a) => `<ellipse cx="30" cy="14" rx="2.7" ry="6.8" transform="rotate(${a} 30 20)"/>`)
        .join("")}<circle cx="30" cy="20" r="2.4"/></g>`,
  ),
  tw: wrap(
    R("#fe0000") +
      R("#000095", 0, 0, 30, 21) +
      `<g fill="#fff"><circle cx="15" cy="10.5" r="4.2"/></g><g stroke="#fff" stroke-width="1">${rays(15, 10.5, 5, 7.4, 12)}</g>`,
  ),
  jp: wrap(R("#fff") + `<circle cx="30" cy="20" r="9.5" fill="#bc002d"/>`),
  kr: wrap(
    R("#fff") +
      `<g transform="rotate(-23 30 20)"><circle cx="30" cy="20" r="8" fill="#cd2e3a"/><path d="M30 12 a4 4 0 0 0 0 8 a4 4 0 0 1 0 8 a8 8 0 0 1 0 -16 z" fill="#0047a0"/></g><g fill="#101010">${trigram(12, 9, false)}${trigram(48, 9, true)}${trigram(12, 31, true)}${trigram(48, 31, false)}</g>`,
  ),
  sg: wrap(
    R("#ed2939", 0, 0, 60, 20) +
      R("#fff", 0, 20, 60, 20) +
      `<circle cx="10.5" cy="10" r="5.6" fill="#fff"/><circle cx="12.3" cy="9" r="4.7" fill="#ed2939"/><g fill="#fff">${star5(19.5, 5.6, 1.4)}${star5(23.9, 8.9, 1.4)}${star5(22.2, 14, 1.4)}${star5(16.8, 14, 1.4)}${star5(15.1, 8.9, 1.4)}</g>`,
  ),
  in: wrap(
    R("#ff9933", 0, 0, 60, 13.34) +
      R("#fff", 0, 13.33, 60, 13.34) +
      R("#138808", 0, 26.66, 60, 13.34) +
      `<g stroke="#000080" stroke-width="0.8">${rays(30, 20, 1.4, 4.8, 12)}</g><circle cx="30" cy="20" r="5.4" fill="none" stroke="#000080" stroke-width="1"/>`,
  ),
  au: wrap(
    R("#012169") +
      `<g><path d="M0 0 L30 20 M30 0 L0 20" stroke="#fff" stroke-width="4.5"/><path d="M0 0 L30 20 M30 0 L0 20" stroke="#cf142b" stroke-width="2"/><rect x="11" width="8" height="20" fill="#fff"/><rect y="6" width="30" height="8" fill="#fff"/><rect x="13" width="4" height="20" fill="#cf142b"/><rect y="8" width="30" height="4" fill="#cf142b"/></g><g fill="#fff">${star4(8, 31, 2.6)}${star4(43, 9, 1.9)}${star4(49, 18, 2.3)}${star4(44, 27, 2.2)}${star4(38, 20, 1.5)}${star4(51, 25, 1.2)}</g>`,
  ),
  de: wrap(R("#000") + R("#dd0000", 0, 13.33) + R("#ffce00", 0, 26.66)),
  fr: wrap(R("#002395") + R("#fff", 20) + R("#ed2939", 40)),
  gb: wrap(
    R("#012169") +
      `<path d="M0 0 L60 40 M60 0 L0 40" stroke="#fff" stroke-width="9"/><path d="M0 0 L60 40 M60 0 L0 40" stroke="#c8102e" stroke-width="5"/><rect x="25" width="10" height="40" fill="#fff"/><rect y="15" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="40" fill="#c8102e"/><rect y="17" width="60" height="6" fill="#c8102e"/>`,
  ),
  ch: wrap(R("#da291c") + `<g fill="#fff"><rect x="26" y="11" width="8" height="18"/><rect x="21" y="16" width="18" height="8"/></g>`),
  it: wrap(R("#009246") + R("#fff", 20) + R("#ce2b37", 40)),
  es: wrap(R("#aa151b") + R("#f1bf00", 0, 10, 60, 20)),
  se: wrap(R("#006aa7") + `<rect x="17" width="8" height="40" fill="#fecc00"/><rect y="16" width="60" height="8" fill="#fecc00"/>`),
  tr: wrap(R("#e30a17") + `<circle cx="24" cy="20" r="8" fill="#fff"/><circle cx="26.5" cy="20" r="6.6" fill="#e30a17"/><g fill="#fff">${star5(35.5, 20, 3.4, 180)}</g>`),
  za: wrap(
    R("#de3831") +
      R("#002395", 0, 20, 60, 20) +
      `<path d="M2 20 L34 20 M34 20 L60 3 M34 20 L60 37" stroke="#fff" stroke-width="11" fill="none"/><path d="M2 20 L34 20 M34 20 L60 3 M34 20 L60 37" stroke="#007a4d" stroke-width="6.5" fill="none"/><polygon points="0,0 24,17.6 24,22.4 0,40" fill="#ffb612"/><polygon points="0,4 17,20 0,36" fill="#000"/>`,
  ),
  ru: wrap(R("#fff") + R("#0039a6", 0, 13.33) + R("#d52b1e", 0, 26.66)),
  us: wrap(
    R("#fff") +
      `<g fill="#b22234">${[0, 1, 2, 3, 4, 5, 6].map((i) => R("#b22234", 0, i * 2 * (40 / 13), 60, 40 / 13)).join("")}</g>${R("#3c3b6e", 0, 0, 26, 21.6)}<g fill="#fff">${Array.from({ length: 30 }, (_, k) => `<circle cx="${3 + (k % 6) * 4}" cy="${3.4 + Math.floor(k / 6) * 3.6}" r="0.85"/>`).join("")}</g>`,
  ),
  ca: wrap(
    R("#fff") + R("#d80621", 0, 0, 15) + R("#d80621", 45, 0, 15) +
      `<polygon fill="#d80621" points="30,9 32.5,13.5 35.8,11.8 34.6,16.4 39,17.6 33.5,20.6 35,25 30.8,22.8 30.8,29 29.2,29 29.2,22.8 25,25 26.5,20.6 21,17.6 25.4,16.4 24.2,11.8 27.5,13.5"/>`,
  ),
  mx: wrap(R("#006847") + R("#fff", 20) + R("#ce1126", 40) + `<circle cx="30" cy="19.4" r="2.1" fill="#7c5a36"/><rect x="28.7" y="21.3" width="2.6" height="1.7" fill="#4a7c3f"/>`),
  br: wrap(
    R("#009739") +
      `<polygon points="30,4 55,20 30,36 5,20" fill="#fedd00"/><circle cx="30" cy="20" r="8" fill="#012169"/><rect x="18.5" y="18.7" width="23" height="2.6" fill="#fff"/>`,
  ),
  ae: wrap(R("#00732f") + R("#fff", 0, 13.33, 60, 13.34) + R("#ff0f21", 0, 26.66) + R("#ff0f21", 0, 0, 15)),
  sa: wrap(R("#165d31") + R("#fff", 0, 15, 60, 10) + `<rect x="10" y="17" width="12" height="6" fill="none" stroke="#165d31" stroke-width="1"/>`),
  nl: wrap(R("#ae1c28") + R("#fff", 0, 13.33) + R("#21468b", 0, 26.66)),
};

/** 已解码旗帜的图片缓存（data URI，一次构建全期复用） */
const imgCache = new Map<string, HTMLImageElement>();

/** 取（并按需开始解码）某面旗帜；未知 cc / SSR 返回 null */
export function flagImgFor(cc: string): HTMLImageElement | null {
  if (typeof window === "undefined" || !FLAGS[cc]) return null;
  const hit = imgCache.get(cc);
  if (hit) return hit;
  const img = new Image();
  img.decoding = "async";
  img.src = dataUri(cc) as string;
  imgCache.set(cc, img);
  return img;
}

/** 纯数据 URI（DOM <img> 用，如灯卡/刻度盘读数），未知 cc 返回 null */
export function dataUri(cc: string): string | null {
  const s = FLAGS[cc];
  return s ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}` : null;
}

export { MIC_CC };
