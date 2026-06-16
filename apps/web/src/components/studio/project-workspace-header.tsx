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
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-studio-muted">当前项目</p>
            <WorkspaceBadge badge={summary.localState} />
            <WorkspaceBadge badge={summary.validation} />
            <WorkspaceBadge badge={summary.saveState} />
          </div>

          <h1 className="mt-2 truncate text-2xl font-semibold tracking-normal text-studio-text">
            {summary.identity.title}
          </h1>
          <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-studio-muted">
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0">场景</dt>
              <dd className="truncate text-studio-text/88">
                {summary.identity.sceneName}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>时长</dt>
              <dd className="text-studio-text/88">
                {summary.identity.duration}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>语言</dt>
              <dd className="text-studio-text/88">
                {summary.identity.language}
              </dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0">项目 ID</dt>
              <dd className="truncate font-mono text-xs text-studio-text/88">
                {summary.identity.projectId}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={onToggleLeft}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={leftPanelId}
            aria-expanded={!leftCollapsed}
            aria-label={leftToggleLabel}
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
            项目
          </button>
          <button
            type="button"
            onClick={onToggleRight}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={rightPanelId}
            aria-expanded={!rightCollapsed}
            aria-label={rightToggleLabel}
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
          >
            <Focus className="h-4 w-4" aria-hidden="true" />
            专注编辑
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
        </div>
      </div>

      <div
        id={importPanelId}
        hidden={!isImportOpen}
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
        {isImportOpen && importError ? (
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
