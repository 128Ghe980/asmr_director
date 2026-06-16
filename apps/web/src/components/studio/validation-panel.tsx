"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { ProjectValidationIssue } from "@/lib/asmr/edit-project";

type ValidationPanelProps = {
  issues: ProjectValidationIssue[];
};

export function ValidationPanel({ issues }: ValidationPanelProps) {
  const isValid = issues.length === 0;

  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-studio-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">
            项目校验
          </h2>
          <p className="text-xs text-studio-muted">
            实时检查当前时间线。
          </p>
        </div>
        <div
          className={
            isValid
              ? "inline-flex items-center gap-2 rounded-full border border-emerald-300/35 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100"
              : "inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100"
          }
        >
          {isValid ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          )}
          {isValid ? "校验通过" : `${issues.length} 个问题`}
        </div>
      </div>

      {!isValid ? (
        <div className="max-h-36 overflow-y-auto px-4 py-3">
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li
                key={`${issue.path}-${issue.message}`}
                className="rounded-md border border-amber-300/16 bg-amber-300/[0.055] px-3 py-2"
              >
                <p className="break-words text-xs font-semibold text-amber-100">
                  {issue.path || "项目"}
                </p>
                <p className="mt-1 text-sm text-studio-text">{issue.message}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-studio-muted">
          当前项目 JSON 通过校验。
        </p>
      )}
    </section>
  );
}
