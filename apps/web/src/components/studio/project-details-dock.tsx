"use client";

import {
  CheckCircle2,
  Info,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
import type {
  ProjectMixControl,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
import type {
  ProjectWorkspaceMetadataRow,
  ProjectWorkspaceSummary,
} from "@/lib/asmr/project-summary";

import { PreviewLayerPanel } from "./preview-layer-panel";
import { getProjectWorkspaceBadgeClassName } from "./project-workspace-badge";

type ProjectDetailsDockProps = {
  collapsed: boolean;
  panelId: string;
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  projectMixControl: ProjectMixControl;
  selectedClipPreview: SelectedClipPreview;
  onCancelProjectMix: () => void;
  onDownloadProjectMix: () => void;
  onGenerateProjectMix: () => void;
  onPlayProjectMix: () => void;
  onPlaySelectedClip: () => void;
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
  panelId,
  summary,
  preview,
  projectMixControl,
  selectedClipPreview,
  onCancelProjectMix,
  onDownloadProjectMix,
  onGenerateProjectMix,
  onPlayProjectMix,
  onPlaySelectedClip,
  onToggle,
}: ProjectDetailsDockProps) {
  const toggleLabel = collapsed
    ? "展开项目详情"
    : "收起项目详情";

  return (
    <aside
      id={panelId}
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
          <PreviewLayerPanel
            preview={preview}
            projectMixControl={projectMixControl}
            selectedClipPreview={selectedClipPreview}
            onCancelProjectMix={onCancelProjectMix}
            onDownloadProjectMix={onDownloadProjectMix}
            onGenerateProjectMix={onGenerateProjectMix}
            onPlayProjectMix={onPlayProjectMix}
            onPlaySelectedClip={onPlaySelectedClip}
          />

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
                className={getProjectWorkspaceBadgeClassName(
                  summary.saveState.tone,
                )}
              >
                {summary.saveState.label}
              </span>
              <span
                className={getProjectWorkspaceBadgeClassName(
                  summary.validation.tone,
                )}
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
