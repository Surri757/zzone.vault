"use client";

import { useEffect } from "react";
import { House, RefreshCw, TriangleAlert } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-carbon-deep px-5 py-16 text-paper">
      <section className="w-full max-w-xl border-y border-white/15 py-10 text-center">
        <TriangleAlert className="mx-auto h-7 w-7 text-dangerline" aria-hidden="true" />
        <p className="mt-5 font-mono text-xs text-dangerline">WORKSPACE INTERRUPTED</p>
        <h1 className="mt-3 font-serif text-3xl font-semibold text-white">工作区暂时中断</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-white/68">
          当前视图未能完成渲染。行情缓存、持仓研究和模拟指令均未被修改。
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-white/52">REFERENCE {error.digest}</p>
        ) : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-acid/45 bg-acid/10 px-4 py-2 font-mono text-xs text-acid transition hover:bg-acid/15"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            重试当前视图
          </button>
          <button
            type="button"
            onClick={() => window.location.assign("/")}
            className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-white/15 px-4 py-2 font-mono text-xs text-white/72 transition hover:border-white/30 hover:text-white"
          >
            <House className="h-4 w-4" aria-hidden="true" />
            返回总览
          </button>
        </div>
      </section>
    </main>
  );
}
