import clsx from "clsx";

import type { AssetStatus, ProjectStatus } from "@/lib/asmr/schema";

type StatusBadgeStatus = AssetStatus | ProjectStatus;

const statusTones: Record<StatusBadgeStatus, string> = {
  draft: "border-slate-500/35 bg-slate-500/10 text-slate-200",
  planning_failed: "border-rose-400/35 bg-rose-500/10 text-rose-200",
  timeline_invalid: "border-amber-400/35 bg-amber-500/10 text-amber-100",
  ready_for_preview: "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
  export_failed: "border-rose-400/35 bg-rose-500/10 text-rose-200",
  asset_pending: "border-slate-500/35 bg-slate-500/10 text-slate-200",
  asset_generating: "border-sky-400/35 bg-sky-500/10 text-sky-100",
  asset_generated: "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
  asset_failed: "border-rose-400/35 bg-rose-500/10 text-rose-200",
};

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase leading-none tracking-normal",
        statusTones[status],
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
