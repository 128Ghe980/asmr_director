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
  const visibleIssues = report.checks.filter((check) => {
    if (check.tone === "pass") return false;
    if (check.id === "schema") return true;
    if (check.id === "analysis") return check.detail.includes("无法");
    if (check.id === "mix") return check.detail.includes("需重混");
    if (check.id === "channels" || check.id === "headroom") {
      return !check.detail.startsWith("等待");
    }
    return false;
  });

  return (
    <section aria-label="音频检查" className="space-y-2">
      {visibleIssues.map((check) => (
        <p
          key={check.id}
          role={check.tone === "block" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-xs leading-5 ${toneClasses[check.tone]}`}
        >
          {check.label}：{check.detail}
        </p>
      ))}
      <details className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-studio-muted focus:outline-none focus:ring-2 focus:ring-sky-300/35">
          <ListChecks className="mr-2 inline h-4 w-4" aria-hidden="true" />
          音频检查详情
        </summary>
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
      </details>
    </section>
  );
}
