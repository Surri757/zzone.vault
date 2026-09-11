import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_SC({
  weight: "variable",
  variable: "--font-zz-sans",
  display: "swap",
  preload: false,
  fallback: ["PingFang SC", "Microsoft YaHei", "sans-serif"]
});

const display = Noto_Serif_SC({
  weight: "variable",
  variable: "--font-zz-display",
  display: "swap",
  preload: false,
  fallback: ["Songti SC", "STSong", "serif"]
});

const mono = JetBrains_Mono({
  weight: "variable",
  subsets: ["latin"],
  variable: "--font-zz-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Zz.one | 观墨 · VAULT OF INK",
  description: "以墨观势，驭数入墨。个人数字门户：本地私有量化研究、组合分析与模拟交易工作台。",
  applicationName: "Zz.one",
  category: "finance",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg"
  }
};

export const viewport: Viewport = {
  themeColor: "#070906",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} bg-carbon font-sans text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
