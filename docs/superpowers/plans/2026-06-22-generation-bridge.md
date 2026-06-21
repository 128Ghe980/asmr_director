# Generation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mock-first generation bridge for selected clips, with runtime job state, durable asset commits, mock preview playback, and UI controls that can later be backed by a real API bridge.

**Architecture:** Keep `StudioApp` as the owner of editable `AsmrProject`, runtime generation jobs, and bridge callbacks. Add small pure helpers for bridge contracts, project asset commits, runtime job state, and effective generation display so UI components consume derived state instead of mutating project data directly. The first bridge implementation is mock-only and returns `mock://` asset URIs; no backend or real model service is introduced.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest.

---

## File Structure

- Create `apps/web/src/lib/asmr/generation-bridge.ts`
  - Public bridge types: request, job snapshot, job update, generated asset result, bridge interface.
  - Depends only on `schema`.
- Create `apps/web/src/lib/asmr/mock-generation-bridge.ts`
  - Local mock bridge implementation.
  - Emits queued/generating/succeeded/failed/canceled updates.
  - Returns durable `mock://asset/<clipId>/<jobId>` URIs, not browser `blob:` URLs.
- Create `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`
  - Vitest fake-timer coverage for success, deterministic failure, and canceling.
- Create `apps/web/src/lib/asmr/generation-project-state.ts`
  - Pure helper for committing generation success/failure into `AsmrProject`.
  - Does not manage runtime jobs.
- Create `apps/web/src/lib/asmr/generation-project-state.test.ts`
  - Coverage for success commits, normal failure, regeneration failure preserving old assets, and missing clips.
- Create `apps/web/src/lib/asmr/generation-runtime.ts`
  - Pure runtime job state helpers keyed by `jobId` and `clipId`.
  - Never serializes into project JSON.
- Create `apps/web/src/lib/asmr/generation-runtime.test.ts`
  - Coverage for upsert, clear, clip lookup, and immutability.
- Create `apps/web/src/lib/asmr/generation-view.ts`
  - Pure helper that merges `AsmrProject`, selected clip, runtime jobs, and validation readiness into UI-ready generation state.
  - Uses existing `getProjectPreviewSummary` after applying runtime display overrides to a cloned project.
- Create `apps/web/src/lib/asmr/generation-view.test.ts`
  - Coverage for pending/generating/generated/failed selected clip actions and runtime status overriding durable pending state.
- Create `apps/web/src/lib/asmr/mock-asset-resolver.ts`
  - Resolves `mock://` asset URIs into playable local data URLs at runtime.
  - Does not write data URLs into `AsmrProject`.
- Create `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`
  - Coverage for mock URI detection, deterministic data URL generation, and rejecting non-mock URIs.
- Modify `apps/web/src/components/studio/clip-inspector.tsx`
  - Add selected clip generation action controls: `生成`, `重生成`, `重试`, `取消`.
  - Display progress and short failure text.
- Modify `apps/web/src/components/studio/preview-layer-panel.tsx`
  - Enable selected clip mock preview when a generated mock asset exists.
  - Keep project-mix preview disabled.
- Modify `apps/web/src/components/studio/project-details-dock.tsx`
  - Pass selected clip preview action into `PreviewLayerPanel`.
- Modify `apps/web/src/components/studio/project-workspace.tsx`
  - Pass selected clip preview action through to the right dock.
- Modify `apps/web/src/components/studio/studio-app.tsx`
  - Own runtime generation state and bridge instance.
  - Start/cancel mock jobs.
  - Commit success/failure into `editableProject`.
  - Resolve and play mock assets.
  - Preserve import/export/reset/autosave behavior.
- Modify `docs/AI_HANDOFF.md`
  - Record implemented generation bridge behavior and remaining limitations.
- Modify `docs/project-archive.md`
  - Add dated implementation note for generation bridge.

---

### Task 1: Bridge Contract And Mock Bridge

**Files:**
- Create: `apps/web/src/lib/asmr/generation-bridge.ts`
- Create: `apps/web/src/lib/asmr/mock-generation-bridge.ts`
- Create: `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`

- [ ] **Step 1: Write the failing bridge tests**

Create `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "./mock-project";
import { createMockGenerationBridge } from "./mock-generation-bridge";
import type { GenerationJobUpdate } from "./generation-bridge";

describe("mock generation bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits queued, generating, and succeeded updates with a mock asset URI", async () => {
    const bridge = createMockGenerationBridge({
      jobIdPrefix: "test_job",
      stepMs: 100,
    });
    const updates: GenerationJobUpdate[] = [];

    const started = await bridge.generateClip(
      {
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    expect(started.jobId).toBe("test_job_1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: "snapshot",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "queued",
        progress: 0,
      },
    });

    await vi.advanceTimersByTimeAsync(400);

    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "snapshot",
      "snapshot",
      "snapshot",
      "succeeded",
    ]);
    expect(updates.at(-1)).toEqual({
      type: "succeeded",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "succeeded",
        progress: 100,
        message: "生成完成",
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z",
      },
      asset: {
        assetId: "mock_voice_001_test_job_1",
        uri: "mock://asset/voice_001/test_job_1",
        duration: 7.5,
      },
    });
  });

  it("emits a deterministic failure when requested", async () => {
    const bridge = createMockGenerationBridge({
      failClipIds: new Set(["sfx_blanket_001"]),
      jobIdPrefix: "test_job",
      stepMs: 100,
    });
    const updates: GenerationJobUpdate[] = [];

    await bridge.generateClip(
      {
        project: demoProject,
        clipId: "sfx_blanket_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    await vi.advanceTimersByTimeAsync(400);

    expect(updates.at(-1)).toMatchObject({
      type: "failed",
      error: "Mock generation failed",
      job: {
        jobId: "test_job_1",
        clipId: "sfx_blanket_001",
        status: "failed",
        progress: 100,
      },
    });
  });

  it("can cancel an in-flight job", async () => {
    const bridge = createMockGenerationBridge({
      jobIdPrefix: "test_job",
      stepMs: 100,
    });
    const updates: GenerationJobUpdate[] = [];

    const started = await bridge.generateClip(
      {
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    await vi.advanceTimersByTimeAsync(100);
    await bridge.cancelGeneration(started.jobId);
    await vi.advanceTimersByTimeAsync(400);

    expect(updates.at(-1)).toMatchObject({
      type: "canceled",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "canceled",
      },
    });
    expect(updates.some((update) => update.type === "succeeded")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-generation-bridge
```

Expected: FAIL because `mock-generation-bridge.ts` and `generation-bridge.ts` do not exist.

- [ ] **Step 3: Create the bridge types**

Create `apps/web/src/lib/asmr/generation-bridge.ts`:

```ts
import type { AsmrProject } from "./schema";

export type GenerateClipReason = "generate" | "regenerate" | "retry";

export type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: GenerateClipReason;
};

export type GeneratedAssetResult = {
  assetId: string;
  uri: string;
  duration: number;
};

export type GenerationRuntimeStatus =
  | "queued"
  | "generating"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

export type GenerationJobSnapshot = {
  jobId: string;
  clipId: string;
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type GenerationJobUpdate =
  | { type: "snapshot"; job: GenerationJobSnapshot }
  | {
      type: "succeeded";
      job: GenerationJobSnapshot;
      asset: GeneratedAssetResult;
    }
  | { type: "failed"; job: GenerationJobSnapshot; error: string }
  | { type: "canceled"; job: GenerationJobSnapshot };

export type GenerationBridge = {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;
  cancelGeneration(jobId: string): Promise<void>;
};
```

- [ ] **Step 4: Create the mock bridge implementation**

Create `apps/web/src/lib/asmr/mock-generation-bridge.ts`:

```ts
import type {
  GenerateClipRequest,
  GenerationBridge,
  GenerationJobSnapshot,
  GenerationJobUpdate,
} from "./generation-bridge";
import { flattenClips } from "./view-model";

type MockGenerationBridgeOptions = {
  failClipIds?: ReadonlySet<string>;
  jobIdPrefix?: string;
  stepMs?: number;
};

type InFlightJob = {
  cancelled: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

const defaultProgressSteps = [18, 42, 76, 100];

export function createMockGenerationBridge({
  failClipIds = new Set<string>(),
  jobIdPrefix = "mock_job",
  stepMs = 350,
}: MockGenerationBridgeOptions = {}): GenerationBridge {
  let nextJobNumber = 1;
  const inFlightJobs = new Map<string, InFlightJob>();

  function now() {
    return new Date().toISOString();
  }

  function makeSnapshot(
    request: GenerateClipRequest,
    jobId: string,
    progress: number,
    status: GenerationJobSnapshot["status"],
    message: string,
  ): GenerationJobSnapshot {
    const timestamp = now();

    return {
      jobId,
      clipId: request.clipId,
      status,
      progress,
      message,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function emitCanceled(
    request: GenerateClipRequest,
    jobId: string,
    onUpdate: (update: GenerationJobUpdate) => void,
  ) {
    onUpdate({
      type: "canceled",
      job: makeSnapshot(request, jobId, 0, "canceled", "已取消"),
    });
  }

  return {
    async generateClip(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const inFlightJob: InFlightJob = {
        cancelled: false,
        timers: [],
      };
      const clip = flattenClips(request.project).find(
        (candidate) => candidate.id === request.clipId,
      );

      if (!clip) {
        const failedJob = makeSnapshot(
          request,
          jobId,
          100,
          "failed",
          "片段不存在",
        );
        onUpdate({
          type: "failed",
          job: failedJob,
          error: "Clip not found",
        });
        return { jobId };
      }

      inFlightJobs.set(jobId, inFlightJob);

      onUpdate({
        type: "snapshot",
        job: makeSnapshot(request, jobId, 0, "queued", "等待生成"),
      });

      defaultProgressSteps.forEach((progress, index) => {
        const timer = setTimeout(() => {
          if (inFlightJob.cancelled) {
            if (inFlightJobs.has(jobId)) {
              emitCanceled(request, jobId, onUpdate);
              inFlightJobs.delete(jobId);
            }
            return;
          }

          if (progress < 100) {
            onUpdate({
              type: "snapshot",
              job: makeSnapshot(
                request,
                jobId,
                progress,
                "generating",
                "生成中",
              ),
            });
            return;
          }

          if (failClipIds.has(request.clipId)) {
            onUpdate({
              type: "failed",
              job: makeSnapshot(
                request,
                jobId,
                100,
                "failed",
                "生成失败",
              ),
              error: "Mock generation failed",
            });
            inFlightJobs.delete(jobId);
            return;
          }

          onUpdate({
            type: "succeeded",
            job: makeSnapshot(
              request,
              jobId,
              100,
              "succeeded",
              "生成完成",
            ),
            asset: {
              assetId: `mock_${request.clipId}_${jobId}`,
              uri: `mock://asset/${request.clipId}/${jobId}`,
              duration: clip.duration,
            },
          });
          inFlightJobs.delete(jobId);
        }, stepMs * (index + 1));

        inFlightJob.timers.push(timer);
      });

      return { jobId };
    },

    async cancelGeneration(jobId) {
      const inFlightJob = inFlightJobs.get(jobId);

      if (!inFlightJob) {
        return;
      }

      inFlightJob.cancelled = true;
    },
  };
}
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-generation-bridge
```

Expected: PASS for `mock-generation-bridge.test.ts`.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-bridge.ts apps/web/src/lib/asmr/mock-generation-bridge.ts apps/web/src/lib/asmr/mock-generation-bridge.test.ts
git commit -m "feat: add mock generation bridge"
```

---

### Task 2: Durable Project Generation Commits

**Files:**
- Create: `apps/web/src/lib/asmr/generation-project-state.ts`
- Create: `apps/web/src/lib/asmr/generation-project-state.test.ts`

- [ ] **Step 1: Write the failing project-state tests**

Create `apps/web/src/lib/asmr/generation-project-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { GeneratedAssetResult } from "./generation-bridge";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

const asset: GeneratedAssetResult = {
  assetId: "mock_voice_001_job_1",
  uri: "mock://asset/voice_001/job_1",
  duration: 7.5,
};

describe("generation project state", () => {
  it("commits successful generation asset metadata without mutating the original project", () => {
    const project = cloneProject();
    const updated = commitGenerationSuccess(project, "voice_001", asset);
    const originalClip = findClip(project, "voice_001");
    const updatedClip = findClip(updated, "voice_001");

    expect(updated).not.toBe(project);
    expect(originalClip.generation.status).toBe("asset_pending");
    expect(originalClip.asset.uri).toBeNull();
    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset).toEqual({
      asset_id: asset.assetId,
      uri: asset.uri,
      duration: asset.duration,
    });
  });

  it("commits normal generation failure as a durable failed state", () => {
    const project = cloneProject();
    const updated = commitGenerationFailure(project, "voice_001", {
      reason: "generate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(updated, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_failed");
    expect(updatedClip.generation.error).toBe("Mock generation failed");
    expect(updatedClip.asset).toEqual({
      asset_id: null,
      uri: null,
      duration: null,
    });
  });

  it("preserves a previous generated asset when regeneration fails", () => {
    const generated = commitGenerationSuccess(
      cloneProject(),
      "voice_001",
      asset,
    );
    const failedRegeneration = commitGenerationFailure(generated, "voice_001", {
      reason: "regenerate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(failedRegeneration, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset.uri).toBe(asset.uri);
  });

  it("returns the same project when the clip is missing", () => {
    const project = cloneProject();

    expect(commitGenerationSuccess(project, "missing", asset)).toBe(project);
    expect(
      commitGenerationFailure(project, "missing", {
        reason: "generate",
        error: "Missing",
      }),
    ).toBe(project);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-project-state
```

Expected: FAIL because `generation-project-state.ts` does not exist.

- [ ] **Step 3: Implement the project-state helper**

Create `apps/web/src/lib/asmr/generation-project-state.ts`:

```ts
import type {
  GeneratedAssetResult,
  GenerateClipReason,
} from "./generation-bridge";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";

type GenerationFailureInput = {
  reason: GenerateClipReason;
  error: string;
};

function hasAsset(clip: TimelineClip): boolean {
  return Boolean(clip.asset.asset_id || clip.asset.uri);
}

function updateClipGeneration(
  project: AsmrProject,
  clipId: string,
  update: (clip: TimelineClip) => TimelineClip,
): AsmrProject {
  let didUpdate = false;
  const tracks = project.timeline.tracks.map((track) => {
    const clips = track.clips as TimelineClip[];

    if (!clips.some((clip) => clip.id === clipId)) {
      return track;
    }

    didUpdate = true;

    return {
      ...track,
      clips: clips.map((clip) => (clip.id === clipId ? update(clip) : clip)),
    } as TimelineTrack;
  });

  if (!didUpdate) {
    return project;
  }

  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks,
    },
  };
}

export function commitGenerationSuccess(
  project: AsmrProject,
  clipId: string,
  asset: GeneratedAssetResult,
): AsmrProject {
  return updateClipGeneration(project, clipId, (clip) => ({
    ...clip,
    generation: {
      ...clip.generation,
      status: "asset_generated",
      error: null,
    },
    asset: {
      asset_id: asset.assetId,
      uri: asset.uri,
      duration: asset.duration,
    },
  }));
}

export function commitGenerationFailure(
  project: AsmrProject,
  clipId: string,
  { reason, error }: GenerationFailureInput,
): AsmrProject {
  return updateClipGeneration(project, clipId, (clip) => {
    if (reason === "regenerate" && hasAsset(clip)) {
      return {
        ...clip,
        generation: {
          ...clip.generation,
          status: "asset_generated",
          error: null,
        },
      };
    }

    return {
      ...clip,
      generation: {
        ...clip.generation,
        status: "asset_failed",
        error,
      },
      asset: {
        asset_id: null,
        uri: null,
        duration: null,
      },
    };
  });
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-project-state
```

Expected: PASS for `generation-project-state.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-project-state.ts apps/web/src/lib/asmr/generation-project-state.test.ts
git commit -m "feat: commit generated assets to project state"
```

---

### Task 3: Runtime Jobs And Effective Generation View

**Files:**
- Create: `apps/web/src/lib/asmr/generation-runtime.ts`
- Create: `apps/web/src/lib/asmr/generation-runtime.test.ts`
- Create: `apps/web/src/lib/asmr/generation-view.ts`
- Create: `apps/web/src/lib/asmr/generation-view.test.ts`

- [ ] **Step 1: Write runtime state tests**

Create `apps/web/src/lib/asmr/generation-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  getGenerationJobForClip,
  upsertGenerationJob,
} from "./generation-runtime";
import type { GenerationJobSnapshot } from "./generation-bridge";

const job: GenerationJobSnapshot = {
  jobId: "job_1",
  clipId: "voice_001",
  status: "generating",
  progress: 42,
  message: "生成中",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:01.000Z",
};

describe("generation runtime state", () => {
  it("upserts and looks up jobs by clip id", () => {
    const state = upsertGenerationJob(emptyGenerationRuntimeState, job);

    expect(state).not.toBe(emptyGenerationRuntimeState);
    expect(getGenerationJobForClip(state, "voice_001")).toEqual(job);
    expect(getGenerationJobForClip(state, "voice_002")).toBeUndefined();
  });

  it("replaces the previous job for the same clip", () => {
    const first = upsertGenerationJob(emptyGenerationRuntimeState, job);
    const secondJob = {
      ...job,
      jobId: "job_2",
      progress: 76,
    };
    const second = upsertGenerationJob(first, secondJob);

    expect(second.jobsById.job_1).toBeUndefined();
    expect(second.jobsById.job_2).toEqual(secondJob);
    expect(second.jobIdByClipId.voice_001).toBe("job_2");
  });

  it("clears jobs by job id", () => {
    const state = upsertGenerationJob(emptyGenerationRuntimeState, job);
    const cleared = clearGenerationJob(state, "job_1");

    expect(cleared.jobsById).toEqual({});
    expect(cleared.jobIdByClipId).toEqual({});
  });
});
```

- [ ] **Step 2: Write generation view tests**

Create `apps/web/src/lib/asmr/generation-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { GenerationJobSnapshot } from "./generation-bridge";
import { getGenerationView } from "./generation-view";
import {
  emptyGenerationRuntimeState,
  upsertGenerationJob,
} from "./generation-runtime";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

const generatingJob: GenerationJobSnapshot = {
  jobId: "job_1",
  clipId: "voice_001",
  status: "generating",
  progress: 42,
  message: "生成中",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:01.000Z",
};

describe("generation view", () => {
  it("shows generate action for a valid pending selected clip", () => {
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "generate",
      label: "生成",
      disabled: false,
      statusLabel: "待生成",
    });
    expect(view.selectedClipPreview.canPlay).toBe(false);
  });

  it("disables generation when selected clip has validation issues", () => {
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: true,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "generate",
      label: "生成",
      disabled: true,
      disabledReason: "先修正片段",
    });
  });

  it("lets runtime generating state override durable pending state", () => {
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      generatingJob,
    );
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.generatedClipCount).toBe(0);
    expect(view.preview.generatingClipCount).toBe(1);
    expect(view.selectedClipControl).toMatchObject({
      action: "cancel",
      label: "取消",
      progress: 42,
      statusLabel: "生成中",
    });
  });

  it("shows regenerate and playable preview for generated clips", () => {
    const project = commitGenerationSuccess(demoProject, "voice_001", {
      assetId: "mock_voice_001_job_1",
      uri: "mock://asset/voice_001/job_1",
      duration: 7.5,
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "regenerate",
      label: "重生成",
      disabled: false,
      statusLabel: "可预览",
    });
    expect(view.selectedClipPreview).toEqual({
      canPlay: true,
      label: "播放片段",
      uri: "mock://asset/voice_001/job_1",
    });
  });

  it("shows retry for failed clips", () => {
    const project = commitGenerationFailure(demoProject, "voice_001", {
      reason: "generate",
      error: "Mock generation failed",
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "retry",
      label: "重试",
      statusLabel: "失败",
      error: "Mock generation failed",
    });
  });
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-runtime generation-view
```

Expected: FAIL because `generation-runtime.ts` and `generation-view.ts` do not exist.

- [ ] **Step 4: Implement runtime state**

Create `apps/web/src/lib/asmr/generation-runtime.ts`:

```ts
import type { GenerationJobSnapshot } from "./generation-bridge";

export type GenerationRuntimeState = {
  jobsById: Record<string, GenerationJobSnapshot>;
  jobIdByClipId: Record<string, string>;
};

export const emptyGenerationRuntimeState: GenerationRuntimeState = {
  jobsById: {},
  jobIdByClipId: {},
};

export function getGenerationJobForClip(
  state: GenerationRuntimeState,
  clipId: string,
): GenerationJobSnapshot | undefined {
  const jobId = state.jobIdByClipId[clipId];

  return jobId ? state.jobsById[jobId] : undefined;
}

export function upsertGenerationJob(
  state: GenerationRuntimeState,
  job: GenerationJobSnapshot,
): GenerationRuntimeState {
  const previousJobId = state.jobIdByClipId[job.clipId];
  const jobsById = { ...state.jobsById };

  if (previousJobId && previousJobId !== job.jobId) {
    delete jobsById[previousJobId];
  }

  jobsById[job.jobId] = job;

  return {
    jobsById,
    jobIdByClipId: {
      ...state.jobIdByClipId,
      [job.clipId]: job.jobId,
    },
  };
}

export function clearGenerationJob(
  state: GenerationRuntimeState,
  jobId: string,
): GenerationRuntimeState {
  const job = state.jobsById[jobId];

  if (!job) {
    return state;
  }

  const jobsById = { ...state.jobsById };
  const jobIdByClipId = { ...state.jobIdByClipId };

  delete jobsById[jobId];
  delete jobIdByClipId[job.clipId];

  return {
    jobsById,
    jobIdByClipId,
  };
}
```

- [ ] **Step 5: Implement effective generation view**

Create `apps/web/src/lib/asmr/generation-view.ts`:

```ts
import { getProjectPreviewSummary } from "./generation-summary";
import type { GenerationSlotTone, ProjectPreviewSummary } from "./generation-summary";
import type { GenerationJobSnapshot } from "./generation-bridge";
import type { GenerationRuntimeState } from "./generation-runtime";
import { getGenerationJobForClip } from "./generation-runtime";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";

export type SelectedClipGenerationAction =
  | "generate"
  | "regenerate"
  | "retry"
  | "cancel"
  | "none";

export type SelectedClipGenerationControl = {
  action: SelectedClipGenerationAction;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  statusLabel: string;
  tone: GenerationSlotTone;
  progress?: number;
  error?: string;
  jobId?: string;
};

export type SelectedClipPreview = {
  canPlay: boolean;
  label: string;
  uri?: string;
};

export type GenerationView = {
  preview: ProjectPreviewSummary;
  selectedClipControl: SelectedClipGenerationControl;
  selectedClipPreview: SelectedClipPreview;
};

type GenerationViewInput = {
  project: AsmrProject;
  selectedClip: TimelineClip | undefined;
  runtimeState: GenerationRuntimeState;
  selectedClipHasValidationIssues: boolean;
};

function cloneProjectWithRuntimeJobs(
  project: AsmrProject,
  runtimeState: GenerationRuntimeState,
): AsmrProject {
  const tracks = project.timeline.tracks.map((track) => {
    const clips = (track.clips as TimelineClip[]).map((clip) => {
      const job = getGenerationJobForClip(runtimeState, clip.id);

      if (!job || job.status === "failed" || job.status === "canceled") {
        return clip;
      }

      return {
        ...clip,
        generation: {
          ...clip.generation,
          status: "asset_generating" as const,
        },
      };
    });

    return { ...track, clips } as TimelineTrack;
  });

  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks,
    },
  };
}

function getRuntimeControl(job: GenerationJobSnapshot): SelectedClipGenerationControl {
  const isCanceling = job.status === "canceling";

  return {
    action: "cancel",
    label: "取消",
    disabled: isCanceling,
    disabledReason: isCanceling ? "正在取消" : undefined,
    statusLabel: isCanceling ? "取消中" : "生成中",
    tone: "accent",
    progress: job.progress,
    jobId: job.jobId,
  };
}

function getSelectedClipControl({
  selectedClip,
  job,
  selectedClipHasValidationIssues,
}: {
  selectedClip: TimelineClip | undefined;
  job: GenerationJobSnapshot | undefined;
  selectedClipHasValidationIssues: boolean;
}): SelectedClipGenerationControl {
  if (!selectedClip) {
    return {
      action: "none",
      label: "无片段",
      disabled: true,
      disabledReason: "未选择片段",
      statusLabel: "无片段",
      tone: "neutral",
    };
  }

  if (job && job.status !== "failed" && job.status !== "canceled") {
    return getRuntimeControl(job);
  }

  const disabled = selectedClipHasValidationIssues;
  const disabledReason = disabled ? "先修正片段" : undefined;

  if (selectedClip.generation.status === "asset_failed") {
    return {
      action: "retry",
      label: "重试",
      disabled,
      disabledReason,
      statusLabel: "失败",
      tone: "warn",
      error: selectedClip.generation.error ?? undefined,
    };
  }

  if (
    selectedClip.generation.status === "asset_generated" ||
    selectedClip.asset.asset_id ||
    selectedClip.asset.uri
  ) {
    return {
      action: "regenerate",
      label: "重生成",
      disabled,
      disabledReason,
      statusLabel: "可预览",
      tone: "ok",
    };
  }

  return {
    action: "generate",
    label: "生成",
    disabled,
    disabledReason,
    statusLabel: "待生成",
    tone: "neutral",
  };
}

function getSelectedClipPreview(
  selectedClip: TimelineClip | undefined,
): SelectedClipPreview {
  if (!selectedClip?.asset.uri) {
    return {
      canPlay: false,
      label: "暂无音频",
    };
  }

  return {
    canPlay: true,
    label: "播放片段",
    uri: selectedClip.asset.uri,
  };
}

export function getGenerationView({
  project,
  selectedClip,
  runtimeState,
  selectedClipHasValidationIssues,
}: GenerationViewInput): GenerationView {
  const displayProject = cloneProjectWithRuntimeJobs(project, runtimeState);
  const displaySelectedClip = selectedClip
    ? displayProject.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedClip.id)
    : undefined;
  const selectedClipJob = selectedClip
    ? getGenerationJobForClip(runtimeState, selectedClip.id)
    : undefined;

  return {
    preview: getProjectPreviewSummary({
      project: displayProject,
      selectedClip: displaySelectedClip,
    }),
    selectedClipControl: getSelectedClipControl({
      selectedClip,
      job: selectedClipJob,
      selectedClipHasValidationIssues,
    }),
    selectedClipPreview: getSelectedClipPreview(selectedClip),
  };
}
```

- [ ] **Step 6: Run focused tests to verify they pass**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-runtime generation-view
```

Expected: PASS for `generation-runtime.test.ts` and `generation-view.test.ts`.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-runtime.ts apps/web/src/lib/asmr/generation-runtime.test.ts apps/web/src/lib/asmr/generation-view.ts apps/web/src/lib/asmr/generation-view.test.ts
git commit -m "feat: derive runtime generation view"
```

---

### Task 4: Mock Asset Resolver

**Files:**
- Create: `apps/web/src/lib/asmr/mock-asset-resolver.ts`
- Create: `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

Create `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isMockAssetUri,
  resolveMockAssetUri,
} from "./mock-asset-resolver";

describe("mock asset resolver", () => {
  it("detects mock asset URIs", () => {
    expect(isMockAssetUri("mock://asset/voice_001/job_1")).toBe(true);
    expect(isMockAssetUri("https://example.com/audio.wav")).toBe(false);
    expect(isMockAssetUri(null)).toBe(false);
  });

  it("returns deterministic playable data URLs for mock assets", () => {
    const first = resolveMockAssetUri("mock://asset/voice_001/job_1");
    const second = resolveMockAssetUri("mock://asset/voice_001/job_1");

    expect(first).toBe(second);
    expect(first).toMatch(/^data:audio\/wav;base64,/);
  });

  it("passes non-mock URIs through unchanged", () => {
    expect(resolveMockAssetUri("https://example.com/audio.wav")).toBe(
      "https://example.com/audio.wav",
    );
  });

  it("returns undefined for empty URIs", () => {
    expect(resolveMockAssetUri(null)).toBeUndefined();
    expect(resolveMockAssetUri(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-asset-resolver
```

Expected: FAIL because `mock-asset-resolver.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/web/src/lib/asmr/mock-asset-resolver.ts`:

```ts
const mockAssetPrefix = "mock://asset/";
const cachedDataUrls = new Map<string, string>();

export function isMockAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith(mockAssetPrefix));
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function makeMockWavDataUrl(uri: string): string {
  const sampleRate = 8000;
  const seconds = 0.45;
  const sampleCount = Math.floor(sampleRate * seconds);
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(buffer);
  const seed = [...uri].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  const frequency = 220 + (seed % 220);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, sampleCount * bytesPerSample, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    const sample =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * envelope * 0.18;
    view.setInt16(44 + index * bytesPerSample, sample * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function resolveMockAssetUri(
  uri: string | null | undefined,
): string | undefined {
  if (!uri) {
    return undefined;
  }

  if (!isMockAssetUri(uri)) {
    return uri;
  }

  const cached = cachedDataUrls.get(uri);

  if (cached) {
    return cached;
  }

  const dataUrl = makeMockWavDataUrl(uri);
  cachedDataUrls.set(uri, dataUrl);

  return dataUrl;
}
```

- [ ] **Step 4: Run focused test to verify it passes**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-asset-resolver
```

Expected: PASS for `mock-asset-resolver.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/asmr/mock-asset-resolver.ts apps/web/src/lib/asmr/mock-asset-resolver.test.ts
git commit -m "feat: resolve mock audio assets"
```

---

### Task 5: Wire Generation Controls Into The Studio

**Files:**
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`
- Modify: `apps/web/src/components/studio/preview-layer-panel.tsx`
- Modify: `apps/web/src/components/studio/project-details-dock.tsx`
- Modify: `apps/web/src/components/studio/project-workspace.tsx`
- Modify: `apps/web/src/components/studio/studio-app.tsx`

- [ ] **Step 1: Add Inspector generation control props**

In `apps/web/src/components/studio/clip-inspector.tsx`, add imports:

```ts
import { LoaderCircle, RefreshCcw, Sparkles, X } from "lucide-react";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
```

Merge the new icon names into the existing lucide import instead of creating a second `lucide-react` import.

Update `ClipInspectorProps`:

```ts
type ClipInspectorProps = {
  fieldValidationIssues: ClipFieldValidationIssues;
  selectedClip: TimelineClip | undefined;
  selectedClipGeneration: SelectedClipGenerationControl;
  selectedClipSlot: GenerationSlot | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onGenerateSelectedClip: () => void;
  onCancelSelectedGeneration: () => void;
  onNudgeClipTiming: (clipId: string, nudge: ClipTimingNudge) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};
```

Add the new props to the function destructuring:

```ts
export function ClipInspector({
  fieldValidationIssues,
  selectedClip,
  selectedClipGeneration,
  selectedClipSlot,
  onApplyDirectorPreset,
  onGenerateSelectedClip,
  onCancelSelectedGeneration,
  onNudgeClipTiming,
  onUpdateClip,
}: ClipInspectorProps) {
```

- [ ] **Step 2: Add an Inspector generation action component**

In `clip-inspector.tsx`, add this component before `FieldError`:

```tsx
function GenerationActionPanel({
  control,
  onCancel,
  onGenerate,
}: {
  control: SelectedClipGenerationControl;
  onCancel: () => void;
  onGenerate: () => void;
}) {
  const isCancel = control.action === "cancel";
  const Icon = isCancel
    ? X
    : control.action === "regenerate" || control.action === "retry"
      ? RefreshCcw
      : Sparkles;
  const progress = control.progress ?? 0;

  return (
    <div className="border-b border-white/[0.06] py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
            生成
          </p>
          <p className="mt-1 truncate text-xs text-studio-muted">
            {control.disabledReason ?? control.statusLabel}
          </p>
        </div>
        <button
          type="button"
          disabled={control.disabled}
          onClick={isCancel ? onCancel : onGenerate}
          className="inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded-md border border-sky-300/24 bg-sky-300/12 px-3 text-xs font-semibold text-sky-50 transition hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.035] disabled:text-studio-muted"
        >
          {control.action === "cancel" && control.progress !== undefined ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{control.label}</span>
        </button>
      </div>

      {control.progress !== undefined ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-sky-300/80 transition-[width]"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      ) : null}

      {control.error ? (
        <p className="mt-2 text-xs leading-5 text-amber-100">{control.error}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Render the generation action in Inspector**

In `ClipInspector`, after `TimingActionStrip` and before the selected clip asset slot, add:

```tsx
<GenerationActionPanel
  control={selectedClipGeneration}
  onCancel={onCancelSelectedGeneration}
  onGenerate={onGenerateSelectedClip}
/>
```

- [ ] **Step 4: Add selected clip preview props to `PreviewLayerPanel`**

In `apps/web/src/components/studio/preview-layer-panel.tsx`, import:

```ts
import type { SelectedClipPreview } from "@/lib/asmr/generation-view";
```

Update props:

```ts
type PreviewLayerPanelProps = {
  preview: ProjectPreviewSummary;
  selectedClipPreview: SelectedClipPreview;
  onPlaySelectedClip: () => void;
};
```

Update signature:

```ts
export function PreviewLayerPanel({
  preview,
  selectedClipPreview,
  onPlaySelectedClip,
}: PreviewLayerPanelProps) {
```

Replace the existing disabled preview button with:

```tsx
<button
  type="button"
  disabled={!selectedClipPreview.canPlay}
  onClick={onPlaySelectedClip}
  aria-label={selectedClipPreview.label}
  title={selectedClipPreview.label}
  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-studio-line bg-white/[0.035] text-studio-muted opacity-80 transition hover:border-sky-300/30 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-55"
>
  <Play className="h-4 w-4" aria-hidden="true" />
</button>
```

Keep the project-level copy `真实音频尚未生成`, because this first pass only enables selected-clip mock playback.

- [ ] **Step 5: Pass preview props through the workspace shell**

In `project-details-dock.tsx`, import:

```ts
import type { SelectedClipPreview } from "@/lib/asmr/generation-view";
```

Update props:

```ts
type ProjectDetailsDockProps = {
  collapsed: boolean;
  panelId: string;
  summary: ProjectWorkspaceSummary;
  preview: ProjectPreviewSummary;
  selectedClipPreview: SelectedClipPreview;
  onPlaySelectedClip: () => void;
  onToggle: () => void;
};
```

Pass them into `PreviewLayerPanel`:

```tsx
<PreviewLayerPanel
  preview={preview}
  selectedClipPreview={selectedClipPreview}
  onPlaySelectedClip={onPlaySelectedClip}
/>
```

In `project-workspace.tsx`, import `SelectedClipPreview`, add these props, and pass them to `ProjectDetailsDock`:

```ts
selectedClipPreview: SelectedClipPreview;
onPlaySelectedClip: () => void;
```

```tsx
<ProjectDetailsDock
  collapsed={rightCollapsed}
  panelId={PROJECT_WORKSPACE_DETAILS_ID}
  summary={summary}
  preview={preview}
  selectedClipPreview={selectedClipPreview}
  onPlaySelectedClip={onPlaySelectedClip}
  onToggle={() => setRightCollapsed((current) => !current)}
/>
```

- [ ] **Step 6: Wire bridge state in `StudioApp`**

In `apps/web/src/components/studio/studio-app.tsx`, add imports:

```ts
import type { GenerateClipReason, GenerationJobUpdate } from "@/lib/asmr/generation-bridge";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "@/lib/asmr/generation-project-state";
import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  upsertGenerationJob,
} from "@/lib/asmr/generation-runtime";
import { getGenerationView } from "@/lib/asmr/generation-view";
import { createMockGenerationBridge } from "@/lib/asmr/mock-generation-bridge";
import { resolveMockAssetUri } from "@/lib/asmr/mock-asset-resolver";
```

Update React import:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

Add refs and state inside `StudioApp`:

```ts
const bridgeRef = useRef(createMockGenerationBridge());
const audioRef = useRef<HTMLAudioElement>();
const generationReasonsRef = useRef<Record<string, GenerateClipReason>>({});
const [generationRuntimeState, setGenerationRuntimeState] = useState(
  emptyGenerationRuntimeState,
);
```

Replace `previewSummary` with generation view:

```ts
const selectedClipHasValidationIssues = Object.keys(
  selectedClipValidationIssues,
).length > 0;
const generationView = useMemo(
  () =>
    getGenerationView({
      project: editableProject,
      selectedClip,
      runtimeState: generationRuntimeState,
      selectedClipHasValidationIssues,
    }),
  [
    editableProject,
    generationRuntimeState,
    selectedClip,
    selectedClipHasValidationIssues,
  ],
);
const previewSummary = generationView.preview;
```

Add this update handler:

```ts
function handleGenerationUpdate(update: GenerationJobUpdate) {
  if (update.type === "snapshot") {
    setGenerationRuntimeState((current) =>
      upsertGenerationJob(current, update.job),
    );
    return;
  }

  if (update.type === "succeeded") {
    setEditableProject((currentProject) =>
      commitGenerationSuccess(
        currentProject,
        update.job.clipId,
        update.asset,
      ),
    );
    setGenerationRuntimeState((current) =>
      clearGenerationJob(current, update.job.jobId),
    );
    delete generationReasonsRef.current[update.job.jobId];
    return;
  }

  if (update.type === "failed") {
    const reason = generationReasonsRef.current[update.job.jobId] ?? "generate";

    setEditableProject((currentProject) =>
      commitGenerationFailure(currentProject, update.job.clipId, {
        reason,
        error: update.error,
      }),
    );
    setGenerationRuntimeState((current) =>
      clearGenerationJob(current, update.job.jobId),
    );
    delete generationReasonsRef.current[update.job.jobId];
    return;
  }

  setGenerationRuntimeState((current) =>
    clearGenerationJob(current, update.job.jobId),
  );
  delete generationReasonsRef.current[update.job.jobId];
}
```

Add generate/cancel/play handlers:

```ts
async function handleGenerateSelectedClip() {
  if (!selectedClip || generationView.selectedClipControl.disabled) {
    return;
  }

  const action = generationView.selectedClipControl.action;
  const reason: GenerateClipReason =
    action === "retry"
      ? "retry"
      : action === "regenerate"
        ? "regenerate"
        : "generate";
  const started = await bridgeRef.current.generateClip(
    {
      project: editableProject,
      clipId: selectedClip.id,
      reason,
    },
    handleGenerationUpdate,
  );

  generationReasonsRef.current[started.jobId] = reason;
}

async function handleCancelSelectedGeneration() {
  const jobId = generationView.selectedClipControl.jobId;

  if (!jobId) {
    return;
  }

  await bridgeRef.current.cancelGeneration(jobId);
}

function handlePlaySelectedClip() {
  const resolvedUri = resolveMockAssetUri(generationView.selectedClipPreview.uri);

  if (!resolvedUri) {
    return;
  }

  audioRef.current?.pause();
  audioRef.current = new Audio(resolvedUri);
  void audioRef.current.play();
}
```

Add a cleanup effect:

```ts
useEffect(() => {
  return () => {
    audioRef.current?.pause();
  };
}, []);
```

Pass new props to `ProjectWorkspace`:

```tsx
selectedClipPreview={generationView.selectedClipPreview}
onPlaySelectedClip={handlePlaySelectedClip}
```

Pass new props to `ClipInspector`:

```tsx
selectedClipGeneration={generationView.selectedClipControl}
onGenerateSelectedClip={handleGenerateSelectedClip}
onCancelSelectedGeneration={handleCancelSelectedGeneration}
```

- [ ] **Step 7: Run focused automated checks**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation
npm.cmd run lint --prefix apps/web
```

Expected:

- Generation-related tests pass.
- Lint passes with no unused imports or hook dependency issues.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/components/studio/clip-inspector.tsx apps/web/src/components/studio/preview-layer-panel.tsx apps/web/src/components/studio/project-details-dock.tsx apps/web/src/components/studio/project-workspace.tsx apps/web/src/components/studio/studio-app.tsx
git commit -m "feat: wire mock generation controls"
```

---

### Task 6: Full Verification And Documentation

**Files:**
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`
- Modify implementation files only if verification reveals defects.

- [ ] **Step 1: Run full automated verification**

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

- [ ] **Step 2: Start or reuse the local app server**

If no app server is active, run:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

Expected: app is reachable at:

```text
http://localhost:3000/
```

- [ ] **Step 3: Browser-verify selected clip generation**

Use the in-app browser at a desktop viewport such as `1440x1000`.

Confirm:

- Inspector shows a `生成` section for the selected clip.
- A pending clip shows `生成`.
- Clicking `生成` shows progress and a `取消` action.
- Timeline dot, preview counts, and Inspector agree that one clip is generating.
- After mock success, the selected clip shows `重生成`.
- Preview layer play button becomes enabled for the selected clip.
- Clicking preview play starts mock audio without writing a `blob:` URL into project JSON.

- [ ] **Step 4: Browser-verify retry, cancel, and validation states**

Confirm:

- A clip with field-level validation issues disables generation and shows `先修正片段`.
- Canceling an in-flight job clears progress and returns to the prior durable state.
- A deterministic mock failure path can be triggered by temporarily configuring `failClipIds` in `createMockGenerationBridge` during local verification; after verification, remove that temporary configuration before committing.
- Failed clips show `重试`.
- Failed regeneration preserves a previously generated asset.

- [ ] **Step 5: Browser-verify existing project behavior**

Confirm:

- Import invalid JSON still shows the existing import/schema error.
- Reset still restores the demo project and clears runtime jobs.
- Exported JSON contains `mock://` asset URIs for successful mock assets.
- Exported JSON does not contain `jobId`, `progress`, `queued`, `generating`, `canceling`, or `data:audio`.
- Left/right panel collapse and `专注编辑` still work.
- Mobile viewport such as `390x900` has no document-level horizontal overflow:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

- [ ] **Step 6: Update `docs/AI_HANDOFF.md`**

Add current capability bullets:

```markdown
- Adds a mock-first Generation Bridge for selected clips.
- Keeps runtime job state outside `AsmrProject` and out of exported project JSON.
- Commits only final `asset_generated` / `asset_failed` state and final asset metadata into the project.
- Resolves `mock://` asset URIs to playable local mock audio at runtime.
- Exposes selected clip `生成`, `重生成`, `重试`, and `取消` controls in Inspector.
- Enables selected clip mock preview in the right preview layer while keeping project mix preview out of scope.
```

Update recommended next work:

```markdown
Recommended next step: **API-backed generation bridge design**.

Why this next: the product now has the bridge boundary, runtime job semantics, durable asset commits, and mock playback. The next design should replace the mock bridge with a backend-shaped API contract for real TTS/SFX/ambience services, storage, and job polling.
```

- [ ] **Step 7: Update `docs/project-archive.md`**

Append:

```markdown
## 2026-06-22 - Generation Bridge

- Implemented the mock-first Generation Bridge from `docs/superpowers/specs/2026-06-22-generation-bridge-design.md` and `.zh.md`.
- Added runtime-only job state for queued/generating/cancel/canceling/progress behavior.
- Added durable project commits for generated mock assets and failed generation state without saving runtime job data.
- Added `mock://` asset resolution to playable local mock audio without exporting browser `blob:` or `data:` URLs.
- Added selected clip generation controls in Inspector and selected clip mock preview in the right preview layer.
- Preserved import/export/reset/autosave, validation, Timeline status display, and collapsible project workspace behavior.
```

- [ ] **Step 8: Run final automated verification after docs**

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

- [ ] **Step 9: Commit docs and any verification fixes**

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md apps/web/src/lib/asmr apps/web/src/components/studio
git commit -m "docs: record generation bridge implementation"
```

If there were no implementation fixes after Task 5, this commit should include only the two docs files.

---

## Self-Review Checklist

- Spec coverage:
  - Generation Bridge contract: Task 1.
  - Mock implementation with backend-shaped boundary: Task 1.
  - Runtime job state outside `AsmrProject`: Task 3.
  - Durable success/failure asset commits: Task 2.
  - Regeneration failure preserving old assets: Task 2.
  - Effective merged generation display: Task 3.
  - Mock asset URI strategy and no `blob:` persistence: Task 4.
  - Inspector `生成` / `重生成` / `重试` / `取消`: Task 5.
  - Preview layer selected clip playback: Task 5.
  - Existing local-first import/export/reset/autosave behavior: Task 6.

- Verification coverage:
  - RED/GREEN unit tests for each new helper.
  - Focused generation tests before UI wiring.
  - Full test/lint/build before completion.
  - Browser verification for generation success, cancel, retry/failure, playback, export cleanliness, collapsible layout, and mobile overflow.

- Scope guard:
  - Do not add real TTS, SFX, ambience models, backend queues, auth, cloud storage, or project mix generation.
  - Do not save runtime `jobId`, progress, queue state, browser `blob:` URLs, or `data:` URLs into project JSON.
  - Keep UI labels short and Chinese.
