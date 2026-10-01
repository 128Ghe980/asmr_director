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
import { useEffect, useRef, useState } from "react";

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
  const importToggleRef = useRef<HTMLButtonElement>(null);
  const importPanelRef = useRef<HTMLDivElement>(null);
  const importTextRef = useRef<HTMLTextAreaElement>(null);
  const isFocusActive = leftCollapsed && rightCollapsed;
  const focusLabel = isFocusActive
    ? "两侧已收起，退出专注编辑"
    : "进入专注编辑";
  const importToggleLabel = isImportOpen ? "收起导入 JSON" : "展开导入 JSON";
  const leftToggleLabel = leftCollapsed ? "展开项目栏" : "收起项目栏";
  const rightToggleLabel = rightCollapsed ? "展开项目详情" : "收起项目详情";

  useEffect(() => {
    if (!isImportOpen || planning) return;
    const panel = importPanelRef.current;
    if (!panel) return;
    function fitImportPanel() {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      panel!.style.maxHeight = `${Math.max(0, viewportHeight - panel!.getBoundingClientRect().top - 8)}px`;
    }
    fitImportPanel();
    importTextRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", fitImportPanel);
    window.visualViewport?.addEventListener("resize", fitImportPanel);
    return () => {
      window.removeEventListener("resize", fitImportPanel);
      window.visualViewport?.removeEventListener("resize", fitImportPanel);
    };
  }, [isImportOpen, planning]);

  return (
    <header className="relative z-20 min-w-0 shrink-0 border-b border-studio-line bg-studio-panel/92 px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-normal text-studio-text md:text-base">
            {planning ? "创作工作台" : summary.identity.title}
          </h1>
          {!planning && (
            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-studio-muted">
              <span>{summary.identity.duration}</span>
              <WorkspaceBadge badge={summary.saveState} />
              {summary.validation.issueCount > 0 && (
                <WorkspaceBadge badge={summary.validation} />
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleLeft}
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
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
            <span className="sr-only lg:not-sr-only">项目</span>
          </button>
          {!planning && <>
          <button
            type="button"
            onClick={onToggleRight}
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
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
            <span className="sr-only lg:not-sr-only">详情</span>
          </button>
          <button
            type="button"
            onClick={onToggleFocus}
            className="hidden h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45 lg:inline-flex"
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
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-sky-300/25 bg-sky-300/12 px-2 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">导出</span>
          </button>
          <button
            type="button"
            ref={importToggleRef}
            onClick={() => setIsImportOpen((current) => !current)}
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-sky-300/25 bg-sky-300/12 px-2 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            aria-controls={importPanelId}
            aria-expanded={isImportOpen}
            aria-label={importToggleLabel}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">载入</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setImportText("");
              onResetDemo();
            }}
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">重置</span>
          </button>
          </>}
        </div>
      </div>

      <div
        id={importPanelId}
        ref={importPanelRef}
        hidden={planning || !isImportOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setIsImportOpen(false); importToggleRef.current?.focus(); }
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== importToggleRef.current) setIsImportOpen(false);
        }}
        className="absolute left-2 right-2 top-full mt-1 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-lg border border-studio-line bg-studio-panel p-3 shadow-2xl"
      >
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-studio-muted">
            <FileJson className="h-4 w-4" aria-hidden="true" />
            导入 JSON
          </span>
          <textarea
            ref={importTextRef}
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
