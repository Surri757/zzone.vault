import type { LucideIcon } from "lucide-react";
import { className } from "./util";

export function MetricTile({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="ink-panel rounded-[8px] p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-white/52">{label}</span>
        <Icon className={className("h-4 w-4", tone)} aria-hidden="true" />
      </div>
      <div className="mt-3 font-mono text-xl text-ink">{value}</div>
    </div>
  );
}
