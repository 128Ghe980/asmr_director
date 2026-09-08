"use client";

import { AlertTriangle } from "lucide-react";

import type { ProjectValidationIssue } from "@/lib/asmr/edit-project";

type ValidationPanelProps = {
  issues: ProjectValidationIssue[];
};

export function ValidationPanel({ issues }: ValidationPanelProps) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex items-center gap-2 border-b border-studio-line px-4 py-3 text-amber-100">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{issues.length} 处需要调整</h2>
      </div>

      <div className="max-h-36 overflow-y-auto px-4 py-3">
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={`${issue.path}-${issue.message}`}
              title={issue.path || "项目"}
              className="rounded-md border border-amber-300/16 bg-amber-300/[0.055] px-3 py-2 text-sm text-studio-text"
            >
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
