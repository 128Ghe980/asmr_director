"use client";

import {
  CheckCircle2,
  Film,
  Info,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import type {
  ProjectWorkspaceMetadataRow,
  ProjectWorkspaceSummary,
} from "@/lib/asmr/project-summary";

import { getProjectWorkspaceBadgeClassName } from "./project-workspace-badge";

type ProjectDetailsDockProps = {
  collapsed: boolean;
  summary: ProjectWorkspaceSummary;
  onToggle: () => void;
};

function MetadataRows({ rows }: { rows: ProjectWorkspaceMetadataRow[] }) {
  return (
    <dl className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2 last:border-b-0 last:pb-0"
        >
          <dt className="text-xs text-studio-muted">{row.label}</dt>
          <dd className="truncate text-right text-xs font-semibold text-studio-text">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectDetailsDock({
  collapsed,
  summary,
  onToggle,
}: ProjectDetailsDockProps) {
  const toggleLabel = collapsed
    ? "展开项目详情"
    : "收起项目详情";

  return (
    <aside
      aria-label="项目详情"
      className="min-w-0 border-t border-studio-line bg-studio-bg/72 p-3 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between gap-2">
        {collapsed ? null : (
          <h2 className="text-sm font-semibold text-studio-text">
            项目详情
          </h2>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-studio-line bg-white/[0.035] text-studio-muted transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {collapsed ? (
        <div className="mt-4 flex justify-center text-xs font-semibold tracking-normal text-studio-muted [writing-mode:vertical-rl]">
          详情
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <section className="rounded-lg border border-amber-300/18 bg-amber-300/[0.055] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
              <Film className="h-4 w-4" aria-hidden="true" />
              预览层
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.08] bg-black/20">
              <div className="flex h-7 items-center gap-1.5 border-b border-white/[0.08] px-2">
                <span className="h-2 w-2 rounded-full bg-rose-300/65" />
                <span className="h-2 w-2 rounded-full bg-amber-300/65" />
                <span className="h-2 w-2 rounded-full bg-emerald-300/65" />
              </div>
              <div className="flex h-20 items-center justify-center px-3 text-center text-xs text-studio-muted">
                {summary.preview.label}
              </div>
            </div>
            <span
              className={[
                getProjectWorkspaceBadgeClassName(
                  summary.preview.tone,
                  "mt-3",
                ),
              ].join(" ")}
            >
              {summary.preview.label}
            </span>
          </section>

          <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <Info className="h-4 w-4" aria-hidden="true" />
              项目元数据
            </div>
            <MetadataRows rows={summary.metadataRows} />
          </section>

          <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              保存 / 校验
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={[
                  getProjectWorkspaceBadgeClassName(summary.saveState.tone),
                ].join(" ")}
              >
                {summary.saveState.label}
              </span>
              <span
                className={[
                  getProjectWorkspaceBadgeClassName(summary.validation.tone),
                ].join(" ")}
              >
                {summary.validation.label}
              </span>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
