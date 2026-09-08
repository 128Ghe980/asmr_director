"use client";

import {
  Download,
  FileJson,
  Focus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useState } from "react";

import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

import { WorkspaceBadge } from "./project-workspace-badge";

type ProjectWorkspaceHeaderProps = {
  planning?: boolean;
  importError: string | undefined;
  importPanelId: string;
  leftCollapsed: boolean;
  leftPanelId: string;
  rightCollapsed: boolean;
  rightPanelId: string;
  summary: ProjectWorkspaceSummary;
  onExportJson: () => void;
  onImportJson: (text: string) => void;
  onResetDemo: () => void;
  onToggleFocus: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export function ProjectWorkspaceHeader({
  planning = false,
  importError,
  importPanelId,
  leftCollapsed,
  leftPanelId,
  rightCollapsed,
  rightPanelId,
  summary,
  onExportJson,
  onImportJson,
  onResetDemo,
  onToggleFocus,
  onToggleLeft,
  onToggleRight,
}: ProjectWorkspaceHeaderProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const isFocusActive = leftCollapsed && rightCollapsed;
  const focusLabel = isFocusActive
    ? "两侧已收起，退出专注编辑"
    : "进入专注编辑";
  const importToggleLabel = isImportOpen ? "收起导入 JSON" : "展开导入 JSON";
  const leftToggleLabel = leftCollapsed ? "展开项目栏" : "收起项目栏";
  const rightToggleLabel = rightCollapsed ? "展开项目详情" : "收起项目详情";

  return (
    <header className="min-w-0 border-b border-studio-line bg-studio-panel/92 px-4 py-4 md:px-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-normal text-studio-text">
            {planning ? "创作工作台" : summary.identity.title}
          </h1>
          {!planning && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-studio-muted">
              <span>{summary.identity.duration}</span>
              <WorkspaceBadge badge={summary.saveState} />
              {summary.validation.issueCount > 0 && (
                <WorkspaceBadge badge={summary.validation} />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={onToggleLeft}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={leftPanelId}
            aria-expanded={!leftCollapsed}
            aria-label={leftToggleLabel}
            title={leftToggleLabel}
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
            项目
          </button>
          {!planning && <>
          <button
            type="button"
            onClick={onToggleRight}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={rightPanelId}
            aria-expanded={!rightCollapsed}
            aria-label={rightToggleLabel}
            title={rightToggleLabel}
          >
            {rightCollapsed ? (
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            )}
            详情
          </button>
          <button
            type="button"
            onClick={onToggleFocus}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-label={focusLabel}
            aria-pressed={isFocusActive}
            title={focusLabel}
          >
            <Focus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">专注编辑</span>
          </button>
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-3 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            导出
          </button>
          <button
            type="button"
            onClick={() => setIsImportOpen((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-3 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={importPanelId}
            aria-expanded={isImportOpen}
            aria-label={importToggleLabel}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            载入
          </button>
          <button
            type="button"
            onClick={() => {
              setImportText("");
              onResetDemo();
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            重置
          </button>
          </>}
        </div>
      </div>

      <div
        id={importPanelId}
        hidden={planning || !isImportOpen}
        className="mt-4 rounded-lg border border-studio-line bg-black/16 p-3"
      >
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-studio-muted">
            <FileJson className="h-4 w-4" aria-hidden="true" />
            导入 JSON
          </span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="粘贴 ASMR Project JSON"
            className="min-h-28 w-full resize-y rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm leading-6 text-studio-text outline-none transition-colors placeholder:text-studio-muted/60 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onImportJson(importText)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-sky-300/25 bg-sky-300/12 px-4 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            确认载入
          </button>
        </div>
        {!planning && isImportOpen && importError ? (
          <div
            role="alert"
            className="mt-3 whitespace-pre-wrap rounded-md border border-amber-300/16 bg-amber-300/[0.055] px-3 py-2 text-sm leading-6 text-amber-100"
          >
            {importError}
          </div>
        ) : null}
      </div>
    </header>
  );
}
