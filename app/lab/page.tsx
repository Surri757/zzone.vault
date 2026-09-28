import type { Metadata } from "next";
import Link from "next/link";
import GoldCursor from "@/components/GoldCursor";

export const metadata: Metadata = {
  title: "炼墨 · INVESTIGATION LAB — Zz.one Vault",
  description:
    "以真题炼墨：28 天，每天两道大厂真题（基座模型 × AI Agent），从零磨出大模型与 Agent 的直觉。图文并茂、可交互、深夜与移动端自适应。"
};

const entries = [
  {
    no: "Q1",
    tag: "基座模型 · DAY 02",
    title: "上下文窗口：128k 到底能装几本书？",
    desc: "窗口 vs 参数量 · Lost in the Middle · 超窗三策略。内含装书计算器。",
    href: "/lianmo/lessons/0003-context-window.html"
  },
  {
    no: "Q2",
    tag: "AGENT · DAY 02",
    title: "Function Calling：模型怎么「伸手」拿工具？",
    desc: "五步闭环 · 意图与执行分离 · 错误回喂自纠。真实 JSON 步进器。",
    href: "/lianmo/lessons/0004-function-calling.html"
  },
  {
    no: "MAP",
    tag: "计划",
    title: "28 天路线图",
    desc: "每天两题的排期与 90 分钟节奏，周末复盘不刷题。",
    href: "/lianmo/reference/0001-28day-roadmap.html"
  },
  {
    no: "CARD",
    tag: "沉淀",
    title: "知识卡册",
    desc: "一题一卡，集卡进度 4 / 50。复盘日翻卡自测。",
    href: "/lianmo/reference/0002-knowledge-cards.html"
  },
  {
    no: "ALL",
    tag: "总站",
    title: "炼墨学习主页",
    desc: "完整入口：全部课程、路线图、卡册与学习方法。",
    href: "/lianmo/"
  },
  {
    no: "ARCHIVE",
    tag: "归档",
    title: "课程归档",
    desc: "全部已开课程永久可翻，只增不删；含追问补课笔记。",
    href: "/lianmo/reference/0003-course-archive.html"
  }
];

export default function LabPage() {
  return (
    <>
      <GoldCursor />
      <main className="min-h-screen bg-carbon font-sans text-ink antialiased">
        <div className="mx-auto max-w-3xl px-6 pb-24 pt-16">
          <Link
            href="/modules"
            className="font-mono text-xs text-ink/40 transition-colors hover:text-gold"
          >
            ← 观墨宝阁
          </Link>

          <header className="mt-10 flex items-end gap-5">
            <div className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center">
              {/* 点亮的灯环：由「待点亮」而来 */}
              <span className="absolute inset-0 rounded-full border border-ink/20" />
              <span className="absolute h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_18px_rgba(188,152,88,0.9)]" />
            </div>
            <div>
              <p className="font-mono text-[11px] text-gold/80">
                03 · INVESTIGATION LAB
              </p>
              <h1 className="font-display text-5xl leading-tight">炼墨</h1>
            </div>
          </header>

          <p className="mt-6 max-w-xl text-sm leading-8 text-ink/60">
            以真题炼墨。28 天，每天两道大厂面试笔试真题——一道基座模型、一道
            AI Agent——不为做题而做题：每题带追问链、举一反三与发散思考，
            从零磨出对大模型与 Agent 的直觉。基模是发动机，Agent 是整车。
          </p>

          <nav className="mt-12 grid gap-4 sm:grid-cols-2" aria-label="炼墨入口">
            {entries.map((e) => (
              <a
                key={e.no}
                href={e.href}
                className="group block border border-ink/10 bg-panel/60 p-6 shadow-panel-edge transition-colors hover:border-gold/60"
              >
                <div className="flex items-baseline justify-between font-mono text-[11px] text-ink/40">
                  <span className="text-gold/80">{e.no}</span>
                  <span>{e.tag}</span>
                </div>
                <h2 className="mt-3 font-display text-lg leading-relaxed text-ink transition-colors group-hover:text-gold">
                  {e.title}
                </h2>
                <p className="mt-2 text-[13px] leading-6 text-ink/50">{e.desc}</p>
                <span className="mt-4 inline-block font-mono text-xs text-gold/80">
                  进入 →
                </span>
              </a>
            ))}
          </nav>

          <p className="mt-10 text-center font-mono text-[11px] text-ink/40">
            ✅ 已完成 Day 01 · quiz 4/4 + 4/4 ——{" "}
            <a href="/lianmo/lessons/0001-token-strawberry.html" className="text-gold/80 transition-colors hover:text-gold">
              复习第 1 题
            </a>{" "}
            /{" "}
            <a href="/lianmo/lessons/0002-what-is-agent.html" className="text-gold/80 transition-colors hover:text-gold">
              第 2 题
            </a>
          </p>

          <footer className="mt-14 border-t border-ink/10 pt-6 font-mono text-[11px] leading-6 text-ink/35">
            开炉 2026-09-22 · DAY 02 · 集卡 4 / 50
            <br />
            内容源：本地教学工作区 · npm run sync:lianmo 同步 · 随版本部署
          </footer>
        </div>
      </main>
    </>
  );
}
