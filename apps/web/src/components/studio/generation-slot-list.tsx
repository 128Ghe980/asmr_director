import clsx from "clsx";

import type {
  GenerationSlot,
  GenerationSlotTone,
} from "@/lib/asmr/generation-summary";

type GenerationSlotListProps = {
  title: string;
  slots: GenerationSlot[];
  compact?: boolean;
};

const slotToneClasses: Record<GenerationSlotTone, string> = {
  neutral: "border-slate-500/35 bg-slate-500/10 text-slate-200",
  accent: "border-sky-400/35 bg-sky-500/10 text-sky-100",
  ok: "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
  warn: "border-amber-400/35 bg-amber-500/10 text-amber-100",
};

const slotBadgeClassName =
  "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold leading-none tracking-normal";

export function getGenerationSlotToneClassName(
  tone: GenerationSlotTone,
  className?: string,
) {
  return clsx(slotBadgeClassName, slotToneClasses[tone], className);
}

export function GenerationSlotList({
  title,
  slots,
  compact = false,
}: GenerationSlotListProps) {
  return (
    <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
      <h3 className="text-xs font-semibold text-studio-muted">{title}</h3>

      <div className={clsx("mt-3 space-y-2", compact && "space-y-1.5")}>
        {slots.map((slot) => (
          <div
            key={slot.id}
            className={clsx(
              "flex min-w-0 items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-black/15",
              compact ? "px-2 py-1.5" : "px-2.5 py-2",
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-studio-text">
                {slot.label}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-studio-muted">
                {slot.detail}
              </div>
            </div>

            <span className={getGenerationSlotToneClassName(slot.tone)}>
              {slot.statusLabel}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
