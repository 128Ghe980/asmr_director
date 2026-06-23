import clsx from "clsx";

type PreviewWaveformPlaceholderProps = {
  bars: number[];
  tone?: "neutral" | "accent" | "ok" | "warn";
};

const waveformToneClasses = {
  neutral: {
    panel: "border-slate-500/20 bg-slate-950/35",
    bar: "bg-slate-300/55",
  },
  accent: {
    panel: "border-sky-300/25 bg-sky-950/20",
    bar: "bg-sky-300/70",
  },
  ok: {
    panel: "border-emerald-300/25 bg-emerald-950/20",
    bar: "bg-emerald-300/70",
  },
  warn: {
    panel: "border-amber-300/25 bg-amber-950/20",
    bar: "bg-amber-300/70",
  },
} satisfies Record<
  NonNullable<PreviewWaveformPlaceholderProps["tone"]>,
  { panel: string; bar: string }
>;

export function PreviewWaveformPlaceholder({
  bars,
  tone = "neutral",
}: PreviewWaveformPlaceholderProps) {
  const toneClasses = waveformToneClasses[tone];

  return (
    <div
      role="img"
      aria-label="预览波形占位"
      className={clsx(
        "flex h-20 items-center gap-1.5 rounded-lg border px-3 py-2",
        toneClasses.panel,
      )}
    >
      <div
        className="flex h-full w-full items-center justify-between gap-1.5"
        aria-hidden="true"
      >
        {bars.map((bar, index) => (
          <span
            key={`${bar}-${index}`}
            className={clsx(
              "min-h-1 flex-1 rounded-full shadow-[0_0_12px_rgba(255,255,255,0.04)]",
              toneClasses.bar,
            )}
            style={{ height: `${bar}%` }}
          />
        ))}
      </div>
    </div>
  );
}
