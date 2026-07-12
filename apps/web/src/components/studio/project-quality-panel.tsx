"use client";

import { AlertTriangle, Check, CircleX, ListChecks } from "lucide-react";

import type {
  ProductQualityReport,
  ProductQualityTone,
} from "@/lib/asmr/product-quality";

const toneClasses: Record<ProductQualityTone, string> = {
  pass: "border-emerald-300/16 bg-emerald-300/[0.055] text-emerald-100",
  warn: "border-amber-300/16 bg-amber-300/[0.055] text-amber-100",
  block: "border-rose-300/16 bg-rose-300/[0.055] text-rose-100",
};

function ToneIcon({ tone }: { tone: ProductQualityTone }) {
  if (tone === "pass") {
    return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  if (tone === "block") {
    return <CircleX className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function ProjectQualityPanel({
  report,
}: {
  report: ProductQualityReport;
}) {
  const summary =
    report.blockerCount > 0
      ? `${report.blockerCount} 项阻塞`
      : report.warningCount > 0
        ? `${report.warningCount} 项注意`
        : "可以导出";

  return (
    <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-studio-muted">
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h3 className="truncate">质量检查</h3>
        </div>
        <span
          className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${toneClasses[report.overallTone]}`}
        >
          {summary}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {report.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-start gap-2 rounded-md border border-white/[0.055] bg-black/12 px-2.5 py-2"
          >
            <span className={`mt-0.5 ${toneClasses[check.tone].split(" ").at(-1)}`}>
              <ToneIcon tone={check.tone} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-studio-text">
                {check.label}
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-studio-muted">
                {check.detail}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

