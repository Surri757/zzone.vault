"use client";

// ---------------------------------------------------------------------------
// Skeleton components for loading states
// ---------------------------------------------------------------------------

export function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-[8px] border border-white/10 bg-[#070807]/8 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-white/[0.08]" />
            <div className="h-5 w-20 rounded bg-white/[0.08]" />
          </div>
          <div className="mt-1 h-3 w-28 rounded bg-white/[0.05]" />
        </div>
        <div className="h-4 w-16 rounded bg-white/[0.06]" />
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <div className="h-3 w-10 rounded bg-white/[0.05]" />
          <div className="mt-1 h-6 w-24 rounded bg-white/[0.08]" />
        </div>
        <div className="h-14 w-32 rounded bg-white/[0.05]" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border-t border-white/10 pt-2">
            <div className="h-3 w-8 rounded bg-white/[0.05]" />
            <div className="mt-1 h-4 w-12 rounded bg-white/[0.07]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonListItem() {
  return (
    <div className="animate-pulse rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-20 rounded bg-white/[0.08]" />
          <div className="mt-1 h-3 w-32 rounded bg-white/[0.05]" />
        </div>
        <div className="h-4 w-14 rounded bg-white/[0.06]" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="h-5 w-18 rounded bg-white/[0.08]" />
        <div className="h-3 w-20 rounded bg-white/[0.05]" />
      </div>
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="animate-pulse rounded-[8px] border border-white/10 bg-black/10 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-white/[0.08]" />
        <div className="h-4 w-16 rounded bg-white/[0.08]" />
      </div>
      <div className="h-32 w-full rounded-[4px] bg-white/[0.04]" />
    </div>
  );
}

export function SkeletonPanel() {
  return (
    <div className="animate-pulse rounded-[8px] border border-white/10 bg-[#070807]/8 p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-white/[0.08]" />
        <div className="h-4 w-24 rounded bg-white/[0.08]" />
      </div>
      <div className="grid gap-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 rounded-[6px] bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
