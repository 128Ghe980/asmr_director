"use client";

import {
  FolderKanban,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";

import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

import { getProjectWorkspaceBadgeClassName } from "./project-workspace-badge";

type ProjectRailProps = {
  collapsed: boolean;
  panelId: string;
  summary: ProjectWorkspaceSummary;
  onToggle: () => void;
};

export function ProjectRail({
  collapsed,
  panelId,
  summary,
  onToggle,
}: ProjectRailProps) {
  const toggleLabel = collapsed ? "展开项目栏" : "收起项目栏";

  return (
    <aside
      id={panelId}
      aria-label="项目导航"
      className="min-w-0 border-b border-studio-line bg-studio-bg/72 p-3 lg:border-b-0 lg:border-r"
    >
      <div className="flex items-center justify-between gap-2">
        {collapsed ? null : (
          <h2 className="text-sm font-semibold text-studio-text">项目</h2>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-studio-line bg-white/[0.035] text-studio-muted transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {collapsed ? (
        <div className="mt-4 flex justify-center text-xs font-semibold tracking-normal text-studio-muted [writing-mode:vertical-rl]">
          项目
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <section className="rounded-lg border border-sky-300/20 bg-sky-300/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-studio-text">
              <FolderKanban
                className="h-4 w-4 shrink-0 text-sky-100"
                aria-hidden="true"
              />
              <span className="truncate">{summary.identity.title}</span>
            </div>
            <p className="mt-2 truncate text-xs text-studio-muted">
              {summary.identity.sceneName} · {summary.identity.duration}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={getProjectWorkspaceBadgeClassName(
                  summary.localState.tone,
                )}
              >
                {summary.localState.label}
              </span>
              <span className={getProjectWorkspaceBadgeClassName("neutral")}>
                {summary.identity.status}
              </span>
            </div>
          </section>

          <section className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <History className="h-4 w-4" aria-hidden="true" />
              最近项目
            </div>
            <p className="mt-2 text-xs leading-5 text-studio-muted/72">
              后续版本会在这里显示最近打开的项目。
            </p>
          </section>

          <section className="rounded-lg border border-dashed border-studio-line bg-white/[0.018] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <Plus className="h-4 w-4" aria-hidden="true" />
              项目列表
            </div>
            <p className="mt-2 text-xs leading-5 text-studio-muted/72">
              预留新建、复制、归档和多项目入口。
            </p>
          </section>
        </div>
      )}
    </aside>
  );
}
