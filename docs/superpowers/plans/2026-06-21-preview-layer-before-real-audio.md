# Preview Layer Before Real Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved C hybrid lightweight preview layer before real audio: right-dock preview surface, fake waveform, generation slots, selected-clip asset slot, and light Timeline status signals while preserving collapsible left/right workspace panels.

**Architecture:** Keep `StudioApp` as the owner of the editable `AsmrProject`, selected clip, validation, persistence, import, export, and reset. Add a pure `generation-summary` helper that derives preview display data without mutating project data or changing exported JSON, then render that data through focused Studio components inside the existing C+ Project Shell.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest.

---

## File Structure

- Create `apps/web/src/lib/asmr/generation-summary.ts`
  - Pure helper for project preview counts, fake waveform bars, project/track generation slots, selected-clip asset slot, and asset-status display labels.
  - Depends only on `schema`, `ui-copy`, and `view-model`.
  - Never mutates `AsmrProject` and never introduces schema fields.
- Create `apps/web/src/lib/asmr/generation-summary.test.ts`
  - Vitest coverage for pending preview state, track slot counts, generated/failed status derivation, selected-clip slot display, and real audio count remaining `0` for the demo project.
- Create `apps/web/src/components/studio/preview-waveform-placeholder.tsx`
  - Visual-only fake waveform/status strip driven by deterministic bar values.
- Create `apps/web/src/components/studio/generation-slot-list.tsx`
  - Reusable list for project/track slots and selected clip asset slot.
- Create `apps/web/src/components/studio/preview-layer-panel.tsx`
  - Right-dock preview surface with disabled play control, fake waveform, preview counts, and generation slots.
- Modify `apps/web/src/components/studio/project-details-dock.tsx`
  - Replace the old neutral preview card with `PreviewLayerPanel`.
  - Keep the existing right-dock collapse behavior and metadata/save-validation sections.
- Modify `apps/web/src/components/studio/project-workspace.tsx`
  - Accept derived preview summary and pass it into `ProjectDetailsDock`.
  - Keep left/right collapse state unchanged.
- Modify `apps/web/src/components/studio/studio-app.tsx`
  - Derive preview summary from `editableProject` and `selectedClip`.
  - Pass preview data to `ProjectWorkspace` and selected-clip slot data to `ClipInspector`.
- Modify `apps/web/src/components/studio/timeline-panel.tsx`
  - Add compact generation-status signals inside clip blocks without changing Timeline sizing or selection behavior.
- Modify `apps/web/src/components/studio/clip-inspector.tsx`
  - Add a selected-clip asset slot section using derived data.
  - Keep all existing editing controls, validation messages, and director actions unchanged.
- Modify `docs/AI_HANDOFF.md`
  - Record the implemented preview layer and next recommended work.
- Modify `docs/project-archive.md`
  - Add a dated implementation note for the preview layer.

---

### Task 1: Generation Summary Helper

**Files:**
- Create: `apps/web/src/lib/asmr/generation-summary.test.ts`
- Create: `apps/web/src/lib/asmr/generation-summary.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/asmr/generation-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import { getProjectPreviewSummary } from "./generation-summary";
import type { AsmrProject } from "./schema";

function cloneProject(project: AsmrProject): AsmrProject {
  return structuredClone(project);
}

describe("generation summary", () => {
  it("derives a pending project preview summary from the demo project", () => {
    const selectedClip = demoProject.timeline.tracks[0]?.clips[0];

    const summary = getProjectPreviewSummary({
      project: demoProject,
      selectedClip,
    });

    expect(summary.previewTitle).toBe("项目预览");
    expect(summary.statusLabel).toBe("未生成");
    expect(summary.statusTone).toBe("neutral");
    expect(summary.realAudioCount).toBe(0);
    expect(summary.totalClipCount).toBe(9);
    expect(summary.pendingClipCount).toBe(9);
    expect(summary.generatedClipCount).toBe(0);
    expect(summary.generatingClipCount).toBe(0);
    expect(summary.failedClipCount).toBe(0);
    expect(summary.waveformBars).toEqual([28, 44, 36, 62, 48, 76, 42, 58, 34, 66, 46, 30]);
    expect(summary.slots.map((slot) => slot.id)).toEqual([
      "project_mix",
      "voice",
      "breath",
      "sfx",
      "ambience",
    ]);
  });

  it("derives track slot clip counts and labels", () => {
    const summary = getProjectPreviewSummary({
      project: demoProject,
      selectedClip: demoProject.timeline.tracks[0]?.clips[0],
    });

    expect(summary.slots).toEqual([
      {
        id: "project_mix",
        label: "项目混音",
        detail: "9 个片段 · 03:30",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 9,
      },
      {
        id: "voice",
        label: "人声轨",
        detail: "4 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 4,
      },
      {
        id: "breath",
        label: "呼吸轨",
        detail: "2 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 2,
      },
      {
        id: "sfx",
        label: "音效轨",
        detail: "2 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 2,
      },
      {
        id: "ambience",
        label: "环境轨",
        detail: "1 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 1,
      },
    ]);
  });

  it("marks generated, generating, and failed clips in summary counts", () => {
    const project = cloneProject(demoProject);
    const voiceTrack = project.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );
    const breathTrack = project.timeline.tracks.find(
      (track) => track.track_type === "breath",
    );
    const sfxTrack = project.timeline.tracks.find(
      (track) => track.track_type === "sfx",
    );

    if (!voiceTrack || !breathTrack || !sfxTrack) {
      throw new Error("demo project tracks missing");
    }

    voiceTrack.clips[0].generation.status = "asset_generated";
    voiceTrack.clips[0].asset.asset_id = "asset_voice_001";
    voiceTrack.clips[0].asset.uri = "file:///voice_001.wav";
    breathTrack.clips[0].generation.status = "asset_generating";
    sfxTrack.clips[0].generation.status = "asset_failed";

    const summary = getProjectPreviewSummary({
      project,
      selectedClip: voiceTrack.clips[0],
    });

    expect(summary.realAudioCount).toBe(1);
    expect(summary.generatedClipCount).toBe(1);
    expect(summary.generatingClipCount).toBe(1);
    expect(summary.failedClipCount).toBe(1);
    expect(summary.pendingClipCount).toBe(6);
    expect(summary.statusLabel).toBe("等待素材槽完成");
    expect(summary.statusTone).toBe("warn");
    expect(summary.selectedClipSlot).toEqual({
      id: "selected_clip",
      label: "当前片段",
      detail: "人声 · 00:16-00:23",
      statusLabel: "可预览",
      tone: "ok",
      clipCount: 1,
    });
  });

  it("derives selected clip asset slot without mutating the project", () => {
    const project = cloneProject(demoProject);
    const before = JSON.stringify(project);
    const selectedClip = project.timeline.tracks[2]?.clips[0];

    const summary = getProjectPreviewSummary({
      project,
      selectedClip,
    });

    expect(summary.selectedClipSlot).toEqual({
      id: "selected_clip",
      label: "当前片段",
      detail: "音效 · 00:42-00:45",
      statusLabel: "待生成",
      tone: "neutral",
      clipCount: 1,
    });
    expect(JSON.stringify(project)).toBe(before);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-summary
```

Expected: FAIL because `./generation-summary` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/asmr/generation-summary.ts`:

```ts
import type { AssetStatus, AsmrProject, TimelineClip, TrackType } from "./schema";
import { getTrackLabel } from "./ui-copy";
import { flattenClips, formatSeconds, formatTimeRange } from "./view-model";

export type GenerationSlotTone = "neutral" | "accent" | "ok" | "warn";

export type GenerationSlot = {
  id: "project_mix" | "voice" | "breath" | "sfx" | "ambience" | "selected_clip";
  label: string;
  detail: string;
  statusLabel: string;
  tone: GenerationSlotTone;
  clipCount: number;
};

export type ProjectPreviewSummary = {
  previewTitle: string;
  statusLabel: string;
  statusTone: GenerationSlotTone;
  realAudioCount: number;
  totalClipCount: number;
  pendingClipCount: number;
  generatedClipCount: number;
  generatingClipCount: number;
  failedClipCount: number;
  waveformBars: number[];
  slots: GenerationSlot[];
  selectedClipSlot: GenerationSlot | undefined;
};

type ProjectPreviewSummaryInput = {
  project: AsmrProject;
  selectedClip: TimelineClip | undefined;
};

const waveformBars = [28, 44, 36, 62, 48, 76, 42, 58, 34, 66, 46, 30];

const statusDisplay: Record<
  AssetStatus,
  { statusLabel: string; tone: GenerationSlotTone; rank: number }
> = {
  asset_pending: {
    statusLabel: "待生成",
    tone: "neutral",
    rank: 0,
  },
  asset_generating: {
    statusLabel: "队列中",
    tone: "accent",
    rank: 2,
  },
  asset_generated: {
    statusLabel: "可预览",
    tone: "ok",
    rank: 1,
  },
  asset_failed: {
    statusLabel: "失败",
    tone: "warn",
    rank: 3,
  },
};

const slotTrackTypes: Array<Extract<TrackType, "voice" | "breath" | "sfx" | "ambience">> = [
  "voice",
  "breath",
  "sfx",
  "ambience",
];

export function getAssetStatusDisplay(status: AssetStatus): {
  statusLabel: string;
  tone: GenerationSlotTone;
} {
  const { statusLabel, tone } = statusDisplay[status];

  return { statusLabel, tone };
}

function getClipStatusCounts(clips: TimelineClip[]) {
  return clips.reduce(
    (counts, clip) => {
      if (clip.generation.status === "asset_generated") {
        counts.generatedClipCount += 1;
      } else if (clip.generation.status === "asset_generating") {
        counts.generatingClipCount += 1;
      } else if (clip.generation.status === "asset_failed") {
        counts.failedClipCount += 1;
      } else {
        counts.pendingClipCount += 1;
      }

      if (clip.asset.asset_id || clip.asset.uri) {
        counts.realAudioCount += 1;
      }

      return counts;
    },
    {
      pendingClipCount: 0,
      generatedClipCount: 0,
      generatingClipCount: 0,
      failedClipCount: 0,
      realAudioCount: 0,
    },
  );
}

function getAggregateStatus(clips: TimelineClip[]): {
  statusLabel: string;
  tone: GenerationSlotTone;
} {
  if (clips.length === 0) {
    return {
      statusLabel: "无片段",
      tone: "neutral",
    };
  }

  const strongestStatus = clips.reduce<AssetStatus>(
    (currentStatus, clip) =>
      statusDisplay[clip.generation.status].rank > statusDisplay[currentStatus].rank
        ? clip.generation.status
        : currentStatus,
    clips[0].generation.status,
  );

  return getAssetStatusDisplay(strongestStatus);
}

function getTrackClips(
  project: AsmrProject,
  trackType: Extract<TrackType, "voice" | "breath" | "sfx" | "ambience">,
): TimelineClip[] {
  const track = project.timeline.tracks.find(
    (timelineTrack) => timelineTrack.track_type === trackType,
  );

  return track?.clips ?? [];
}

function getTrackSlot(
  project: AsmrProject,
  trackType: Extract<TrackType, "voice" | "breath" | "sfx" | "ambience">,
): GenerationSlot {
  const clips = getTrackClips(project, trackType);

  return {
    id: trackType,
    label: `${getTrackLabel(trackType)}轨`,
    detail: `${clips.length} 个片段`,
    clipCount: clips.length,
    ...getAggregateStatus(clips),
  };
}

function getProjectSlot(project: AsmrProject, clips: TimelineClip[]): GenerationSlot {
  return {
    id: "project_mix",
    label: "项目混音",
    detail: `${clips.length} 个片段 · ${formatSeconds(project.duration)}`,
    clipCount: clips.length,
    ...getAggregateStatus(clips),
  };
}

function getSelectedClipSlot(clip: TimelineClip | undefined): GenerationSlot | undefined {
  if (!clip) {
    return undefined;
  }

  return {
    id: "selected_clip",
    label: "当前片段",
    detail: `${getTrackLabel(clip.track)} · ${formatTimeRange(
      clip.start,
      clip.duration,
    )}`,
    clipCount: 1,
    ...getAssetStatusDisplay(clip.generation.status),
  };
}

function getProjectPreviewStatus({
  totalClipCount,
  generatedClipCount,
  generatingClipCount,
  failedClipCount,
}: Pick<
  ProjectPreviewSummary,
  "totalClipCount" | "generatedClipCount" | "generatingClipCount" | "failedClipCount"
>): {
  statusLabel: string;
  statusTone: GenerationSlotTone;
} {
  if (totalClipCount === 0) {
    return {
      statusLabel: "无片段",
      statusTone: "neutral",
    };
  }

  if (failedClipCount > 0) {
    return {
      statusLabel: "等待素材槽完成",
      statusTone: "warn",
    };
  }

  if (generatedClipCount === totalClipCount) {
    return {
      statusLabel: "可预览",
      statusTone: "ok",
    };
  }

  if (generatingClipCount > 0) {
    return {
      statusLabel: "等待素材槽完成",
      statusTone: "accent",
    };
  }

  if (generatedClipCount > 0) {
    return {
      statusLabel: "等待素材槽完成",
      statusTone: "warn",
    };
  }

  return {
    statusLabel: "未生成",
    statusTone: "neutral",
  };
}

export function getProjectPreviewSummary({
  project,
  selectedClip,
}: ProjectPreviewSummaryInput): ProjectPreviewSummary {
  const clips = flattenClips(project);
  const statusCounts = getClipStatusCounts(clips);
  const previewStatus = getProjectPreviewStatus({
    totalClipCount: clips.length,
    generatedClipCount: statusCounts.generatedClipCount,
    generatingClipCount: statusCounts.generatingClipCount,
    failedClipCount: statusCounts.failedClipCount,
  });

  return {
    previewTitle: "项目预览",
    ...previewStatus,
    ...statusCounts,
    totalClipCount: clips.length,
    waveformBars,
    slots: [
      getProjectSlot(project, clips),
      ...slotTrackTypes.map((trackType) => getTrackSlot(project, trackType)),
    ],
    selectedClipSlot: getSelectedClipSlot(selectedClip),
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-summary
```

Expected: PASS for `generation-summary.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-summary.ts apps/web/src/lib/asmr/generation-summary.test.ts
git commit -m "feat: derive preview generation summary"
```

---

### Task 2: Preview Layer Components

**Files:**
- Create: `apps/web/src/components/studio/preview-waveform-placeholder.tsx`
- Create: `apps/web/src/components/studio/generation-slot-list.tsx`
- Create: `apps/web/src/components/studio/preview-layer-panel.tsx`

- [ ] **Step 1: Create the fake waveform component**

Create `apps/web/src/components/studio/preview-waveform-placeholder.tsx`:

```tsx
import clsx from "clsx";

type PreviewWaveformPlaceholderProps = {
  bars: number[];
  tone?: "neutral" | "accent" | "ok" | "warn";
};

const toneClassNames = {
  neutral: "bg-slate-300/38",
  accent: "bg-sky-300/52",
  ok: "bg-emerald-300/52",
  warn: "bg-amber-300/52",
};

export function PreviewWaveformPlaceholder({
  bars,
  tone = "neutral",
}: PreviewWaveformPlaceholderProps) {
  return (
    <div
      aria-label="预览波形占位"
      className="flex h-20 items-center gap-1 rounded-md border border-white/[0.08] bg-black/22 px-3"
    >
      {bars.map((height, index) => (
        <span
          key={`${height}-${index}`}
          aria-hidden="true"
          className={clsx(
            "min-w-0 flex-1 rounded-full transition-colors",
            toneClassNames[tone],
          )}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the generation slot list**

Create `apps/web/src/components/studio/generation-slot-list.tsx`:

```tsx
import clsx from "clsx";

import type { GenerationSlot, GenerationSlotTone } from "@/lib/asmr/generation-summary";

type GenerationSlotListProps = {
  title: string;
  slots: GenerationSlot[];
  compact?: boolean;
};

const toneClassNames: Record<GenerationSlotTone, string> = {
  neutral: "border-slate-400/20 bg-slate-400/[0.07] text-slate-100",
  accent: "border-sky-300/25 bg-sky-300/[0.10] text-sky-100",
  ok: "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  warn: "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
};

export function GenerationSlotList({
  title,
  slots,
  compact = false,
}: GenerationSlotListProps) {
  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      <h3 className="text-xs font-semibold text-studio-muted">{title}</h3>
      <div className="space-y-2">
        {slots.map((slot) => (
          <div
            key={slot.id}
            className={clsx(
              "rounded-md border border-white/[0.07] bg-white/[0.025]",
              compact ? "px-3 py-2" : "px-3 py-2.5",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-studio-text">
                  {slot.label}
                </p>
                <p className="mt-1 truncate text-[11px] text-studio-muted">
                  {slot.detail}
                </p>
              </div>
              <span
                className={clsx(
                  "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold leading-none",
                  toneClassNames[slot.tone],
                )}
              >
                {slot.statusLabel}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create the preview layer panel**

Create `apps/web/src/components/studio/preview-layer-panel.tsx`:

```tsx
"use client";

import clsx from "clsx";
import { Play, RadioTower } from "lucide-react";

import type { GenerationSlotTone, ProjectPreviewSummary } from "@/lib/asmr/generation-summary";

import { GenerationSlotList } from "./generation-slot-list";
import { PreviewWaveformPlaceholder } from "./preview-waveform-placeholder";

type PreviewLayerPanelProps = {
  preview: ProjectPreviewSummary;
};

const toneClassNames: Record<GenerationSlotTone, string> = {
  neutral: "border-slate-400/22 bg-slate-400/[0.07] text-slate-100",
  accent: "border-sky-300/25 bg-sky-300/[0.10] text-sky-100",
  ok: "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  warn: "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
};

function PreviewStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-white/[0.07] bg-black/14 px-2.5 py-2">
      <dt className="text-[11px] text-studio-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums text-studio-text">
        {value}
      </dd>
    </div>
  );
}

export function PreviewLayerPanel({ preview }: PreviewLayerPanelProps) {
  return (
    <section className="rounded-lg border border-amber-300/18 bg-amber-300/[0.055] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
            <RadioTower className="h-4 w-4" aria-hidden="true" />
            {preview.previewTitle}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-studio-muted">
            真实音频尚未生成
          </p>
        </div>
        <span
          className={clsx(
            "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold leading-none",
            toneClassNames[preview.statusTone],
          )}
        >
          {preview.statusLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
        <button
          type="button"
          disabled
          aria-label="预览播放不可用，真实音频尚未生成"
          title="真实音频尚未生成"
          className="inline-flex h-20 w-10 cursor-not-allowed items-center justify-center rounded-md border border-white/[0.08] bg-black/22 text-studio-muted opacity-80"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
        </button>
        <PreviewWaveformPlaceholder
          bars={preview.waveformBars}
          tone={preview.statusTone}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <PreviewStat label="片段" value={preview.totalClipCount} />
        <PreviewStat label="真实音频" value={preview.realAudioCount} />
        <PreviewStat label="待生成" value={preview.pendingClipCount} />
        <PreviewStat label="可预览" value={preview.generatedClipCount} />
      </dl>

      <div className="mt-4">
        <GenerationSlotList title="生成槽" slots={preview.slots} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run lint to catch component-level type issues**

Run:

```powershell
npm.cmd run lint --prefix apps/web
```

Expected: PASS, or fail only because the new exported components are not wired yet. If unused-file or import-reachability warnings appear, continue to Task 3 and verify again after wiring.

- [ ] **Step 5: Commit if lint passes**

If lint passes:

```powershell
git add apps/web/src/components/studio/preview-waveform-placeholder.tsx apps/web/src/components/studio/generation-slot-list.tsx apps/web/src/components/studio/preview-layer-panel.tsx
git commit -m "feat: add preview layer components"
```

If lint fails only because these components are not used yet, include these files in Task 3's commit instead.

---

### Task 3: Wire Preview Layer Into The Project Shell

**Files:**
- Modify: `apps/web/src/components/studio/project-details-dock.tsx`
- Modify: `apps/web/src/components/studio/project-workspace.tsx`
- Modify: `apps/web/src/components/studio/studio-app.tsx`

- [ ] **Step 1: Update `ProjectDetailsDock` props and imports**

In `apps/web/src/components/studio/project-details-dock.tsx`, remove `Film` from the `lucide-react` import because the preview section will move into `PreviewLayerPanel`.

Add this import:

```ts
import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
import { PreviewLayerPanel } from "./preview-layer-panel";
```

Update the props:

```ts
type ProjectDetailsDockProps = {
  collapsed: boolean;
  panelId: string;
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  onToggle: () => void;
};
```

Update the function signature:

```ts
export function ProjectDetailsDock({
  collapsed,
  panelId,
  summary,
  preview,
  onToggle,
}: ProjectDetailsDockProps) {
```

- [ ] **Step 2: Replace the old right-dock preview section**

In the expanded branch of `ProjectDetailsDock`, replace the entire first `<section>` that currently renders the preview placeholder with:

```tsx
<PreviewLayerPanel preview={preview} />
```

Keep the metadata and save/validation sections immediately after it.

- [ ] **Step 3: Pass preview through `ProjectWorkspace`**

In `apps/web/src/components/studio/project-workspace.tsx`, add:

```ts
import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
```

Update props:

```ts
type ProjectWorkspaceProps = {
  children: ReactNode;
  importError: string | undefined;
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  onExportJson: () => void;
  onImportJson: (text: string) => void;
  onResetDemo: () => void;
};
```

Add `preview` to the destructured props:

```ts
export function ProjectWorkspace({
  children,
  importError,
  summary,
  preview,
  onExportJson,
  onImportJson,
  onResetDemo,
}: ProjectWorkspaceProps) {
```

Pass it to the right dock:

```tsx
<ProjectDetailsDock
  collapsed={rightCollapsed}
  panelId={PROJECT_WORKSPACE_DETAILS_ID}
  summary={summary}
  preview={preview}
  onToggle={() => setRightCollapsed((current) => !current)}
/>
```

- [ ] **Step 4: Derive preview data in `StudioApp`**

In `apps/web/src/components/studio/studio-app.tsx`, add:

```ts
import { getProjectPreviewSummary } from "@/lib/asmr/generation-summary";
```

After `workspaceSummary`, add:

```ts
  const previewSummary = useMemo(
    () =>
      getProjectPreviewSummary({
        project: editableProject,
        selectedClip,
      }),
    [editableProject, selectedClip],
  );
```

Pass it into `ProjectWorkspace`:

```tsx
<ProjectWorkspace
  importError={importError}
  summary={workspaceSummary}
  preview={previewSummary}
  onExportJson={() => exportProjectJson(editableProject)}
  onImportJson={handleImportJson}
  onResetDemo={handleResetDemo}
>
```

- [ ] **Step 5: Run focused tests and lint**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-summary
npm.cmd run lint --prefix apps/web
```

Expected:

- `generation-summary.test.ts` passes.
- Lint passes with no unused imports.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-summary.ts apps/web/src/lib/asmr/generation-summary.test.ts apps/web/src/components/studio/preview-waveform-placeholder.tsx apps/web/src/components/studio/generation-slot-list.tsx apps/web/src/components/studio/preview-layer-panel.tsx apps/web/src/components/studio/project-details-dock.tsx apps/web/src/components/studio/project-workspace.tsx apps/web/src/components/studio/studio-app.tsx
git commit -m "feat: wire preview layer into project shell"
```

If Task 2 already committed the new components, include only files modified in Task 3 plus the helper files if Task 1 is not yet committed.

---

### Task 4: Timeline And Inspector Status Surfaces

**Files:**
- Modify: `apps/web/src/components/studio/timeline-panel.tsx`
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`
- Modify: `apps/web/src/components/studio/studio-app.tsx`

- [ ] **Step 1: Add compact Timeline generation status**

In `apps/web/src/components/studio/timeline-panel.tsx`, add:

```ts
import { getAssetStatusDisplay } from "@/lib/asmr/generation-summary";
```

Add this map near `clipTones`:

```ts
const statusDotTones = {
  neutral: "bg-slate-200/70",
  accent: "bg-sky-200/85",
  ok: "bg-emerald-200/85",
  warn: "bg-amber-200/85",
};
```

Inside the `clips.map` block, after `const timeRange = formatTimeRange(...)`, add:

```ts
const generationStatus = getAssetStatusDisplay(clip.generation.status);
```

Replace the clip button contents:

```tsx
<span className="truncate">{getClipLabel(clip)}</span>
```

with:

```tsx
<span className="min-w-0 flex-1 truncate">{getClipLabel(clip)}</span>
<span
  className={clsx("h-2 w-2 shrink-0 rounded-full", statusDotTones[generationStatus.tone])}
  aria-label={generationStatus.statusLabel}
  title={generationStatus.statusLabel}
/>
```

- [ ] **Step 2: Add selected clip asset slot props to `ClipInspector`**

In `apps/web/src/components/studio/clip-inspector.tsx`, add:

```ts
import type { GenerationSlot } from "@/lib/asmr/generation-summary";
```

Add the reusable list import:

```ts
import { GenerationSlotList } from "./generation-slot-list";
```

Update props:

```ts
type ClipInspectorProps = {
  fieldValidationIssues: ClipFieldValidationIssues;
  selectedClip: TimelineClip | undefined;
  selectedClipSlot: GenerationSlot | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onNudgeClipTiming: (clipId: string, nudge: ClipTimingNudge) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};
```

Add `selectedClipSlot` to the function destructuring:

```ts
export function ClipInspector({
  fieldValidationIssues,
  selectedClip,
  selectedClipSlot,
  onApplyDirectorPreset,
  onNudgeClipTiming,
  onUpdateClip,
}: ClipInspectorProps) {
```

- [ ] **Step 3: Render the selected clip asset slot**

In `ClipInspector`, after `TimingActionStrip` and before the type-specific editor fields, add:

```tsx
{selectedClipSlot ? (
  <div className="border-b border-white/[0.06] py-3">
    <GenerationSlotList title="素材槽" slots={[selectedClipSlot]} compact />
  </div>
) : null}
```

- [ ] **Step 4: Pass the selected clip slot from `StudioApp`**

In `apps/web/src/components/studio/studio-app.tsx`, update the `ClipInspector` usage:

```tsx
<ClipInspector
  fieldValidationIssues={selectedClipValidationIssues}
  selectedClip={selectedClip}
  selectedClipSlot={previewSummary.selectedClipSlot}
  onApplyDirectorPreset={handleApplyDirectorPreset}
  onNudgeClipTiming={handleNudgeClipTiming}
  onUpdateClip={handleUpdateClip}
/>
```

- [ ] **Step 5: Run tests and lint**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-summary
npm.cmd run lint --prefix apps/web
```

Expected:

- Focused tests pass.
- Lint passes.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/studio/timeline-panel.tsx apps/web/src/components/studio/clip-inspector.tsx apps/web/src/components/studio/studio-app.tsx
git commit -m "feat: show lightweight generation status"
```

---

### Task 5: Full Verification And Browser Checks

**Files:**
- Modify only the files from Tasks 1-4 if verification reveals defects.

- [ ] **Step 1: Run full automated checks**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web
```

Expected:

- Vitest passes.
- ESLint passes.
- Next build completes successfully.

- [ ] **Step 2: Start or reuse the local dev server**

If no app server is active, run:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

Expected: app is reachable at:

```text
http://localhost:3000/
```

- [ ] **Step 3: Verify expanded desktop preview layer**

Use the in-app browser at a desktop viewport such as `1440x1000`.

Confirm:

- Right dock shows `项目预览`.
- Disabled play control is visible and disabled.
- Fake waveform/status strip is visible.
- Counts show `片段`, `真实音频`, `待生成`, and `可预览`.
- `真实音频` is `0` for the demo project.
- Generation slots show `项目混音`, `人声轨`, `呼吸轨`, `音效轨`, and `环境轨`.
- Document-level horizontal overflow is `0` or less:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

- [ ] **Step 4: Verify focused editing and independent collapse**

In the browser:

- Click `专注编辑`.
- Confirm the left project rail collapses.
- Confirm the right details dock collapses.
- Confirm the center Timeline becomes visibly wider.
- Confirm Timeline clips still show small generation-status dots.
- Expand only the left project rail and confirm the right dock remains collapsed.
- Expand only the right details dock and confirm the left rail remains in its current state.
- Click `专注编辑` when both side panels are collapsed and confirm both expand.

- [ ] **Step 5: Verify Inspector and existing project operations**

In the browser:

- Select a Timeline or Storyboard clip.
- Confirm Inspector shows a `素材槽` section for the current clip.
- Edit a clip field and confirm existing field-level validation behavior still works.
- Click `载入`, paste invalid JSON:

```json
{"bad": true}
```

- Click the import confirmation button and confirm the existing import/schema error appears.
- Click `重置` and confirm the import error clears.
- Click `导出` and confirm a JSON download is triggered or the browser reports a download event.

- [ ] **Step 6: Verify mobile layout**

Use a mobile viewport such as `390x900`.

Confirm:

- The page stacks instead of forcing a wide canvas.
- The preview layer remains readable.
- Generation slots remain readable.
- Collapse controls remain reachable.
- Document-level horizontal overflow is `0` or less:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

- [ ] **Step 7: Commit verification fixes if needed**

If CSS or interaction fixes were required:

```powershell
git add apps/web/src/lib/asmr/generation-summary.ts apps/web/src/lib/asmr/generation-summary.test.ts apps/web/src/components/studio/preview-waveform-placeholder.tsx apps/web/src/components/studio/generation-slot-list.tsx apps/web/src/components/studio/preview-layer-panel.tsx apps/web/src/components/studio/project-details-dock.tsx apps/web/src/components/studio/project-workspace.tsx apps/web/src/components/studio/studio-app.tsx apps/web/src/components/studio/timeline-panel.tsx apps/web/src/components/studio/clip-inspector.tsx
git commit -m "polish: verify preview layer layout"
```

If no fixes were required, do not create an empty commit.

---

### Task 6: Documentation Update

**Files:**
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Update `docs/AI_HANDOFF.md`**

Under current capabilities, add:

```markdown
- Shows a C hybrid lightweight preview layer in the right project dock before real audio generation exists.
- Displays a disabled preview control, fake waveform/status surface, generation slots, and real audio count without changing the exported ASMR Project JSON.
- Keeps the left project rail and right project dock independently collapsible so `专注编辑` still gives the Timeline meaningful space.
- Shows lightweight generation status in Timeline clips and the selected clip Inspector asset slot.
```

Update recommended next work to:

```markdown
Recommended next step: **real generation integration design**.

Why this next: the UI now has stable preview and asset-slot surfaces. The next design should decide whether to introduce local-only queued state, a backend job model, or a mock generation bridge before adding real TTS/SFX/ambience services.
```

- [ ] **Step 2: Update `docs/project-archive.md`**

Append:

```markdown
## 2026-06-21 - Preview Layer Before Real Audio

- Implemented the approved C hybrid lightweight preview layer from `docs/superpowers/specs/2026-06-21-preview-layer-before-real-audio-design.md` and `.zh.md`.
- Added a right-dock project preview surface with disabled playback, fake waveform/status strip, preview counts, and generation slots.
- Added derived generation-summary data without changing `AsmrProject` schema or exported JSON.
- Added selected-clip asset-slot information in Inspector and compact generation-status signals in Timeline.
- Preserved independent left/right collapse and `专注编辑` so the center Timeline can still receive meaningful width.
- Verified tests, lint, build, desktop layout, focused editing, independent collapse, mobile overflow, import, export, and reset.
```

- [ ] **Step 3: Run final automated verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web
```

Expected:

- Tests pass.
- Lint passes.
- Build passes.

- [ ] **Step 4: Commit docs**

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md
git commit -m "docs: record preview layer implementation"
```

---

## Self-Review Checklist

- Spec coverage:
  - Right-dock preview surface: Tasks 2 and 3.
  - Disabled playback without real audio: Task 2.
  - Fake waveform/status surface: Task 2.
  - Project, track, and selected-clip generation slots: Tasks 1, 2, and 4.
  - Timeline/Storyboard/Inspector lightweight generation status: Task 4, with existing Storyboard `StatusBadge` preserved.
  - Left/right collapse remains independent: Task 3 preserves existing `ProjectWorkspace` state and Task 5 verifies it.
  - `专注编辑` still releases Timeline width: Task 5 verifies it.
  - No schema/export JSON changes: Task 1 helper is derived-only and Task 5 verifies import/export/reset.
  - Concise Chinese UI copy: Tasks 1, 2, and 4.

- Verification coverage:
  - RED/GREEN helper tests in Task 1.
  - Focused helper test and lint after wiring in Tasks 3 and 4.
  - Full test/lint/build in Tasks 5 and 6.
  - Browser verification for desktop, focus mode, independent collapse, Inspector, import/export/reset, and mobile overflow in Task 5.

- Execution style:
  - Use TDD for `generation-summary`.
  - Keep commits task-sized.
  - Keep preview UI display-only in this implementation.
  - Do not add backend state, real audio playback, real generated assets, or queue mutation.
