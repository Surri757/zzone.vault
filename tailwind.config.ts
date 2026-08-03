import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        carbon: "#070906",
        "carbon-deep": "#030403",
        panel: "#0d100c",
        ink: "#e5ddca",
        paper: "#e5ddca",
        acid: "#7fb7a3",
        jade: "#7fb7a3",
        cyanline: "#d8d0bd",
        mist: "#d8d0bd",
        voltage: "#d45a42",
        cinnabar: "#d45a42",
        amberline: "#bc9858",
        gold: "#bc9858",
        dangerline: "#df6b55"
      },
      fontFamily: {
        sans: [
          "var(--font-zz-sans)",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "Noto Sans CJK SC",
          "system-ui",
          "sans-serif"
        ],
        display: ["var(--font-zz-display)", "Noto Serif SC", "Songti SC", "STSong", "serif"],
        serif: ["var(--font-zz-display)", "Noto Serif SC", "Songti SC", "STSong", "serif"],
        mono: [
          "var(--font-zz-mono)",
          "JetBrains Mono",
          "SFMono-Regular",
          "Cascadia Code",
          "Consolas",
          "monospace"
        ]
      },
      letterSpacing: {
        tighter: "0",
        tight: "0",
        normal: "0",
        wide: "0",
        wider: "0",
        widest: "0"
      },
      borderRadius: {
        xl: "8px",
        "2xl": "8px",
        "3xl": "8px"
      },
      boxShadow: {
        "panel-edge":
          "inset 0 1px 0 rgba(229,221,202,0.05), 0 0 0 1px rgba(3,4,3,0.38), 0 24px 70px rgba(0,0,0,0.34)",
        "acid-ring":
          "0 0 0 1px rgba(127,183,163,0.34), 0 12px 30px rgba(0,0,0,0.28)"
      },
      backgroundImage: {
        "signal-grid": "none"
      },
      animation: {
        sweep: "ink-breathe 7s ease-in-out infinite",
        pulsebar: "pulsebar 2.8s ease-in-out infinite",
        "ink-reveal": "ink-reveal 900ms cubic-bezier(0.16, 1, 0.3, 1) both",
        ticker: "vault-ticker 34s linear infinite"
      },
      keyframes: {
        "ink-breathe": {
          "0%, 100%": { opacity: "0.38" },
          "50%": { opacity: "0.72" }
        },
        pulsebar: {
          "0%, 100%": { opacity: "0.5", transform: "scaleY(0.78)" },
          "50%": { opacity: "0.9", transform: "scaleY(1)" }
        },
        "ink-reveal": {
          "0%": { clipPath: "inset(8% 0 12% 0)", filter: "blur(9px) saturate(0.55)" },
          "100%": { clipPath: "inset(0 0 0 0)", filter: "none" }
        },
        "vault-ticker": {
          to: { transform: "translate3d(-50%, 0, 0)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
