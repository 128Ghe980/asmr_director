"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

import { ProjectDetailsDock } from "./project-details-dock";
import { ProjectRail } from "./project-rail";
import { ProjectWorkspaceHeader } from "./project-workspace-header";

type ProjectWorkspaceProps = {
  children: ReactNode;
  importError: string | undefined;
  summary: ProjectWorkspaceSummary;
  onExportJson: () => void;
  onImportJson: (text: string) => void;
  onResetDemo: () => void;
};

export function ProjectWorkspace({
  children,
  importError,
  summary,
  onExportJson,
  onImportJson,
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
        summary={summary}
        onToggle={() => setLeftCollapsed((current) => !current)}
      />

      <div className="min-w-0">
        <ProjectWorkspaceHeader
          importError={importError}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
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
        summary={summary}
        onToggle={() => setRightCollapsed((current) => !current)}
      />
    </div>
  );
}
