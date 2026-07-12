"use client";

import {
  Clock3,
  Copy,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-react";

import type { ProjectLibrarySummary } from "@/lib/asmr/project-library";
import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

import { getProjectWorkspaceBadgeClassName } from "./project-workspace-badge";

type ProjectRailProps = {
  collapsed: boolean;
  currentProjectId: string;
  panelId: string;
  projects: ProjectLibrarySummary[];
  summary: ProjectWorkspaceSummary;
  onCreate: () => void;
  onDelete: (projectId: string) => void;
  onDuplicate: () => void;
  onSelect: (projectId: string) => void;
  onToggle: () => void;
};

function formatUpdatedAt(value: string): string {
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
export function ProjectRail({
  collapsed,
  currentProjectId,
  panelId,
  projects,
  summary,
  onCreate,
  onDelete,
  onDuplicate,
  onSelect,
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

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-sky-300/22 bg-sky-300/10 px-2 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-300/16 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              新建
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              复制
            </button>
          </div>

          <section aria-label="本地项目列表">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-studio-muted">
              <span>本地项目</span>
              <span>{projects.length}</span>
            </div>
            <ul className="space-y-1.5">
              {projects.map((entry) => {
                const selected = entry.projectId === currentProjectId;

                return (
                  <li
                    key={entry.projectId}
                    className={[
                      "group flex items-center gap-1 rounded-md border p-1 transition-colors",
                      selected
                        ? "border-sky-300/24 bg-sky-300/[0.085]"
                        : "border-white/[0.06] bg-white/[0.018] hover:bg-white/[0.04]",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(entry.projectId)}
                      className="min-w-0 flex-1 rounded px-2 py-1.5 text-left focus:outline-none focus:ring-2 focus:ring-sky-300/35"
                      aria-current={selected ? "page" : undefined}
                    >
                      <span className="block truncate text-xs font-semibold text-studio-text">
                        {entry.title}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-studio-muted">
                        <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {formatUpdatedAt(entry.updatedAt)}
                        </span>
                        <span className="shrink-0">· {entry.revisionCount} 版</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={projects.length <= 1}
                      onClick={() => onDelete(entry.projectId)}
                      aria-label={`删除 ${entry.title}`}
                      title={projects.length <= 1 ? "至少保留一个项目" : "删除项目"}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-studio-muted opacity-0 transition hover:bg-rose-300/10 hover:text-rose-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-rose-300/30 disabled:cursor-not-allowed disabled:opacity-20 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </aside>
  );
}
