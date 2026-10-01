"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

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
  binaural?: boolean;
  onBinauralChange?: (enabled: boolean) => void;
  children: ReactNode;
  planning?: boolean;
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
  binaural, onBinauralChange,
  children,
  planning = false,
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
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const workspaceColumns = useMemo(
    () =>
      `${leftCollapsed ? "3.5rem" : "13rem"} minmax(0, 1fr)${
        planning ? "" : ` ${rightCollapsed ? "3.5rem" : "18rem"}`
      }`,
    [leftCollapsed, rightCollapsed, planning],
  );
  const style = {
    "--workspace-columns": workspaceColumns,
  } as CSSProperties;

  function togglePanel(side: "left" | "right") {
    const collapsed = side === "left" ? leftCollapsed : rightCollapsed;
    const panelId = side === "left" ? PROJECT_WORKSPACE_RAIL_ID : PROJECT_WORKSPACE_DETAILS_ID;
    if (!collapsed) document.querySelector<HTMLButtonElement>(`header button[aria-controls="${panelId}"]`)?.focus();
    if (side === "left") setLeftCollapsed(!collapsed);
    else setRightCollapsed(!collapsed);
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      if (side === "left") setRightCollapsed(true);
      else setLeftCollapsed(true);
    }
  }

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 1023px)");
    if (!media) return;
    const handleResize = () => { if (media.matches) setRightCollapsed(true); };
    media.addEventListener("change", handleResize);
    return () => media.removeEventListener("change", handleResize);
  }, []);

  useEffect(() => {
    if (!window.matchMedia?.("(max-width: 1023px)").matches) return;
    const panelId = !leftCollapsed ? PROJECT_WORKSPACE_RAIL_ID
      : !rightCollapsed && !planning ? PROJECT_WORKSPACE_DETAILS_ID : null;
    if (!panelId) return;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(`header button[aria-controls="${panelId}"]`)?.focus();
        if (panelId === PROJECT_WORKSPACE_RAIL_ID) setLeftCollapsed(true);
        else setRightCollapsed(true);
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex='0']"))
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [leftCollapsed, rightCollapsed, planning]);

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
      className="grid h-dvh max-h-dvh w-full min-h-0 min-w-0 overflow-hidden bg-studio-bg text-studio-text lg:grid-cols-[var(--workspace-columns)]"
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
        onToggle={() => togglePanel("left")}
      />

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <ProjectWorkspaceHeader
          planning={planning}
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
          onToggleLeft={() => togglePanel("left")}
          onToggleRight={() => togglePanel("right")}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 md:px-3">{children}</main>
      </div>

      {!planning && <ProjectDetailsDock
        binaural={binaural} onBinauralChange={onBinauralChange}
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
        onToggle={() => togglePanel("right")}
      />}
    </div>
  );
}
