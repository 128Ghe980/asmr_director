# Project Structure Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved C+ collapsible project workspace: left project rail, top status/action header, center editor, and right project details dock.

**Architecture:** `StudioApp` remains the single owner of project state, persistence, selection, validation, import, export, and reset. A pure `project-summary` helper derives workspace display data, while new React components handle project shell layout and collapsible side regions without changing the ASMR Project schema or exported JSON.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest.

---

## File Structure

- Create `apps/web/src/lib/asmr/project-summary.ts`
  - Pure helper for project identity, metadata rows, validation summary, local state label, save label, and preview placeholder state.
- Create `apps/web/src/lib/asmr/project-summary.test.ts`
  - Vitest coverage for clean demo, edited state, restored state, validation errors, and preview placeholder data.
- Create `apps/web/src/components/studio/project-rail.tsx`
  - Left project rail and collapsed narrow rail.
- Create `apps/web/src/components/studio/project-details-dock.tsx`
  - Right project details dock with preview, metadata, and save / validation cards.
- Create `apps/web/src/components/studio/project-workspace-header.tsx`
  - Top project status header, project-level actions, import JSON area, and focus/collapse controls.
- Create `apps/web/src/components/studio/project-workspace.tsx`
  - Top-level responsive C+ shell with local collapsed-state UI.
- Modify `apps/web/src/components/studio/studio-app.tsx`
  - Replace `ProjectHeader` and `ProjectControls` usage with `ProjectWorkspace`.
  - Keep all existing domain state and handlers in `StudioApp`.
- Delete `apps/web/src/components/studio/project-header.tsx`
  - Its responsibilities move into `ProjectWorkspaceHeader`.
- Delete `apps/web/src/components/studio/project-controls.tsx`
  - Its responsibilities move into `ProjectWorkspaceHeader`.
- Modify `docs/AI_HANDOFF.md`
  - After implementation, record that the C+ shell is implemented and update next recommended work.
- Modify `docs/project-archive.md`
  - Add a short dated implementation note after verification.

---

### Task 1: Project Workspace Summary Helper

**Files:**
- Create: `apps/web/src/lib/asmr/project-summary.test.ts`
- Create: `apps/web/src/lib/asmr/project-summary.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/asmr/project-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getProjectValidationIssues, updateClipInProject } from "./edit-project";
import { demoProject } from "./mock-project";
import { getProjectWorkspaceSummary } from "./project-summary";

describe("project workspace summary", () => {
  it("summarizes the clean demo project", () => {
    const summary = getProjectWorkspaceSummary({
      project: demoProject,
      isDirty: false,
      restoreState: "demo",
      validationIssueCount: 0,
    });

    expect(summary.identity.title).toBe(demoProject.title);
    expect(summary.identity.sceneName).toBe(demoProject.scene.name);
    expect(summary.identity.projectId).toBe(demoProject.project_id);
    expect(summary.identity.duration).toBe("03:30");
    expect(summary.identity.language).toBe("中文");
    expect(summary.localState.label).toBe("示例");
    expect(summary.saveState.label).toBe("示例项目");
    expect(summary.validation.label).toBe("校验通过");
    expect(summary.validation.issueCount).toBe(0);
    expect(summary.preview.label).toBe("预览未生成");
    expect(summary.metadataRows).toContainEqual({
      label: "场景",
      value: demoProject.scene.name,
    });
  });

  it("marks edited projects as locally saved drafts", () => {
    const summary = getProjectWorkspaceSummary({
      project: demoProject,
      isDirty: true,
      restoreState: "demo",
      validationIssueCount: 0,
    });

    expect(summary.localState).toEqual({
      label: "已编辑",
      tone: "accent",
    });
    expect(summary.saveState).toEqual({
      label: "本地已保存",
      tone: "ok",
    });
  });

  it("marks restored projects when they match the stored project", () => {
    const summary = getProjectWorkspaceSummary({
      project: demoProject,
      isDirty: false,
      restoreState: "restored",
      validationIssueCount: 0,
    });

    expect(summary.localState).toEqual({
      label: "已恢复",
      tone: "neutral",
    });
    expect(summary.saveState.label).toBe("本地已保存");
  });

  it("summarizes validation failures", () => {
    const invalidProject = updateClipInProject(demoProject, "voice_004", {
      start: 208,
      duration: 12,
    });
    const issues = getProjectValidationIssues(invalidProject);

    const summary = getProjectWorkspaceSummary({
      project: invalidProject,
      isDirty: true,
      restoreState: "demo",
      validationIssueCount: issues.length,
    });

    expect(summary.validation).toEqual({
      label: "1 个问题",
      issueCount: 1,
      tone: "warn",
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- project-summary
```

Expected: FAIL because `./project-summary` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/asmr/project-summary.ts`:

```ts
import type { AsmrProject } from "./schema";
import { getLanguageLabel, getStatusLabel } from "./ui-copy";
import { formatSeconds } from "./view-model";

export type ProjectRestoreState = "demo" | "restored";
export type SummaryTone = "neutral" | "accent" | "ok" | "warn";

export type SummaryBadge = {
  label: string;
  tone: SummaryTone;
};

export type ProjectMetadataRow = {
  label: string;
  value: string;
};

export type ProjectWorkspaceSummary = {
  identity: {
    title: string;
    sceneName: string;
    projectId: string;
    duration: string;
    language: string;
    status: string;
  };
  localState: SummaryBadge;
  saveState: SummaryBadge;
  validation: SummaryBadge & {
    issueCount: number;
  };
  preview: SummaryBadge;
  metadataRows: ProjectMetadataRow[];
};

type ProjectWorkspaceSummaryInput = {
  project: AsmrProject;
  isDirty: boolean;
  restoreState: ProjectRestoreState;
  validationIssueCount: number;
};

function getLocalStateBadge({
  isDirty,
  restoreState,
}: Pick<ProjectWorkspaceSummaryInput, "isDirty" | "restoreState">): SummaryBadge {
  if (isDirty) {
    return {
      label: "已编辑",
      tone: "accent",
    };
  }

  if (restoreState === "restored") {
    return {
      label: "已恢复",
      tone: "neutral",
    };
  }

  return {
    label: "示例",
    tone: "neutral",
  };
}

function getSaveStateBadge({
  isDirty,
  restoreState,
}: Pick<ProjectWorkspaceSummaryInput, "isDirty" | "restoreState">): SummaryBadge {
  if (isDirty || restoreState === "restored") {
    return {
      label: "本地已保存",
      tone: "ok",
    };
  }

  return {
    label: "示例项目",
    tone: "neutral",
  };
}

function getValidationBadge(issueCount: number): SummaryBadge & {
  issueCount: number;
} {
  if (issueCount > 0) {
    return {
      label: `${issueCount} 个问题`,
      issueCount,
      tone: "warn",
    };
  }

  return {
    label: "校验通过",
    issueCount: 0,
    tone: "ok",
  };
}

export function getProjectWorkspaceSummary({
  project,
  isDirty,
  restoreState,
  validationIssueCount,
}: ProjectWorkspaceSummaryInput): ProjectWorkspaceSummary {
  const mixing = project.timeline.mixing;

  return {
    identity: {
      title: project.title,
      sceneName: project.scene.name,
      projectId: project.project_id,
      duration: formatSeconds(project.duration),
      language: getLanguageLabel(project.language),
      status: getStatusLabel(project.status),
    },
    localState: getLocalStateBadge({ isDirty, restoreState }),
    saveState: getSaveStateBadge({ isDirty, restoreState }),
    validation: getValidationBadge(validationIssueCount),
    preview: {
      label: "预览未生成",
      tone: "warn",
    },
    metadataRows: [
      { label: "场景", value: project.scene.name },
      { label: "时长", value: formatSeconds(project.duration) },
      { label: "语言", value: getLanguageLabel(project.language) },
      { label: "状态", value: getStatusLabel(project.status) },
      { label: "项目 ID", value: project.project_id },
      { label: "混音", value: `${mixing.target_lufs} LUFS` },
    ],
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
npm.cmd run test --prefix apps/web -- project-summary
```

Expected: PASS for `project-summary.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/asmr/project-summary.ts apps/web/src/lib/asmr/project-summary.test.ts
git commit -m "feat: add project workspace summary"
```

---

### Task 2: Project Rail And Details Dock

**Files:**
- Create: `apps/web/src/components/studio/project-rail.tsx`
- Create: `apps/web/src/components/studio/project-details-dock.tsx`

- [ ] **Step 1: Create the project rail component**

Create `apps/web/src/components/studio/project-rail.tsx`:

```tsx
"use client";

import {
  FolderKanban,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";

import type { ProjectWorkspaceSummary } from "@/lib/asmr/project-summary";

type ProjectRailProps = {
  collapsed: boolean;
  summary: ProjectWorkspaceSummary;
  onToggle: () => void;
};

export function ProjectRail({
  collapsed,
  summary,
  onToggle,
}: ProjectRailProps) {
  return (
    <aside className="min-w-0 border-b border-studio-line bg-studio-bg/72 p-3 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-2">
        {collapsed ? null : (
          <p className="text-xs font-semibold text-studio-muted">项目</p>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-studio-line bg-white/[0.035] text-studio-muted transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          aria-label={collapsed ? "展开项目栏" : "收起项目栏"}
          title={collapsed ? "展开项目栏" : "收起项目栏"}
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
          <div className="rounded-lg border border-sky-300/20 bg-sky-300/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-studio-text">
              <FolderKanban className="h-4 w-4 text-sky-100" aria-hidden="true" />
              <span className="truncate">{summary.identity.title}</span>
            </div>
            <p className="mt-1 truncate text-xs text-studio-muted">
              当前项目 · {summary.localState.label}
            </p>
          </div>

          <div className="rounded-lg border border-studio-line bg-white/[0.025] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <History className="h-4 w-4" aria-hidden="true" />
              最近项目
            </div>
            <p className="mt-2 text-xs leading-5 text-studio-muted/72">
              后续版本会在这里放最近打开的项目。
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-studio-line bg-white/[0.018] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <Plus className="h-4 w-4" aria-hidden="true" />
              项目列表
            </div>
            <p className="mt-2 text-xs leading-5 text-studio-muted/72">
              预留新建、复制、归档和多项目入口。
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Create the project details dock component**

Create `apps/web/src/components/studio/project-details-dock.tsx`:

```tsx
"use client";

import {
  CheckCircle2,
  Film,
  Info,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import type {
  ProjectMetadataRow,
  ProjectWorkspaceSummary,
  SummaryTone,
} from "@/lib/asmr/project-summary";

type ProjectDetailsDockProps = {
  collapsed: boolean;
  summary: ProjectWorkspaceSummary;
  onToggle: () => void;
};

function toneClass(tone: SummaryTone): string {
  if (tone === "ok") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }

  if (tone === "warn") {
    return "border-amber-300/22 bg-amber-300/[0.075] text-amber-100";
  }

  if (tone === "accent") {
    return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  }

  return "border-studio-line bg-white/[0.035] text-studio-muted";
}

function MetadataRows({ rows }: { rows: ProjectMetadataRow[] }) {
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
  summary,
  onToggle,
}: ProjectDetailsDockProps) {
  return (
    <aside className="min-w-0 border-t border-studio-line bg-studio-bg/72 p-3 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-2">
        {collapsed ? null : (
          <p className="text-xs font-semibold text-studio-muted">项目详情</p>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-studio-line bg-white/[0.035] text-studio-muted transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          aria-label={collapsed ? "展开项目详情" : "收起项目详情"}
          title={collapsed ? "展开项目详情" : "收起项目详情"}
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
          <section className="rounded-lg border border-amber-300/18 bg-amber-300/[0.055] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
              <Film className="h-4 w-4" aria-hidden="true" />
              预览层
            </div>
            <div className="mt-3 h-24 rounded-lg border border-white/[0.08] bg-black/20" />
            <span
              className={`mt-3 inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass(
                summary.preview.tone,
              )}`}
            >
              {summary.preview.label}
            </span>
          </section>

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
                className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass(
                  summary.saveState.tone,
                )}`}
              >
                {summary.saveState.label}
              </span>
              <span
                className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass(
                  summary.validation.tone,
                )}`}
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
```

- [ ] **Step 3: Run typecheck through lint**

Run:

```powershell
npm.cmd run lint --prefix apps/web
```

Expected: PASS. These new files may be unused until Task 3; if lint reports unused exports only after imports are added, proceed to Task 3 before committing.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/src/components/studio/project-rail.tsx apps/web/src/components/studio/project-details-dock.tsx
git commit -m "feat: add project workspace side panels"
```

---

### Task 3: Workspace Header And Shell

**Files:**
- Create: `apps/web/src/components/studio/project-workspace-header.tsx`
- Create: `apps/web/src/components/studio/project-workspace.tsx`

- [ ] **Step 1: Create the workspace header**

Create `apps/web/src/components/studio/project-workspace-header.tsx`:

```tsx
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

import type {
  ProjectWorkspaceSummary,
  SummaryTone,
} from "@/lib/asmr/project-summary";

type ProjectWorkspaceHeaderProps = {
  importError: string | undefined;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  summary: ProjectWorkspaceSummary;
  onExportJson: () => void;
  onImportJson: (text: string) => void;
  onResetDemo: () => void;
  onToggleFocus: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

function badgeClass(tone: SummaryTone): string {
  if (tone === "ok") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }

  if (tone === "warn") {
    return "border-amber-300/22 bg-amber-300/[0.075] text-amber-100";
  }

  if (tone === "accent") {
    return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  }

  return "border-studio-line bg-white/[0.035] text-studio-muted";
}

export function ProjectWorkspaceHeader({
  importError,
  leftCollapsed,
  rightCollapsed,
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

  return (
    <header className="border-b border-studio-line bg-studio-panel/92 px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-studio-muted">
              当前项目
            </p>
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(
                summary.localState.tone,
              )}`}
            >
              {summary.localState.label}
            </span>
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(
                summary.validation.tone,
              )}`}
            >
              {summary.validation.label}
            </span>
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(
                summary.saveState.tone,
              )}`}
            >
              {summary.saveState.label}
            </span>
          </div>

          <h1 className="mt-2 truncate text-2xl font-semibold tracking-normal text-studio-text">
            {summary.identity.title}
          </h1>
          <p className="mt-2 text-sm text-studio-muted">
            {summary.identity.sceneName} · {summary.identity.duration} ·{" "}
            {summary.identity.language} · {summary.identity.projectId}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={onToggleLeft}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Focus className="h-4 w-4" aria-hidden="true" />
            专注编辑
          </button>
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            导出
          </button>
          <button
            type="button"
            onClick={() => setIsImportOpen((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-studio-line bg-white/[0.035] px-3 text-sm font-semibold text-studio-text transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            重置
          </button>
        </div>
      </div>

      {isImportOpen ? (
        <div className="mt-4 rounded-lg border border-studio-line bg-black/16 p-3">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-studio-muted">
              <FileJson className="h-4 w-4" aria-hidden="true" />
              导入 JSON
            </span>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="粘贴 ASMR Project JSON"
              className="min-h-28 w-full resize-y rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm leading-6 text-studio-text outline-none transition placeholder:text-studio-muted/60 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onImportJson(importText)}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-sky-300/25 bg-sky-300/12 px-4 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
            >
              确认载入
            </button>
          </div>
          {importError ? (
            <div className="mt-3 whitespace-pre-wrap rounded-md border border-amber-300/16 bg-amber-300/[0.055] px-3 py-2 text-sm leading-6 text-amber-100">
              {importError}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 2: Create the workspace shell**

Create `apps/web/src/components/studio/project-workspace.tsx`:

```tsx
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
      className="grid min-h-screen bg-studio-bg text-studio-text lg:grid-cols-[var(--workspace-columns)]"
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
```

- [ ] **Step 3: Run lint before wiring**

Run:

```powershell
npm.cmd run lint --prefix apps/web
```

Expected: PASS or only unused-file reality from not-yet-imported components. If lint fails because the new components are not imported yet, continue to Task 4 before committing Task 3.

- [ ] **Step 4: Commit**

If lint passes:

```powershell
git add apps/web/src/components/studio/project-workspace-header.tsx apps/web/src/components/studio/project-workspace.tsx
git commit -m "feat: add collapsible project workspace shell"
```

If lint fails only because these components are not imported, skip this commit and include these files in Task 4's commit.

---

### Task 4: Wire The Workspace Into StudioApp

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Delete: `apps/web/src/components/studio/project-header.tsx`
- Delete: `apps/web/src/components/studio/project-controls.tsx`

- [ ] **Step 1: Update imports in `studio-app.tsx`**

Replace the existing project header/control imports:

```ts
import { ProjectControls } from "./project-controls";
import { ProjectHeader } from "./project-header";
```

with:

```ts
import { getProjectWorkspaceSummary } from "@/lib/asmr/project-summary";
import { ProjectWorkspace } from "./project-workspace";
```

- [ ] **Step 2: Add workspace summary memo**

Inside `StudioApp`, after `isDirty`, add:

```ts
  const workspaceSummary = useMemo(
    () =>
      getProjectWorkspaceSummary({
        project: editableProject,
        isDirty,
        restoreState,
        validationIssueCount: validationIssues.length,
      }),
    [editableProject, isDirty, restoreState, validationIssues.length],
  );
```

- [ ] **Step 3: Replace the returned layout**

Replace the current `return` block with:

```tsx
  return (
    <ProjectWorkspace
      importError={importError}
      summary={workspaceSummary}
      onExportJson={() => exportProjectJson(editableProject)}
      onImportJson={handleImportJson}
      onResetDemo={handleResetDemo}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.86fr)_minmax(0,1.26fr)_minmax(220px,0.86fr)]">
        <div className="min-h-[460px] xl:h-[calc(100vh-152px)]">
          <StoryboardPanel
            project={editableProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <TimelinePanel
            project={editableProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
          <EmotionCurve project={editableProject} />
          <ValidationPanel issues={validationIssues} />
        </div>

        <div className="min-w-0">
          <ClipInspector
            fieldValidationIssues={selectedClipValidationIssues}
            selectedClip={selectedClip}
            onApplyDirectorPreset={handleApplyDirectorPreset}
            onNudgeClipTiming={handleNudgeClipTiming}
            onUpdateClip={handleUpdateClip}
          />
        </div>
      </div>
    </ProjectWorkspace>
  );
```

- [ ] **Step 4: Delete old project-level components**

Delete these files after `StudioApp` no longer imports them:

```text
apps/web/src/components/studio/project-header.tsx
apps/web/src/components/studio/project-controls.tsx
```

- [ ] **Step 5: Run tests and lint**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
```

Expected:

- All existing tests pass.
- New `project-summary.test.ts` passes.
- Lint passes with no unused imports.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/studio/studio-app.tsx apps/web/src/components/studio/project-workspace.tsx apps/web/src/components/studio/project-workspace-header.tsx apps/web/src/components/studio/project-rail.tsx apps/web/src/components/studio/project-details-dock.tsx apps/web/src/lib/asmr/project-summary.ts apps/web/src/lib/asmr/project-summary.test.ts
git add -u apps/web/src/components/studio/project-header.tsx apps/web/src/components/studio/project-controls.tsx
git commit -m "feat: wire studio into project workspace"
```

---

### Task 5: Browser Verification And Layout Polish

**Files:**
- Modify only the files from Tasks 2-4 if browser checks show spacing, overflow, or interaction problems.

- [ ] **Step 1: Build the app**

Run:

```powershell
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: PASS. The local SWC Win32 warning may appear, but the build must complete successfully.

- [ ] **Step 2: Start or reuse the dev server**

Run if no dev server is active:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Expected: app is reachable at:

```text
http://localhost:3000/
```

- [ ] **Step 3: Verify desktop layout**

Use browser automation or the in-app browser to verify at a desktop viewport such as `1440x1000`:

- Page shows `项目`, `当前项目`, `项目详情`, `预览层`, `项目元数据`, `保存 / 校验`.
- Buttons `导出`, `载入`, `重置`, `专注编辑` are visible.
- Click `专注编辑`.
- Confirm the left project rail collapses to a narrow `项目` rail.
- Confirm the right details dock collapses to a narrow `详情` rail.
- Confirm the center editor becomes wider.
- Confirm document-level horizontal overflow is `0` or less with:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

- [ ] **Step 4: Verify independent collapse controls**

In the browser:

- Click `项目` collapse/expand control.
- Confirm only the left rail changes.
- Click `详情` collapse/expand control.
- Confirm only the right dock changes.
- Click `专注编辑` when both sides are collapsed.
- Confirm both sides expand again.

- [ ] **Step 5: Verify project operations**

In the browser:

- Click `载入`.
- Paste invalid JSON such as:

```json
{"bad": true}
```

- Click `确认载入`.
- Confirm an import/schema error appears near the import area.
- Click `重置`.
- Confirm the import error clears and the demo project remains visible.
- Click `导出`.
- Confirm a JSON download is triggered or the browser reports a download event.

- [ ] **Step 6: Verify mobile layout**

Use a mobile viewport such as `390x900`:

- Confirm the page stacks instead of forcing a wide canvas.
- Confirm `项目`, `当前项目`, center editor, and `项目详情` remain readable.
- Confirm document-level horizontal overflow is `0` or less with:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

- [ ] **Step 7: Commit polish fixes if needed**

If any CSS/layout fixes were required:

```powershell
git add apps/web/src/components/studio
git commit -m "polish: verify project workspace layout"
```

If no fixes were required, do not create an empty commit.

---

### Task 6: Documentation Update

**Files:**
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Update `docs/AI_HANDOFF.md` current state**

Add these bullets under `Current user-facing capabilities`:

```markdown
- Shows a C+ Project Shell with collapsible left project rail, top workspace status header, center editor, and right project details dock.
- Supports a `专注编辑` layout action that collapses both project side regions without changing project data.
- Keeps project-level operations (`导出`, `载入`, `重置`) in the workspace header instead of the middle editing flow.
```

Update `Recommended Next Work` to:

```markdown
Recommended next step: **preview layer before real audio**.

Why this next: the project workspace structure now reserves a preview layer, but the preview block is still a placeholder. The next product layer should add placeholder playback states, waveform/status surfaces, and generation slots before connecting real TTS/SFX generation.
```

- [ ] **Step 2: Update `docs/project-archive.md`**

Append this entry:

```markdown
## 2026-06-17 - C+ Project Workspace Implementation

- Implemented the approved C+ project shell from `docs/superpowers/specs/2026-06-17-project-structure-upgrade-design.md` and `.zh.md`.
- Added a collapsible left project rail for current project and future project-list affordances.
- Added a top workspace header for current project status, validation summary, local save state, and project actions.
- Added a right project details dock with preview placeholder, project metadata, and save / validation summary.
- Added `专注编辑` to collapse both side regions and release the center editor.
- Preserved the local-first single `AsmrProject` state model and existing editing/import/export/reset behavior.
```

- [ ] **Step 3: Run final verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected:

- Tests pass.
- Lint passes.
- Build passes with only the known optional SWC warning if it appears.

- [ ] **Step 4: Commit docs**

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md
git commit -m "docs: record project workspace implementation"
```

---

## Self-Review Checklist

- Spec coverage:
  - Left project rail: Task 2 and Task 4.
  - Top workspace header: Task 3 and Task 4.
  - Center editor preservation: Task 4 and Task 5.
  - Right project details dock: Task 2 and Task 4.
  - Independent side collapse and focused editing: Task 3 and Task 5.
  - Project actions moved out of the center editing flow: Task 3 and Task 4.
  - Local-first single project model: Task 4 keeps `StudioApp` as state owner.
  - No backend, auth, collaboration, real generation, or full project list: component text uses placeholders only.

- Verification coverage:
  - Pure helper tests in Task 1.
  - Full test/lint/build in Tasks 4 and 6.
  - Browser desktop/mobile and interaction checks in Task 5.

- Execution style:
  - Use TDD for the pure helper.
  - Keep commits frequent and reviewable.
  - Keep UI copy concise Chinese.
