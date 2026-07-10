"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
import type {
  ProjectMixControl,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

import { ProjectDetailsDock } from "./project-details-dock";
import { ProjectRail } from "./project-rail";
import { ProjectWorkspaceHeader } from "./project-workspace-header";

const PROJECT_WORKSPACE_RAIL_ID = "project-workspace-rail";
const PROJECT_WORKSPACE_DETAILS_ID = "project-workspace-details";
const PROJECT_WORKSPACE_IMPORT_ID = "project-workspace-import";

type ProjectWorkspaceProps = {
  children: ReactNode;
  importError: string | undefined;
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  projectMixControl: ProjectMixControl;
  selectedClipPreview: SelectedClipPreview;
  onCancelProjectMix: () => void;
  onDownloadProjectMix: () => void;
  onExportJson: () => void;
  onGenerateProjectMix: () => void;
  onImportJson: (text: string) => void;
  onPlayProjectMix: () => void;
  onPlaySelectedClip: () => void;
  onResetDemo: () => void;
};

export function ProjectWorkspace({
  children,
  importError,
  summary,
  preview,
  projectMixControl,
  selectedClipPreview,
  onCancelProjectMix,
  onDownloadProjectMix,
  onExportJson,
  onGenerateProjectMix,
  onImportJson,
  onPlayProjectMix,
  onPlaySelectedClip,
  onResetDemo,
}: ProjectWorkspaceProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const workspaceColumns = useMemo(
    () =>
      `${leftCollapsed ? "3.5rem" : "13rem"} minmax(0, 1fr) ${
        rightCollapsed ? "3.5rem" : "18rem"
      }`,
    [leftCollapsed, rightCollapsed],
  );
  const style = {
    "--workspace-columns": workspaceColumns,
  } as CSSProperties;

  function handleToggleFocus() {
    if (leftCollapsed && rightCollapsed) {
      setLeftCollapsed(false);
      setRightCollapsed(false);
      return;
    }

    setLeftCollapsed(true);
    setRightCollapsed(true);
  }

  return (
    <div
      className="grid min-h-screen w-full min-w-0 overflow-x-hidden bg-studio-bg text-studio-text lg:grid-cols-[var(--workspace-columns)]"
      style={style}
    >
      <ProjectRail
        collapsed={leftCollapsed}
        panelId={PROJECT_WORKSPACE_RAIL_ID}
        summary={summary}
        onToggle={() => setLeftCollapsed((current) => !current)}
      />

      <div className="min-w-0">
        <ProjectWorkspaceHeader
          importError={importError}
          importPanelId={PROJECT_WORKSPACE_IMPORT_ID}
          leftCollapsed={leftCollapsed}
          leftPanelId={PROJECT_WORKSPACE_RAIL_ID}
          rightCollapsed={rightCollapsed}
          rightPanelId={PROJECT_WORKSPACE_DETAILS_ID}
          summary={summary}
          onExportJson={onExportJson}
          onImportJson={onImportJson}
          onResetDemo={onResetDemo}
          onToggleFocus={handleToggleFocus}
          onToggleLeft={() => setLeftCollapsed((current) => !current)}
          onToggleRight={() => setRightCollapsed((current) => !current)}
        />

        <main className="min-w-0 px-4 py-4 md:px-5">{children}</main>
      </div>

      <ProjectDetailsDock
        collapsed={rightCollapsed}
        panelId={PROJECT_WORKSPACE_DETAILS_ID}
        summary={summary}
        preview={preview}
        projectMixControl={projectMixControl}
        selectedClipPreview={selectedClipPreview}
        onCancelProjectMix={onCancelProjectMix}
        onDownloadProjectMix={onDownloadProjectMix}
        onGenerateProjectMix={onGenerateProjectMix}
        onPlayProjectMix={onPlayProjectMix}
        onPlaySelectedClip={onPlaySelectedClip}
        onToggle={() => setRightCollapsed((current) => !current)}
      />
    </div>
  );
}
