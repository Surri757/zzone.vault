"use client";

import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Wind
} from "lucide-react";
import type { Asset } from "@/lib/types";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2
});

const coreStatus = [
  ["画布", "LOCAL SNAPSHOT"],
  ["数据", "PUBLIC DATA HUB"],
  ["指令", "LOCAL SIMULATION"],
] as const;

export function WelcomeGate({
  markets,
  onEnter
}: {
  markets: Asset[];
  onEnter: () => void;
}) {
  return (
    <div className="relative z-10 isolate min-h-[100svh] overflow-hidden">
      <section className="relative mx-auto flex min-h-[100svh] w-full max-w-[1600px] flex-col px-4 pb-20 pt-5 sm:px-6 sm:pb-24 sm:pt-7 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="ink-status-rail flex items-center justify-between border-b border-white/12 pb-4"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="ink-brand-mark grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-acid/45 text-acid">
              <Radar className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="ink-display block truncate text-sm text-ink">Zz.one Vault</span>
              <span className="hidden font-mono text-[8px] tracking-normal text-white/30 sm:block">
                PRIVATE QUANT SYSTEM
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-normal text-acid sm:text-[10px]">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            CORE ONLINE
          </div>
        </motion.div>

        <div
          aria-hidden="true"
          className="ink-display pointer-events-none absolute right-2 top-20 select-none text-[7rem] leading-none text-white/[0.045] [writing-mode:vertical-rl] sm:right-8 sm:text-[10rem] lg:right-14 lg:top-24 lg:text-[14rem]"
        >
          观势
        </div>
        <div
          aria-hidden="true"
          className="ink-seal pointer-events-none absolute right-5 top-[19rem] grid h-12 w-12 place-items-center border border-dangerline/55 text-sm text-dangerline sm:right-12 sm:top-[27rem] lg:right-24 lg:top-[36rem]"
        >
          私仓
        </div>

        <div className="grid flex-1 grid-cols-12 content-center gap-x-4 gap-y-8 py-8 sm:gap-x-6 sm:py-10 lg:gap-x-8 lg:py-12">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08, duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
            className="ink-kicker col-span-10 flex items-center gap-3 font-mono text-[9px] tracking-normal text-amberline sm:text-[10px] lg:col-span-8"
          >
            <Wind className="h-4 w-4" aria-hidden="true" />
            OBSIDIAN QUANT / ACCESS 001
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.86, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-11 lg:col-span-8"
          >
            <h1
              aria-label="Zz.one Vault"
              className="ink-display text-[3.5rem] font-semibold leading-[0.78] text-ink sm:text-[6.5rem] lg:text-[9rem] xl:text-[10rem]"
            >
              <span className="block">Zz.one</span>
              <span className="ink-outline block">Vault</span>
            </h1>
          </motion.div>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28, duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            className="ink-panel col-span-12 border-l border-dangerline/55 px-4 py-1 sm:px-6 lg:col-span-4 lg:row-span-2 lg:self-end"
            aria-label="核心状态"
          >
            <div className="flex items-start justify-between gap-4 pb-5">
              <div>
                <p className="font-mono text-[9px] tracking-normal text-white/36">
                  OBSIDIAN CORE
                </p>
                <p className="ink-display mt-2 text-2xl text-ink sm:text-3xl">封存 / 就绪</p>
              </div>
              <ShieldCheck className="h-6 w-6 text-acid" aria-hidden="true" />
            </div>
            <div className="ink-status-rail border-t border-white/12">
              {coreStatus.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-white/10 py-3 font-mono text-[9px] sm:text-[10px]"
                >
                  <span className="text-white/38">{label}</span>
                  <span className="text-acid">{value}</span>
                </div>
              ))}
            </div>
          </motion.aside>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34, duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            className="col-span-12 grid gap-7 sm:grid-cols-[1fr_auto] sm:items-end lg:col-span-8"
          >
            <div className="max-w-2xl border-t border-white/12 pt-5">
              <p className="ink-display text-2xl text-acid sm:text-3xl">以静观势，驭数入墨</p>
              <p className="mt-3 max-w-xl text-sm leading-7 text-white/58">
                资产画布使用本地快照，公开行情由数据中枢独立接入；组合、策略与指令皆封存于本机，不连接真实券商。
              </p>
            </div>
            <motion.button
              type="button"
              onClick={onEnter}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
              className="group inline-flex min-h-14 w-full items-center justify-between gap-6 rounded-[3px] border border-dangerline/65 bg-dangerline px-5 font-mono text-xs font-semibold tracking-normal text-white shadow-acid-ring transition-colors hover:border-ink hover:bg-ink hover:text-carbon sm:w-auto"
              aria-label="进入 Zz.one Vault 本地模拟仪表盘"
            >
              <span className="flex items-center gap-3">
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                入仓观市
              </span>
              <ArrowRight
                className="h-5 w-5 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </motion.button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.58, duration: 0.75 }}
          className="ink-ticker absolute inset-x-0 bottom-0 overflow-hidden border-y border-white/10 py-3 backdrop-blur-sm"
          aria-label="资产行情摘要"
        >
          <div className="vault-ticker-track flex w-max items-center">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="flex shrink-0 items-center"
                aria-hidden={copy === 1 ? "true" : undefined}
              >
                {markets.map((asset) => (
                  <div
                    key={`${copy}-${asset.id}`}
                    className="flex min-w-44 items-center justify-between gap-5 border-r border-white/10 px-5 font-mono text-[9px] tracking-normal sm:min-w-52 sm:px-7"
                  >
                    <span className="text-white/72">{asset.symbol}</span>
                    <span className="text-white/34">{compactNumber.format(asset.price)}</span>
                    <span className={asset.change24h >= 0 ? "text-acid" : "text-dangerline"}>
                      {asset.change24h >= 0 ? "+" : ""}
                      {asset.change24h.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
