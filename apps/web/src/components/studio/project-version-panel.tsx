"use client";

import { History, RotateCcw, Save } from "lucide-react";

import type { ProjectRevision } from "@/lib/asmr/project-library";

function formatRevisionTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
export function ProjectVersionPanel({
  revisions,
  onCreate,
  onRestore,
}: {
  revisions: ProjectRevision[];
  onCreate: () => void;
  onRestore: (revisionId: string) => void;
}) {
  const recentRevisions = revisions.slice(-5).reverse();

  return (
    <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-studio-muted">
          <History className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h3 className="truncate">版本记录</h3>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-sky-300/22 bg-sky-300/10 px-2.5 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-300/16 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          留版本
        </button>
      </div>

      {recentRevisions.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {recentRevisions.map((revision) => (
            <li
              key={revision.revisionId}
              className="flex items-center gap-2 rounded-md border border-white/[0.055] bg-black/12 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-studio-text">
                  {revision.label}
                </div>
                <div className="mt-0.5 text-[11px] text-studio-muted">
                  {formatRevisionTime(revision.createdAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRestore(revision.revisionId)}
                aria-label={`恢复 ${revision.label}`}
                title="恢复此版本"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.035] text-studio-muted transition-colors hover:border-sky-300/25 hover:bg-sky-300/10 hover:text-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-studio-muted/72">
          还没有恢复点。
        </p>
      )}
    </section>
  );
}
