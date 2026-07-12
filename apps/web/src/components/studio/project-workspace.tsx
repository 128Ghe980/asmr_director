"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
import type { AudioAnalysis } from "@/lib/asmr/audio-analysis";
import type {
  ProjectMixControl,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";
import type {
  ProjectLibrarySummary,
  ProjectRevision,
} from "@/lib/asmr/project-library";
import type { AudioAnalysisStatus, ProductQualityReport } from "@/lib/asmr/product-quality";

import { ProjectDetailsDock } from "./project-details-dock";
import { ProjectRail } from "./project-rail";
import { ProjectWorkspaceHeader } from "./project-workspace-header";

const PROJECT_WORKSPACE_RAIL_ID = "project-workspace-rail";
const PROJECT_WORKSPACE_DETAILS_ID = "project-workspace-details";
const PROJECT_WORKSPACE_IMPORT_ID = "project-workspace-import";

type ProjectWorkspaceProps = {
  children: ReactNode;
  importError: string | undefined;
  currentProjectId: string;
  projects: ProjectLibrarySummary[];
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  audioAnalysis: AudioAnalysis | undefined;
  audioAnalysisStatus: AudioAnalysisStatus;
  audioAnalysisSourceLabel: string;
  projectMixControl: ProjectMixControl;
  qualityReport: ProductQualityReport;
  revisions: ProjectRevision[];
  selectedClipPreview: SelectedClipPreview;
  onCancelProjectMix: () => void;
  onCreateProject: () => void;
  onCreateRevision: () => void;
  onDeleteProject: (projectId: string) => void;
  onDownloadProjectMix: () => void;
  onExportJson: () => void;
  onGenerateProjectMix: () => void;
  onImportJson: (text: string) => void;
  onPlayProjectMix: () => void;
  onPlaySelectedClip: () => void;
  onDuplicateProject: () => void;
  onRestoreRevision: (revisionId: string) => void;
  onResetDemo: () => void;
  onSelectProject: (projectId: string) => void;
};

export function ProjectWorkspace({
  children,
  importError,
  currentProjectId,
  projects,
  summary,
  preview,
  audioAnalysis,
  audioAnalysisStatus,
  audioAnalysisSourceLabel,
  projectMixControl,
  qualityReport,
  revisions,
  selectedClipPreview,
  onCancelProjectMix,
  onCreateProject,
  onCreateRevision,
  onDeleteProject,
  onDownloadProjectMix,
  onExportJson,
  onGenerateProjectMix,
  onImportJson,
  onPlayProjectMix,
  onPlaySelectedClip,
  onDuplicateProject,
  onRestoreRevision,
  onResetDemo,
  onSelectProject,
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
        currentProjectId={currentProjectId}
        panelId={PROJECT_WORKSPACE_RAIL_ID}
        projects={projects}
        summary={summary}
        onCreate={onCreateProject}
        onDelete={onDeleteProject}
        onDuplicate={onDuplicateProject}
        onSelect={onSelectProject}
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
        audioAnalysis={audioAnalysis}
        audioAnalysisStatus={audioAnalysisStatus}
        audioAnalysisSourceLabel={audioAnalysisSourceLabel}
        projectMixControl={projectMixControl}
        qualityReport={qualityReport}
        revisions={revisions}
        selectedClipPreview={selectedClipPreview}
        onCancelProjectMix={onCancelProjectMix}
        onDownloadProjectMix={onDownloadProjectMix}
        onGenerateProjectMix={onGenerateProjectMix}
        onPlayProjectMix={onPlayProjectMix}
        onPlaySelectedClip={onPlaySelectedClip}
        onCreateRevision={onCreateRevision}
        onRestoreRevision={onRestoreRevision}
        onToggle={() => setRightCollapsed((current) => !current)}
      />
    </div>
  );
}
