# API-Backed Generation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an API-shaped generation bridge that supports clip generation, project mix jobs, full-project preview, and WAV download through durable `asset://` references while still using a local mock backend.

**Architecture:** Extend the existing mock-first generation boundary instead of replacing the studio workflow. Add stable asset URI helpers, input fingerprints, project-mix durable state helpers, runtime project job tracking, and an API-shaped mock bridge that behaves like a future HTTP-backed bridge. The UI continues to derive display state from `AsmrProject` plus runtime jobs.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, lucide-react, Zod, Vitest.

---

## File Structure

- Modify `apps/web/src/lib/asmr/generation-bridge.ts`
  - Extend generation types from clip-only to clip and project-mix jobs.
  - Add stable asset reference metadata and bridge methods for playback/download resolution.
- Create `apps/web/src/lib/asmr/generation-asset-uri.ts`
  - Parse and build `asset://clip/<assetId>` and `asset://mix/<assetId>` references.
- Create `apps/web/src/lib/asmr/generation-asset-uri.test.ts`
  - Unit coverage for stable asset URI helpers.
- Create `apps/web/src/lib/asmr/generation-fingerprint.ts`
  - Deterministic fingerprints for clip generation and project mix inputs.
- Create `apps/web/src/lib/asmr/generation-fingerprint.test.ts`
  - Unit coverage for fingerprint stability and change detection.
- Create `apps/web/src/lib/asmr/project-mix-state.ts`
  - Project mix readiness, durable mix success/failure commits, and mix asset lookup.
- Create `apps/web/src/lib/asmr/project-mix-state.test.ts`
  - Unit coverage for missing asset detection and durable WAV export writes.
- Modify `apps/web/src/lib/asmr/generation-runtime.ts`
  - Track both clip jobs and project-mix jobs in runtime-only state.
- Modify `apps/web/src/lib/asmr/generation-runtime.test.ts`
  - Add project-mix runtime tests without regressing clip runtime tests.
- Modify `apps/web/src/lib/asmr/mock-generation-bridge.ts`
  - Make the mock bridge API-shaped: `asset://` URIs, project-mix jobs, playback/download resolution.
- Modify `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`
  - Add project-mix, playback URL, and download URL tests.
- Modify `apps/web/src/lib/asmr/mock-asset-resolver.ts`
  - Resolve mock `asset://clip/...` and `asset://mix/...` URIs to local playable WAV data URLs while preserving existing `mock://` compatibility.
- Modify `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`
  - Cover stable asset URI resolution and non-persistence of data URLs.
- Modify `apps/web/src/lib/asmr/generation-view.ts`
  - Add project-mix control state, full-project preview state, and WAV download state.
- Modify `apps/web/src/lib/asmr/generation-view.test.ts`
  - Cover project mix disabled/enabled/generating/generated/failed display states.
- Modify `apps/web/src/components/studio/preview-layer-panel.tsx`
  - Add full-project mix action, full-project play action, and WAV download action.
- Modify `apps/web/src/components/studio/project-details-dock.tsx`
  - Pass project-mix controls through to the Preview Layer.
- Modify `apps/web/src/components/studio/project-workspace.tsx`
  - Pass project-mix controls through to the right dock.
- Modify `apps/web/src/components/studio/studio-app.tsx`
  - Own project-mix generation callbacks, stale fingerprint checks, playback, download, reset/import cleanup, and runtime cancellation.
- Modify `apps/web/src/lib/asmr/project-persistence.test.ts`
  - Verify exported project JSON contains stable `asset://` references but no playback/download data URLs.
- Modify `docs/AI_HANDOFF.md`
  - Record the API-shaped bridge implementation and update the next recommended work.
- Modify `docs/project-archive.md`
  - Add a dated implementation note.

---

### Task 1: Stable Asset URIs And Input Fingerprints

**Files:**
- Modify: `apps/web/src/lib/asmr/generation-bridge.ts`
- Create: `apps/web/src/lib/asmr/generation-asset-uri.ts`
- Create: `apps/web/src/lib/asmr/generation-asset-uri.test.ts`
- Create: `apps/web/src/lib/asmr/generation-fingerprint.ts`
- Create: `apps/web/src/lib/asmr/generation-fingerprint.test.ts`

- [ ] **Step 1: Write failing asset URI tests**

Create `apps/web/src/lib/asmr/generation-asset-uri.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildAssetUri,
  getAssetIdFromUri,
  getAssetKindFromUri,
  isStableAssetUri,
  parseAssetUri,
} from "./generation-asset-uri";

describe("generation asset uri", () => {
  it("builds stable clip and mix asset URIs", () => {
    expect(buildAssetUri("clip", "clip_asset_1")).toBe(
      "asset://clip/clip_asset_1",
    );
    expect(buildAssetUri("project_mix", "mix_asset_1")).toBe(
      "asset://mix/mix_asset_1",
    );
  });

  it("parses stable asset URIs", () => {
    expect(parseAssetUri("asset://clip/clip_asset_1")).toEqual({
      kind: "clip",
      assetId: "clip_asset_1",
    });
    expect(parseAssetUri("asset://mix/mix_asset_1")).toEqual({
      kind: "project_mix",
      assetId: "mix_asset_1",
    });
  });

  it("rejects temporary or malformed URIs", () => {
    expect(parseAssetUri("mock://asset/voice_001/job_1")).toBeUndefined();
    expect(parseAssetUri("data:audio/wav;base64,abc")).toBeUndefined();
    expect(parseAssetUri("blob:http://example.test/123")).toBeUndefined();
    expect(parseAssetUri("asset://unknown/123")).toBeUndefined();
    expect(parseAssetUri("asset://clip/")).toBeUndefined();
  });

  it("reads asset kind and id safely", () => {
    expect(isStableAssetUri("asset://mix/mix_asset_1")).toBe(true);
    expect(getAssetKindFromUri("asset://mix/mix_asset_1")).toBe("project_mix");
    expect(getAssetIdFromUri("asset://mix/mix_asset_1")).toBe("mix_asset_1");
    expect(isStableAssetUri(null)).toBe(false);
    expect(getAssetKindFromUri(undefined)).toBeUndefined();
    expect(getAssetIdFromUri("mock://asset/voice_001/job_1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write failing fingerprint tests**

Create `apps/web/src/lib/asmr/generation-fingerprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  getClipGenerationFingerprint,
  getProjectMixFingerprint,
} from "./generation-fingerprint";
import { commitGenerationSuccess } from "./generation-project-state";
import { demoProject } from "./mock-project";
import type { AsmrProject } from "./schema";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

describe("generation fingerprints", () => {
  it("is stable for equivalent clip inputs", () => {
    const project = cloneProject();

    expect(getClipGenerationFingerprint(project, "voice_001")).toBe(
      getClipGenerationFingerprint(structuredClone(project), "voice_001"),
    );
  });

  it("changes when clip generation input changes", () => {
    const project = cloneProject();
    const before = getClipGenerationFingerprint(project, "voice_001");

    project.timeline.tracks[0].clips[0].duration += 0.5;

    expect(getClipGenerationFingerprint(project, "voice_001")).not.toBe(before);
  });

  it("is undefined for a missing clip", () => {
    expect(getClipGenerationFingerprint(cloneProject(), "missing")).toBeUndefined();
  });

  it("changes project mix fingerprint when clip asset references change", () => {
    const project = cloneProject();
    const before = getProjectMixFingerprint(project, "wav");
    const after = commitGenerationSuccess(project, "voice_001", {
      assetId: "clip_asset_1",
      uri: "asset://clip/clip_asset_1",
      duration: 7.5,
    });

    expect(getProjectMixFingerprint(after, "wav")).not.toBe(before);
  });

  it("changes project mix fingerprint when mixing settings change", () => {
    const project = cloneProject();
    const before = getProjectMixFingerprint(project, "wav");

    project.timeline.mixing.target_lufs = -18;

    expect(getProjectMixFingerprint(project, "wav")).not.toBe(before);
  });
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-asset-uri generation-fingerprint
```

Expected: FAIL because the helper files do not exist.

- [ ] **Step 4: Implement asset URI helpers**

Create `apps/web/src/lib/asmr/generation-asset-uri.ts`:

```ts
export type StableAssetKind = "clip" | "project_mix";

export type ParsedAssetUri = {
  kind: StableAssetKind;
  assetId: string;
};

const assetUriPattern = /^asset:\/\/(clip|mix)\/([^/]+)$/;

export function buildAssetUri(kind: StableAssetKind, assetId: string): string {
  const pathKind = kind === "project_mix" ? "mix" : "clip";

  return `asset://${pathKind}/${assetId}`;
}

export function parseAssetUri(
  uri: string | null | undefined,
): ParsedAssetUri | undefined {
  if (!uri) {
    return undefined;
  }

  const match = assetUriPattern.exec(uri);

  if (!match) {
    return undefined;
  }

  return {
    kind: match[1] === "mix" ? "project_mix" : "clip",
    assetId: match[2],
  };
}

export function isStableAssetUri(uri: string | null | undefined): boolean {
  return parseAssetUri(uri) !== undefined;
}

export function getAssetKindFromUri(
  uri: string | null | undefined,
): StableAssetKind | undefined {
  return parseAssetUri(uri)?.kind;
}

export function getAssetIdFromUri(
  uri: string | null | undefined,
): string | undefined {
  return parseAssetUri(uri)?.assetId;
}
```

- [ ] **Step 5: Implement fingerprint helpers**

Create `apps/web/src/lib/asmr/generation-fingerprint.ts`:

```ts
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

type ProjectMixExportType = "wav";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getClipContentPayload(clip: TimelineClip) {
  if (clip.type === "voice") {
    return {
      text: clip.text,
      emotion: clip.emotion,
      style: clip.style,
      pace: clip.pace,
    };
  }

  if (clip.type === "breath") {
    return { breath: clip.breath };
  }

  if (clip.type === "sfx") {
    return { sfx: clip.sfx };
  }

  return {
    ambience: clip.ambience,
    loop: clip.loop,
  };
}

function getClipGenerationPayload(clip: TimelineClip) {
  return {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    start: clip.start,
    duration: clip.duration,
    volume_db: clip.volume_db,
    fade_in: clip.fade_in,
    fade_out: clip.fade_out,
    position: clip.position,
    generation: {
      model: clip.generation.model,
      seed: clip.generation.seed,
      temperature: clip.generation.temperature,
      retry_count: clip.generation.retry_count,
    },
    content: getClipContentPayload(clip),
  };
}

export function getClipGenerationFingerprint(
  project: AsmrProject,
  clipId: string,
): string | undefined {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    return undefined;
  }

  return hashString(stableStringify(getClipGenerationPayload(clip)));
}

export function getProjectMixFingerprint(
  project: AsmrProject,
  exportType: ProjectMixExportType,
): string {
  return hashString(
    stableStringify({
      project_id: project.project_id,
      duration: project.duration,
      exportType,
      timeline: {
        tracks: project.timeline.tracks.map((track) => ({
          track_type: track.track_type,
          clips: track.clips.map((clip) => ({
            id: clip.id,
            track: clip.track,
            type: clip.type,
            start: clip.start,
            duration: clip.duration,
            volume_db: clip.volume_db,
            fade_in: clip.fade_in,
            fade_out: clip.fade_out,
            position: clip.position,
            asset: {
              asset_id: clip.asset.asset_id,
              uri: clip.asset.uri,
              duration: clip.asset.duration,
            },
          })),
        })),
        mixing: project.timeline.mixing,
      },
    }),
  );
}
```

- [ ] **Step 6: Extend bridge types without wiring behavior**

Modify `apps/web/src/lib/asmr/generation-bridge.ts`:

```ts
import type { AsmrProject } from "./schema";

export type GenerateClipReason = "generate" | "regenerate" | "retry";
export type GenerateProjectMixReason = "mix" | "remix" | "retry";
export type ProjectMixExportType = "wav";
export type ProjectMixPolicy = "require_all_assets" | "silence_missing_assets";

export type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: GenerateClipReason;
  inputFingerprint?: string;
};

export type GenerateProjectMixRequest = {
  project: AsmrProject;
  exportType: ProjectMixExportType;
  reason: GenerateProjectMixReason;
  mixPolicy: ProjectMixPolicy;
  inputFingerprint?: string;
};

export type GeneratedAssetKind = "clip" | "project_mix";

export type GeneratedAssetResult = {
  assetId: string;
  uri: string;
  duration: number;
  kind?: GeneratedAssetKind;
  format?: "wav" | "mp3";
  mimeType?: string;
  sampleRate?: number;
  channels?: number;
  sizeBytes?: number;
  sourceJobId?: string;
};

export type GenerationRuntimeStatus =
  | "queued"
  | "generating"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

export type GenerationJobTarget =
  | { type: "clip"; clipId: string }
  | { type: "project_mix"; exportType: ProjectMixExportType };

export type GenerationJobSnapshot = {
  jobId: string;
  clipId?: string;
  target: GenerationJobTarget;
  jobType: "clip_generation" | "project_mix";
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  inputFingerprint?: string;
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

export interface GenerationBridge {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;
  generateProjectMix(
    request: GenerateProjectMixRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;
  cancelGeneration(jobId: string): Promise<void>;
  resolvePlaybackUrl(assetUri: string): Promise<string | undefined>;
  resolveDownloadUrl(
    assetUri: string,
  ): Promise<{ url: string; filename: string } | undefined>;
}
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-asset-uri generation-fingerprint
```

Expected: PASS.

- [ ] **Step 8: Run broader generation tests and fix compile fallout**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation
```

Expected: It may fail because existing snapshots now need `target` and `jobType`. Update existing tests and mock bridge snapshot builders in the next task if needed. Do not add project-mix behavior in this task.

- [ ] **Step 9: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-bridge.ts apps/web/src/lib/asmr/generation-asset-uri.ts apps/web/src/lib/asmr/generation-asset-uri.test.ts apps/web/src/lib/asmr/generation-fingerprint.ts apps/web/src/lib/asmr/generation-fingerprint.test.ts
git commit -m "feat: add generation asset contract helpers"
```

---

### Task 2: Durable Project Mix State

**Files:**
- Create: `apps/web/src/lib/asmr/project-mix-state.ts`
- Create: `apps/web/src/lib/asmr/project-mix-state.test.ts`
- Modify: `apps/web/src/lib/asmr/generation-project-state.ts`
- Modify: `apps/web/src/lib/asmr/generation-project-state.test.ts`

- [ ] **Step 1: Write failing project-mix state tests**

Create `apps/web/src/lib/asmr/project-mix-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { commitGenerationSuccess } from "./generation-project-state";
import { demoProject } from "./mock-project";
import {
  commitProjectMixFailure,
  commitProjectMixSuccess,
  getMissingProjectMixClipIds,
  getProjectMixAsset,
  isProjectMixReady,
} from "./project-mix-state";
import type { AsmrProject } from "./schema";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

function withGeneratedClip(project: AsmrProject, clipId: string): AsmrProject {
  return commitGenerationSuccess(project, clipId, {
    assetId: `${clipId}_asset`,
    uri: `asset://clip/${clipId}_asset`,
    duration: 1,
    kind: "clip",
    format: "wav",
    mimeType: "audio/wav",
  });
}

function withAllGeneratedClips(project: AsmrProject): AsmrProject {
  return ["voice_001", "breath_001", "sfx_blanket_001", "ambience_rain_001"].reduce(
    (current, clipId) => withGeneratedClip(current, clipId),
    project,
  );
}

describe("project mix state", () => {
  it("detects missing generated clip assets for audio-bearing clips", () => {
    const project = cloneProject();

    expect(getMissingProjectMixClipIds(project)).toEqual([
      "voice_001",
      "breath_001",
      "sfx_blanket_001",
      "ambience_rain_001",
    ]);
    expect(isProjectMixReady(project)).toBe(false);
  });

  it("is ready once all audio-bearing clips have generated assets", () => {
    const project = withAllGeneratedClips(cloneProject());

    expect(getMissingProjectMixClipIds(project)).toEqual([]);
    expect(isProjectMixReady(project)).toBe(true);
  });

  it("commits a successful WAV project mix into exports", () => {
    const project = withAllGeneratedClips(cloneProject());
    const updated = commitProjectMixSuccess(project, {
      assetId: "mix_asset_1",
      uri: "asset://mix/mix_asset_1",
      duration: project.duration,
      kind: "project_mix",
      format: "wav",
      mimeType: "audio/wav",
      sampleRate: 48000,
      channels: 2,
    });

    expect(getProjectMixAsset(updated)).toEqual({
      assetId: "mix_asset_1",
      uri: "asset://mix/mix_asset_1",
      duration: project.duration,
    });
    expect(updated.exports.find((entry) => entry.type === "wav")).toMatchObject({
      status: "exported",
      uri: "asset://mix/mix_asset_1",
    });
  });

  it("commits first mix failure as export_failed without a URI", () => {
    const updated = commitProjectMixFailure(cloneProject(), {
      reason: "mix",
      error: "Missing required assets",
    });

    expect(updated.exports.find((entry) => entry.type === "wav")).toMatchObject({
      status: "export_failed",
      uri: null,
    });
  });

  it("preserves a previous mix asset when remix fails", () => {
    const project = commitProjectMixSuccess(withAllGeneratedClips(cloneProject()), {
      assetId: "mix_asset_1",
      uri: "asset://mix/mix_asset_1",
      duration: 210,
      kind: "project_mix",
      format: "wav",
      mimeType: "audio/wav",
    });
    const updated = commitProjectMixFailure(project, {
      reason: "remix",
      error: "Mix failed",
    });

    expect(updated.exports.find((entry) => entry.type === "wav")).toMatchObject({
      status: "exported",
      uri: "asset://mix/mix_asset_1",
    });
  });
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run:

```powershell
npm.cmd run test --prefix apps/web -- project-mix-state
```

Expected: FAIL because `project-mix-state.ts` does not exist.

- [ ] **Step 3: Implement project-mix state helpers**

Create `apps/web/src/lib/asmr/project-mix-state.ts`:

```ts
import type {
  GeneratedAssetResult,
  GenerateProjectMixReason,
} from "./generation-bridge";
import { isStableAssetUri } from "./generation-asset-uri";
import type { AsmrProject } from "./schema";
import { flattenClips } from "./view-model";

type ProjectMixFailureInput = {
  reason: GenerateProjectMixReason;
  error: string;
};

type ProjectMixAsset = {
  assetId: string;
  uri: string;
  duration: number;
};

function hasGeneratedClipAsset(clip: ReturnType<typeof flattenClips>[number]) {
  return (
    clip.generation.status === "asset_generated" &&
    Boolean(clip.asset.asset_id) &&
    isStableAssetUri(clip.asset.uri) &&
    typeof clip.asset.duration === "number" &&
    clip.asset.duration > 0
  );
}

function updateWavExport(
  project: AsmrProject,
  update: (entry: AsmrProject["exports"][number]) => AsmrProject["exports"][number],
): AsmrProject {
  let didUpdate = false;
  const exports = project.exports.map((entry) => {
    if (entry.type !== "wav") {
      return entry;
    }

    didUpdate = true;
    return update(entry);
  });

  if (didUpdate) {
    return { ...project, exports };
  }

  return {
    ...project,
    exports: [
      ...project.exports,
      update({
        type: "wav",
        status: "not_started",
        uri: null,
      }),
    ],
  };
}

export function getMissingProjectMixClipIds(project: AsmrProject): string[] {
  return flattenClips(project)
    .filter((clip) => !hasGeneratedClipAsset(clip))
    .map((clip) => clip.id);
}

export function isProjectMixReady(project: AsmrProject): boolean {
  return getMissingProjectMixClipIds(project).length === 0;
}

export function getProjectMixAsset(
  project: AsmrProject,
): ProjectMixAsset | undefined {
  const wavExport = project.exports.find((entry) => entry.type === "wav");

  if (
    !wavExport ||
    wavExport.status !== "exported" ||
    !isStableAssetUri(wavExport.uri)
  ) {
    return undefined;
  }

  return {
    assetId: wavExport.uri.split("/").at(-1) ?? wavExport.uri,
    uri: wavExport.uri,
    duration: project.duration,
  };
}

export function commitProjectMixSuccess(
  project: AsmrProject,
  asset: GeneratedAssetResult,
): AsmrProject {
  return updateWavExport(project, (entry) => ({
    ...entry,
    status: "exported",
    uri: asset.uri,
  }));
}

export function commitProjectMixFailure(
  project: AsmrProject,
  { reason }: ProjectMixFailureInput,
): AsmrProject {
  const existing = getProjectMixAsset(project);

  if (reason === "remix" && existing) {
    return project;
  }

  return updateWavExport(project, (entry) => ({
    ...entry,
    status: "export_failed",
    uri: null,
  }));
}
```

- [ ] **Step 4: Run focused project-mix tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- project-mix-state
```

Expected: PASS.

- [ ] **Step 5: Extend clip generation tests for stable `asset://clip` URIs**

Modify `apps/web/src/lib/asmr/generation-project-state.test.ts` by adding this case near the existing success commit test:

```ts
it("accepts stable asset:// clip URIs as durable generated assets", () => {
  const project = cloneProject();
  const updated = commitGenerationSuccess(project, "voice_001", {
    assetId: "clip_asset_1",
    uri: "asset://clip/clip_asset_1",
    duration: 7.5,
    kind: "clip",
    format: "wav",
    mimeType: "audio/wav",
  });
  const updatedClip = findClip(updated, "voice_001");

  expect(updatedClip.asset).toEqual({
    asset_id: "clip_asset_1",
    uri: "asset://clip/clip_asset_1",
    duration: 7.5,
  });
});
```

- [ ] **Step 6: Run durable state tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-project-state project-mix-state
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/lib/asmr/project-mix-state.ts apps/web/src/lib/asmr/project-mix-state.test.ts apps/web/src/lib/asmr/generation-project-state.test.ts
git commit -m "feat: add durable project mix state"
```

---

### Task 3: Runtime State For Clip And Project Mix Jobs

**Files:**
- Modify: `apps/web/src/lib/asmr/generation-runtime.ts`
- Modify: `apps/web/src/lib/asmr/generation-runtime.test.ts`

- [ ] **Step 1: Add failing runtime tests for project mix jobs**

Modify `apps/web/src/lib/asmr/generation-runtime.test.ts` and add:

```ts
import type { GenerationJobSnapshot } from "./generation-bridge";
```

Add these helpers and tests:

```ts
function makeProjectMixJob(
  jobId: string,
  status: GenerationJobSnapshot["status"] = "generating",
): GenerationJobSnapshot {
  return {
    jobId,
    jobType: "project_mix",
    target: { type: "project_mix", exportType: "wav" },
    status,
    progress: status === "succeeded" ? 100 : 40,
    message: "Mixing",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

it("tracks project mix jobs by export type", () => {
  const state = upsertGenerationJob(
    emptyGenerationRuntimeState,
    makeProjectMixJob("mix_job_1"),
  );

  expect(getGenerationJobForProjectMix(state, "wav")).toMatchObject({
    jobId: "mix_job_1",
    jobType: "project_mix",
  });
});

it("replaces the previous project mix job for the same export type", () => {
  const first = upsertGenerationJob(
    emptyGenerationRuntimeState,
    makeProjectMixJob("mix_job_1"),
  );
  const second = upsertGenerationJob(first, makeProjectMixJob("mix_job_2"));

  expect(second.jobsById.mix_job_1).toBeUndefined();
  expect(getGenerationJobForProjectMix(second, "wav")?.jobId).toBe("mix_job_2");
});

it("clears project mix mappings when a mix job is cleared", () => {
  const state = upsertGenerationJob(
    emptyGenerationRuntimeState,
    makeProjectMixJob("mix_job_1"),
  );
  const cleared = clearGenerationJob(state, "mix_job_1");

  expect(getGenerationJobForProjectMix(cleared, "wav")).toBeUndefined();
});
```

- [ ] **Step 2: Run focused runtime tests to verify they fail**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-runtime
```

Expected: FAIL because project mix runtime helpers do not exist.

- [ ] **Step 3: Update runtime state shape and helpers**

Modify `apps/web/src/lib/asmr/generation-runtime.ts`:

```ts
import type {
  GenerationJobSnapshot,
  ProjectMixExportType,
} from "./generation-bridge";

export type GenerationRuntimeState = {
  jobsById: Record<string, GenerationJobSnapshot>;
  jobIdByClipId: Record<string, string>;
  jobIdByProjectMixExportType: Partial<Record<ProjectMixExportType, string>>;
};

export const emptyGenerationRuntimeState: GenerationRuntimeState = {
  jobsById: {},
  jobIdByClipId: {},
  jobIdByProjectMixExportType: {},
};

export function isActiveGenerationJob(job: GenerationJobSnapshot): boolean {
  return (
    job.status === "queued" ||
    job.status === "generating" ||
    job.status === "canceling"
  );
}

export function getGenerationJobForClip(
  state: GenerationRuntimeState,
  clipId: string,
): GenerationJobSnapshot | undefined {
  const jobId = state.jobIdByClipId[clipId];

  return jobId ? state.jobsById[jobId] : undefined;
}

export function getGenerationJobForProjectMix(
  state: GenerationRuntimeState,
  exportType: ProjectMixExportType,
): GenerationJobSnapshot | undefined {
  const jobId = state.jobIdByProjectMixExportType[exportType];

  return jobId ? state.jobsById[jobId] : undefined;
}

export function upsertGenerationJob(
  state: GenerationRuntimeState,
  job: GenerationJobSnapshot,
): GenerationRuntimeState {
  const jobsById = { ...state.jobsById };
  const jobIdByClipId = { ...state.jobIdByClipId };
  const jobIdByProjectMixExportType = {
    ...state.jobIdByProjectMixExportType,
  };

  if (job.target.type === "clip") {
    const previousJobId = jobIdByClipId[job.target.clipId];

    if (previousJobId && previousJobId !== job.jobId) {
      delete jobsById[previousJobId];
    }

    jobIdByClipId[job.target.clipId] = job.jobId;
  } else {
    const previousJobId = jobIdByProjectMixExportType[job.target.exportType];

    if (previousJobId && previousJobId !== job.jobId) {
      delete jobsById[previousJobId];
    }

    jobIdByProjectMixExportType[job.target.exportType] = job.jobId;
  }

  for (const [clipId, mappedJobId] of Object.entries(jobIdByClipId)) {
    if (job.target.type !== "clip" && mappedJobId === job.jobId) {
      delete jobIdByClipId[clipId];
    }
  }

  for (const [exportType, mappedJobId] of Object.entries(
    jobIdByProjectMixExportType,
  )) {
    if (job.target.type !== "project_mix" && mappedJobId === job.jobId) {
      delete jobIdByProjectMixExportType[exportType as ProjectMixExportType];
    }
  }

  jobsById[job.jobId] = job;

  return {
    jobsById,
    jobIdByClipId,
    jobIdByProjectMixExportType,
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
  const jobIdByProjectMixExportType = {
    ...state.jobIdByProjectMixExportType,
  };

  delete jobsById[jobId];

  if (job.target.type === "clip") {
    delete jobIdByClipId[job.target.clipId];
  } else {
    delete jobIdByProjectMixExportType[job.target.exportType];
  }

  return {
    jobsById,
    jobIdByClipId,
    jobIdByProjectMixExportType,
  };
}

export function markGenerationJobCanceling(
  state: GenerationRuntimeState,
  jobId: string,
): GenerationRuntimeState {
  const job = state.jobsById[jobId];

  if (!job || !isActiveGenerationJob(job) || job.status === "canceling") {
    return state;
  }

  return {
    jobsById: {
      ...state.jobsById,
      [jobId]: {
        ...job,
        status: "canceling",
        message: "正在取消",
      },
    },
    jobIdByClipId: state.jobIdByClipId,
    jobIdByProjectMixExportType: state.jobIdByProjectMixExportType,
  };
}
```

- [ ] **Step 4: Update existing clip runtime tests**

Existing clip test snapshots must include:

```ts
jobType: "clip_generation",
clipId: "voice_001",
target: { type: "clip", clipId: "voice_001" },
```

Do not remove existing clip tests. The goal is to prove the new runtime store still supports selected clip generation.

- [ ] **Step 5: Run runtime tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-runtime
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-runtime.ts apps/web/src/lib/asmr/generation-runtime.test.ts
git commit -m "feat: track project mix generation jobs"
```

---

### Task 4: API-Shaped Mock Bridge And Asset Resolution

**Files:**
- Modify: `apps/web/src/lib/asmr/mock-generation-bridge.ts`
- Modify: `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`
- Modify: `apps/web/src/lib/asmr/mock-asset-resolver.ts`
- Modify: `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`

- [ ] **Step 1: Add failing mock bridge tests for stable assets and project mix**

Modify `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`:

```ts
it("returns stable asset:// clip URIs for generated clips", async () => {
  const bridge = createMockGenerationBridge({
    jobIdPrefix: "test_job",
    stepMs: 100,
  });
  const updates: GenerationJobUpdate[] = [];

  await bridge.generateClip(
    {
      project: demoProject,
      clipId: "voice_001",
      reason: "generate",
      inputFingerprint: "clip:fingerprint",
    },
    (update) => updates.push(update),
  );

  await vi.advanceTimersByTimeAsync(400);

  expect(updates.at(-1)).toMatchObject({
    type: "succeeded",
    asset: {
      assetId: "clip_voice_001_test_job_1",
      uri: "asset://clip/clip_voice_001_test_job_1",
      kind: "clip",
      format: "wav",
      mimeType: "audio/wav",
    },
    job: {
      jobType: "clip_generation",
      target: { type: "clip", clipId: "voice_001" },
      inputFingerprint: "clip:fingerprint",
    },
  });
});

it("generates a project mix asset from generated clip assets", async () => {
  const bridge = createMockGenerationBridge({
    jobIdPrefix: "test_job",
    stepMs: 100,
  });
  const project = structuredClone(demoProject);

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      clip.generation.status = "asset_generated";
      clip.asset = {
        asset_id: `${clip.id}_asset`,
        uri: `asset://clip/${clip.id}_asset`,
        duration: clip.duration,
      };
    }
  }

  const updates: GenerationJobUpdate[] = [];

  await bridge.generateProjectMix(
    {
      project,
      exportType: "wav",
      reason: "mix",
      mixPolicy: "require_all_assets",
      inputFingerprint: "mix:fingerprint",
    },
    (update) => updates.push(update),
  );

  await vi.advanceTimersByTimeAsync(400);

  expect(updates.at(-1)).toMatchObject({
    type: "succeeded",
    asset: {
      assetId: "mix_asmr_demo_001_test_job_1",
      uri: "asset://mix/mix_asmr_demo_001_test_job_1",
      kind: "project_mix",
      duration: project.duration,
      format: "wav",
      mimeType: "audio/wav",
    },
    job: {
      jobType: "project_mix",
      target: { type: "project_mix", exportType: "wav" },
      inputFingerprint: "mix:fingerprint",
    },
  });
});

it("fails project mix when required clip assets are missing", async () => {
  const bridge = createMockGenerationBridge({
    jobIdPrefix: "test_job",
    stepMs: 100,
  });
  const updates: GenerationJobUpdate[] = [];

  await bridge.generateProjectMix(
    {
      project: demoProject,
      exportType: "wav",
      reason: "mix",
      mixPolicy: "require_all_assets",
    },
    (update) => updates.push(update),
  );

  await vi.advanceTimersByTimeAsync(400);

  expect(updates.at(-1)).toMatchObject({
    type: "failed",
    error: "Missing required assets",
    job: {
      jobType: "project_mix",
      status: "failed",
    },
  });
});

it("resolves stable asset playback and download URLs", async () => {
  const bridge = createMockGenerationBridge();

  await expect(
    bridge.resolvePlaybackUrl("asset://mix/mix_asset_1"),
  ).resolves.toMatch(/^data:audio\/wav;base64,/);
  await expect(
    bridge.resolveDownloadUrl("asset://mix/mix_asset_1"),
  ).resolves.toMatchObject({
    filename: "mix_asset_1.wav",
  });
});
```

- [ ] **Step 2: Add failing asset resolver tests**

Modify `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`:

```ts
it("resolves stable asset URIs to runtime-only WAV data URLs", () => {
  expect(resolveMockAssetUri("asset://clip/clip_asset_1")).toMatch(
    /^data:audio\/wav;base64,/,
  );
  expect(resolveMockAssetUri("asset://mix/mix_asset_1")).toMatch(
    /^data:audio\/wav;base64,/,
  );
});

it("keeps stable asset URI detection separate from runtime resolution", () => {
  const uri = "asset://mix/mix_asset_1";
  const resolved = resolveMockAssetUri(uri);

  expect(uri).toBe("asset://mix/mix_asset_1");
  expect(resolved).not.toBe(uri);
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-generation-bridge mock-asset-resolver
```

Expected: FAIL because project-mix bridge behavior and stable asset resolution are not implemented.

- [ ] **Step 4: Update mock asset resolver**

Modify `apps/web/src/lib/asmr/mock-asset-resolver.ts`:

```ts
import { isStableAssetUri } from "./generation-asset-uri";

const mockAssetPattern = /^mock:\/\/asset\/[^/]+\/[^/]+$/;
const cachedDataUrls = new Map<string, string>();

export function isMockAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri && (mockAssetPattern.test(uri) || isStableAssetUri(uri)));
}
```

Keep the existing WAV generation code. In `resolveMockAssetUri`, use the existing `isMockAssetUri` check so both `mock://` and `asset://` resolve to runtime-only data URLs.

- [ ] **Step 5: Update mock bridge implementation**

Modify `apps/web/src/lib/asmr/mock-generation-bridge.ts`:

- Add imports:

```ts
import { buildAssetUri } from "./generation-asset-uri";
import { resolveMockAssetUri } from "./mock-asset-resolver";
import { getMissingProjectMixClipIds } from "./project-mix-state";
```

- Update `makeSnapshot` signature so it accepts target/job type:

```ts
function makeSnapshot(
  request:
    | GenerateClipRequest
    | GenerateProjectMixRequest,
  jobId: string,
  createdAt: string,
  updatedAt: string,
  progress: number,
  status: GenerationJobSnapshot["status"],
  message: string,
): GenerationJobSnapshot {
  const target =
    "clipId" in request
      ? ({ type: "clip", clipId: request.clipId } as const)
      : ({ type: "project_mix", exportType: request.exportType } as const);

  return {
    jobId,
    clipId: target.type === "clip" ? target.clipId : undefined,
    target,
    jobType: target.type === "clip" ? "clip_generation" : "project_mix",
    status,
    progress,
    message,
    inputFingerprint: request.inputFingerprint,
    createdAt,
    updatedAt,
  };
}
```

- Add `generateProjectMix` to the returned bridge:

```ts
async generateProjectMix(request, onUpdate) {
  const jobId = `${jobIdPrefix}_${nextJobNumber}`;
  nextJobNumber += 1;
  const createdAt = now();

  onUpdate({
    type: "snapshot",
    job: makeSnapshot(
      request,
      jobId,
      createdAt,
      createdAt,
      0,
      "queued",
      "等待混音",
    ),
  });

  const inFlightJob: InFlightJob = {
    request,
    onUpdate,
    createdAt,
    timers: [],
  };

  inFlightJobs.set(jobId, inFlightJob);

  defaultProgressSteps.forEach((progress, index) => {
    const timer = setTimeout(() => {
      if (!inFlightJobs.has(jobId)) {
        return;
      }

      if (progress < 100) {
        onUpdate({
          type: "snapshot",
          job: makeSnapshot(
            request,
            jobId,
            createdAt,
            now(),
            progress,
            "generating",
            "混音中",
          ),
        });
        return;
      }

      const missingClipIds = getMissingProjectMixClipIds(request.project);

      if (
        request.mixPolicy === "require_all_assets" &&
        missingClipIds.length > 0
      ) {
        onUpdate({
          type: "failed",
          job: makeSnapshot(
            request,
            jobId,
            createdAt,
            now(),
            100,
            "failed",
            "缺少片段",
          ),
          error: "Missing required assets",
        });
        inFlightJobs.delete(jobId);
        return;
      }

      const assetId = `mix_${request.project.project_id}_${jobId}`;
      onUpdate({
        type: "succeeded",
        job: makeSnapshot(
          request,
          jobId,
          createdAt,
          now(),
          100,
          "succeeded",
          "混音完成",
        ),
        asset: {
          assetId,
          uri: buildAssetUri("project_mix", assetId),
          duration: request.project.duration,
          kind: "project_mix",
          format: "wav",
          mimeType: "audio/wav",
          sampleRate: 48000,
          channels: 2,
          sourceJobId: jobId,
        },
      });
      inFlightJobs.delete(jobId);
    }, stepMs * (index + 1));

    inFlightJob.timers.push(timer);
  });

  return { jobId };
}
```

- Update clip success asset result to:

```ts
const assetId = `clip_${request.clipId}_${jobId}`;

asset: {
  assetId,
  uri: buildAssetUri("clip", assetId),
  duration: clip.duration,
  kind: "clip",
  format: "wav",
  mimeType: "audio/wav",
  sampleRate: 48000,
  channels: 2,
  sourceJobId: jobId,
}
```

- Add resolver methods:

```ts
async resolvePlaybackUrl(assetUri) {
  return resolveMockAssetUri(assetUri);
},

async resolveDownloadUrl(assetUri) {
  const resolved = resolveMockAssetUri(assetUri);
  const assetId = assetUri.split("/").at(-1) ?? "asmr-audio";

  return resolved
    ? {
        url: resolved,
        filename: `${assetId}.wav`,
      }
    : undefined;
},
```

- [ ] **Step 6: Run focused mock bridge and resolver tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- mock-generation-bridge mock-asset-resolver
```

Expected: PASS.

- [ ] **Step 7: Run generation suite**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation
```

Expected: PASS after updating snapshot expectations for `target` and `jobType`.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/lib/asmr/mock-generation-bridge.ts apps/web/src/lib/asmr/mock-generation-bridge.test.ts apps/web/src/lib/asmr/mock-asset-resolver.ts apps/web/src/lib/asmr/mock-asset-resolver.test.ts
git commit -m "feat: add api-shaped mock generation bridge"
```

---

### Task 5: Project Mix View State And Preview Layer Controls

**Files:**
- Modify: `apps/web/src/lib/asmr/generation-view.ts`
- Modify: `apps/web/src/lib/asmr/generation-view.test.ts`
- Modify: `apps/web/src/components/studio/preview-layer-panel.tsx`
- Modify: `apps/web/src/components/studio/project-details-dock.tsx`
- Modify: `apps/web/src/components/studio/project-workspace.tsx`

- [ ] **Step 1: Add failing generation view tests**

Modify `apps/web/src/lib/asmr/generation-view.test.ts` and add:

```ts
import { commitProjectMixSuccess } from "./project-mix-state";
```

Add tests:

```ts
it("disables project mix when required clip assets are missing", () => {
  const view = getGenerationView({
    project: demoProject,
    selectedClip: undefined,
    runtimeState: emptyGenerationRuntimeState,
    selectedClipHasValidationIssues: false,
  });

  expect(view.projectMixControl).toMatchObject({
    action: "none",
    label: "生成整段",
    disabled: true,
    disabledReason: "先生成缺失片段",
  });
});

it("enables project mix when all required clips are generated", () => {
  const project = withAllGeneratedClips(structuredClone(demoProject));
  const view = getGenerationView({
    project,
    selectedClip: undefined,
    runtimeState: emptyGenerationRuntimeState,
    selectedClipHasValidationIssues: false,
  });

  expect(view.projectMixControl).toMatchObject({
    action: "mix",
    label: "生成整段",
    disabled: false,
  });
});

it("shows full project playback and download when a mix asset exists", () => {
  const project = commitProjectMixSuccess(
    withAllGeneratedClips(structuredClone(demoProject)),
    {
      assetId: "mix_asset_1",
      uri: "asset://mix/mix_asset_1",
      duration: demoProject.duration,
      kind: "project_mix",
      format: "wav",
      mimeType: "audio/wav",
    },
  );
  const view = getGenerationView({
    project,
    selectedClip: undefined,
    runtimeState: emptyGenerationRuntimeState,
    selectedClipHasValidationIssues: false,
  });

  expect(view.projectMixControl).toMatchObject({
    action: "remix",
    label: "重新混音",
    disabled: false,
  });
  expect(view.projectMixPreview).toEqual({
    canPlay: true,
    canDownload: true,
    label: "播放整段",
    uri: "asset://mix/mix_asset_1",
  });
});
```

Use the `withAllGeneratedClips` helper from Task 2 or duplicate it inside this test file:

```ts
function withAllGeneratedClips(project: AsmrProject): AsmrProject {
  return ["voice_001", "breath_001", "sfx_blanket_001", "ambience_rain_001"].reduce(
    (current, clipId) =>
      commitGenerationSuccess(current, clipId, {
        assetId: `${clipId}_asset`,
        uri: `asset://clip/${clipId}_asset`,
        duration: 1,
        kind: "clip",
        format: "wav",
        mimeType: "audio/wav",
      }),
    project,
  );
}
```

- [ ] **Step 2: Run focused generation-view tests to verify they fail**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-view
```

Expected: FAIL because `projectMixControl` and `projectMixPreview` are not returned.

- [ ] **Step 3: Add project mix view types and derivation**

Modify `apps/web/src/lib/asmr/generation-view.ts`:

```ts
import {
  getMissingProjectMixClipIds,
  getProjectMixAsset,
  isProjectMixReady,
} from "./project-mix-state";
import { getGenerationJobForProjectMix } from "./generation-runtime";
```

Add types:

```ts
export type ProjectMixGenerationAction = "mix" | "remix" | "retry" | "cancel" | "none";

export type ProjectMixGenerationControl = {
  action: ProjectMixGenerationAction;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  statusLabel: string;
  tone: GenerationSlotTone;
  progress?: number;
  error?: string;
  jobId?: string;
  missingClipIds: string[];
};

export type ProjectMixPreview = {
  canPlay: boolean;
  canDownload: boolean;
  label: string;
  uri?: string;
};
```

Extend `GenerationView`:

```ts
export type GenerationView = {
  displayProject: AsmrProject;
  displaySelectedClip?: TimelineClip;
  preview: ProjectPreviewSummary;
  selectedClipControl: SelectedClipGenerationControl;
  selectedClipPreview: SelectedClipPreview;
  projectMixControl: ProjectMixGenerationControl;
  projectMixPreview: ProjectMixPreview;
};
```

Add helpers:

```ts
function getProjectMixControl({
  project,
  runtimeState,
}: {
  project: AsmrProject;
  runtimeState: GenerationRuntimeState;
}): ProjectMixGenerationControl {
  const job = getGenerationJobForProjectMix(runtimeState, "wav");
  const missingClipIds = getMissingProjectMixClipIds(project);
  const mixAsset = getProjectMixAsset(project);

  if (job && isActiveGenerationJob(job)) {
    const isCanceling = job.status === "canceling";

    return {
      action: "cancel",
      label: "取消",
      disabled: isCanceling,
      disabledReason: isCanceling ? "正在取消" : undefined,
      statusLabel: isCanceling ? "取消中" : "混音中",
      tone: "accent",
      progress: job.progress,
      jobId: job.jobId,
      missingClipIds,
    };
  }

  if (!isProjectMixReady(project)) {
    return {
      action: "none",
      label: "生成整段",
      disabled: true,
      disabledReason: "先生成缺失片段",
      statusLabel: "未就绪",
      tone: "neutral",
      missingClipIds,
    };
  }

  if (mixAsset) {
    return {
      action: "remix",
      label: "重新混音",
      disabled: false,
      statusLabel: "可试听",
      tone: "ok",
      missingClipIds,
    };
  }

  return {
    action: "mix",
    label: "生成整段",
    disabled: false,
    statusLabel: "可混音",
    tone: "neutral",
    missingClipIds,
  };
}

function getProjectMixPreview(project: AsmrProject): ProjectMixPreview {
  const mixAsset = getProjectMixAsset(project);

  if (!mixAsset) {
    return {
      canPlay: false,
      canDownload: false,
      label: "暂无整段音频",
    };
  }

  return {
    canPlay: true,
    canDownload: true,
    label: "播放整段",
    uri: mixAsset.uri,
  };
}
```

Return these from `getGenerationView`:

```ts
projectMixControl: getProjectMixControl({
  project,
  runtimeState,
}),
projectMixPreview: getProjectMixPreview(project),
```

- [ ] **Step 4: Run generation-view tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-view
```

Expected: PASS.

- [ ] **Step 5: Add Preview Layer props and controls**

Modify `apps/web/src/components/studio/preview-layer-panel.tsx`.

Update imports:

```ts
import { Download, LoaderCircle, Play, RadioTower, RefreshCcw, Sparkles, X } from "lucide-react";
import type {
  ProjectMixGenerationControl,
  ProjectMixPreview,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
```

Update props:

```ts
type PreviewLayerPanelProps = {
  preview: ProjectPreviewSummary;
  selectedClipPreview: SelectedClipPreview;
  projectMixControl: ProjectMixGenerationControl;
  projectMixPreview: ProjectMixPreview;
  onCancelProjectMix: () => void;
  onDownloadProjectMix: () => void;
  onGenerateProjectMix: () => void;
  onPlayProjectMix: () => void;
  onPlaySelectedClip: () => void;
};
```

Add a small action strip under the waveform:

```tsx
<div className="mt-3 grid grid-cols-3 gap-2">
  <button
    type="button"
    disabled={projectMixControl.disabled}
    onClick={
      projectMixControl.action === "cancel"
        ? onCancelProjectMix
        : onGenerateProjectMix
    }
    className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-sky-300/24 bg-sky-300/12 px-2 text-xs font-semibold text-sky-50 transition hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.035] disabled:text-studio-muted"
    title={projectMixControl.disabledReason ?? projectMixControl.statusLabel}
  >
    {projectMixControl.action === "cancel" ? (
      <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    ) : projectMixControl.action === "remix" ? (
      <RefreshCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    ) : (
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    )}
    <span className="truncate">{projectMixControl.label}</span>
  </button>

  <button
    type="button"
    disabled={!projectMixPreview.canPlay}
    onClick={onPlayProjectMix}
    className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-muted transition hover:border-sky-300/30 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-55"
    title={projectMixPreview.label}
  >
    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span className="truncate">整段</span>
  </button>

  <button
    type="button"
    disabled={!projectMixPreview.canDownload}
    onClick={onDownloadProjectMix}
    className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-studio-line bg-white/[0.035] px-2 text-xs font-semibold text-studio-muted transition hover:border-sky-300/30 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-55"
    title="下载 WAV"
  >
    <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span className="truncate">WAV</span>
  </button>
</div>
```

If `projectMixControl.progress !== undefined`, render a progress bar below the action strip:

```tsx
{projectMixControl.progress !== undefined ? (
  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
    <div
      className="h-full rounded-full bg-sky-300/80 transition-[width]"
      style={{
        width: `${Math.max(0, Math.min(100, projectMixControl.progress))}%`,
      }}
    />
  </div>
) : null}
```

- [ ] **Step 6: Pass props through workspace shell**

Modify `project-details-dock.tsx` and `project-workspace.tsx` to add and forward:

```ts
projectMixControl: ProjectMixGenerationControl;
projectMixPreview: ProjectMixPreview;
onCancelProjectMix: () => void;
onDownloadProjectMix: () => void;
onGenerateProjectMix: () => void;
onPlayProjectMix: () => void;
```

Use the same import source:

```ts
import type {
  ProjectMixGenerationControl,
  ProjectMixPreview,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
```

- [ ] **Step 7: Run tests and lint for view/UI types**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-view
npm.cmd run lint --prefix apps/web
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/lib/asmr/generation-view.ts apps/web/src/lib/asmr/generation-view.test.ts apps/web/src/components/studio/preview-layer-panel.tsx apps/web/src/components/studio/project-details-dock.tsx apps/web/src/components/studio/project-workspace.tsx
git commit -m "feat: show project mix controls"
```

---

### Task 6: Wire Project Mix Into StudioApp

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Modify: `apps/web/src/lib/asmr/project-persistence.test.ts`

- [ ] **Step 1: Add persistence tests for stable mix assets**

Modify `apps/web/src/lib/asmr/project-persistence.test.ts`:

```ts
it("serializes stable asset URIs without runtime playback URLs", () => {
  const project = structuredClone(demoProject);
  project.exports = project.exports.map((entry) =>
    entry.type === "wav"
      ? {
          ...entry,
          status: "exported",
          uri: "asset://mix/mix_asset_1",
        }
      : entry,
  );
  project.timeline.tracks[0].clips[0].asset = {
    asset_id: "clip_asset_1",
    uri: "asset://clip/clip_asset_1",
    duration: 7.5,
  };

  const serialized = serializeProject(project);

  expect(serialized).toContain("asset://mix/mix_asset_1");
  expect(serialized).toContain("asset://clip/clip_asset_1");
  expect(serialized).not.toContain("data:audio");
  expect(serialized).not.toContain("blob:");
  expect(serialized).not.toContain("progress");
  expect(serialized).not.toContain("canceling");
});
```

- [ ] **Step 2: Run persistence test**

Run:

```powershell
npm.cmd run test --prefix apps/web -- project-persistence
```

Expected: PASS or fail only from import ordering; fix locally if needed.

- [ ] **Step 3: Import project-mix helpers in StudioApp**

Modify `apps/web/src/components/studio/studio-app.tsx` imports:

```ts
import {
  getClipGenerationFingerprint,
  getProjectMixFingerprint,
} from "@/lib/asmr/generation-fingerprint";
import {
  commitProjectMixFailure,
  commitProjectMixSuccess,
} from "@/lib/asmr/project-mix-state";
```

Remove any local `getClipGenerationFingerprint` helper if one exists in `studio-app.tsx`, and use the shared helper instead.

- [ ] **Step 4: Extend generation reasons refs for project mix**

Change:

```ts
const generationReasonsRef = useRef<Record<string, GenerateClipReason>>({});
```

to:

```ts
const generationReasonsRef = useRef<
  Record<string, GenerateClipReason | GenerateProjectMixReason>
>({});
```

Add `GenerateProjectMixReason` import from `generation-bridge.ts`.

- [ ] **Step 5: Commit project-mix success and failure in generation callback**

In `handleGenerationUpdate`, update the `succeeded` branch:

```ts
if (update.type === "succeeded") {
  const fingerprint = generationFingerprintsRef.current[update.job.jobId];

  if (update.job.target.type === "project_mix") {
    setEditableProject((currentProject) =>
      fingerprint &&
      getProjectMixFingerprint(currentProject, update.job.target.exportType) ===
        fingerprint
        ? commitProjectMixSuccess(currentProject, update.asset)
        : currentProject,
    );
  } else {
    setEditableProject((currentProject) =>
      fingerprint &&
      getClipGenerationFingerprint(currentProject, update.job.target.clipId) ===
        fingerprint
        ? commitGenerationSuccess(
            currentProject,
            update.job.target.clipId,
            update.asset,
          )
        : currentProject,
    );
  }

  setGenerationRuntimeState((current) => {
    const next = clearGenerationJob(current, update.job.jobId);
    generationRuntimeStateRef.current = next;
    return next;
  });
  delete generationReasonsRef.current[update.job.jobId];
  delete generationFingerprintsRef.current[update.job.jobId];
  return;
}
```

Update the `failed` branch:

```ts
if (update.type === "failed") {
  const reason = generationReasonsRef.current[update.job.jobId] ?? "generate";

  if (update.job.target.type === "project_mix") {
    setEditableProject((currentProject) =>
      commitProjectMixFailure(currentProject, {
        reason:
          reason === "retry" || reason === "remix" || reason === "mix"
            ? reason
            : "mix",
        error: update.error,
      }),
    );
  } else {
    setEditableProject((currentProject) =>
      commitGenerationFailure(currentProject, update.job.target.clipId, {
        reason:
          reason === "regenerate" || reason === "retry" ? reason : "generate",
        error: update.error,
      }),
    );
  }

  setGenerationRuntimeState((current) => {
    const next = clearGenerationJob(current, update.job.jobId);
    generationRuntimeStateRef.current = next;
    return next;
  });
  delete generationReasonsRef.current[update.job.jobId];
  delete generationFingerprintsRef.current[update.job.jobId];
  return;
}
```

- [ ] **Step 6: Add project mix handlers**

Add these functions near the selected clip generation handlers:

```ts
function handleGenerateProjectMix() {
  if (generationView.projectMixControl.disabled) {
    return;
  }

  const action = generationView.projectMixControl.action;
  const reason: GenerateProjectMixReason =
    action === "remix" ? "remix" : action === "retry" ? "retry" : "mix";
  const generationSession = generationSessionRef.current;
  const fingerprint = getProjectMixFingerprint(editableProject, "wav");

  void getGenerationBridge()
    .generateProjectMix(
      {
        project: editableProject,
        exportType: "wav",
        reason,
        mixPolicy: "require_all_assets",
        inputFingerprint: fingerprint,
      },
      (update) => {
        if (generationSession !== generationSessionRef.current) {
          return;
        }

        generationReasonsRef.current[update.job.jobId] = reason;
        generationFingerprintsRef.current[update.job.jobId] = fingerprint;
        handleGenerationUpdate(update, generationSession);
      },
    )
    .then((started) => {
      if (generationSession !== generationSessionRef.current) {
        return;
      }

      generationReasonsRef.current[started.jobId] = reason;
      generationFingerprintsRef.current[started.jobId] = fingerprint;
    })
    .catch(() => undefined);
}

function handleCancelProjectMix() {
  const jobId = generationView.projectMixControl.jobId;

  if (!jobId) {
    return;
  }

  setGenerationRuntimeState((current) => {
    const next = markGenerationJobCanceling(current, jobId);
    generationRuntimeStateRef.current = next;
    return next;
  });
  void bridgeRef.current?.cancelGeneration(jobId);
}

function handlePlayProjectMix() {
  const uri = generationView.projectMixPreview.uri;

  if (!uri || !generationView.projectMixPreview.canPlay) {
    return;
  }

  void getGenerationBridge()
    .resolvePlaybackUrl(uri)
    .then((resolvedUri) => {
      if (!resolvedUri) {
        return;
      }

      audioRef.current?.pause();
      audioRef.current = new Audio(resolvedUri);
      void audioRef.current.play();
    });
}

function handleDownloadProjectMix() {
  const uri = generationView.projectMixPreview.uri;

  if (!uri || !generationView.projectMixPreview.canDownload) {
    return;
  }

  void getGenerationBridge()
    .resolveDownloadUrl(uri)
    .then((download) => {
      if (!download) {
        return;
      }

      const link = document.createElement("a");
      link.href = download.url;
      link.download = download.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
}
```

- [ ] **Step 7: Pass project mix handlers into ProjectWorkspace**

In the `ProjectWorkspace` call inside `studio-app.tsx`, add:

```tsx
projectMixControl={generationView.projectMixControl}
projectMixPreview={generationView.projectMixPreview}
onCancelProjectMix={handleCancelProjectMix}
onDownloadProjectMix={handleDownloadProjectMix}
onGenerateProjectMix={handleGenerateProjectMix}
onPlayProjectMix={handlePlayProjectMix}
```

- [ ] **Step 8: Ensure reset/import/edit clear or preserve runtime correctly**

For reset/import handlers that replace the current project, call existing `clearGenerationSession()` before or immediately after replacing project state.

For clip edits, keep the existing behavior that cancels generation for the edited clip. Do not cancel project-mix runtime state for every minor edit unless the current project mix job fingerprint becomes stale; stale success is ignored by fingerprint checks.

- [ ] **Step 9: Run focused tests and lint**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation project-persistence
npm.cmd run lint --prefix apps/web
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add apps/web/src/components/studio/studio-app.tsx apps/web/src/lib/asmr/project-persistence.test.ts
git commit -m "feat: wire project mix generation"
```

---

### Task 7: Full Verification And Documentation

**Files:**
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`
- Modify implementation files only if verification reveals defects.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected:

- Vitest passes.
- ESLint passes.
- Webpack build passes.
- Local SWC optional binding warnings may appear, but the webpack build must exit 0.

- [ ] **Step 2: Start local app server**

Run:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

Expected: app is reachable at:

```text
http://localhost:3000/
```

- [ ] **Step 3: Browser-verify clip generation still works**

At a desktop viewport:

- Select a pending clip.
- Click `生成`.
- Confirm progress and `取消` appear.
- Confirm success changes the clip to generated.
- Confirm selected clip preview playback works.
- Confirm local saved project contains `asset://clip/`.
- Confirm local saved project does not contain `data:audio`, `blob:`, `progress`, `canceling`, or runtime job messages.

- [ ] **Step 4: Browser-verify project mix behavior**

In the app:

- Confirm project mix starts disabled with `先生成缺失片段` while required clips are missing.
- Generate all required demo clips or use a temporary browser script only during verification to mark them generated; remove any temporary code before committing.
- Confirm `生成整段` becomes enabled.
- Click `生成整段`.
- Confirm Preview Layer shows project mix progress.
- Confirm success enables full-project playback.
- Confirm WAV download triggers from the same mix asset.
- Confirm exported/saved project contains `asset://mix/`.
- Confirm exported/saved project still excludes signed URLs, `data:audio`, `blob:`, progress, queue state, and runtime messages.

- [ ] **Step 5: Browser-verify existing layout and persistence**

Confirm:

- Invalid JSON import still preserves the current project.
- Reset restores the demo and clears runtime jobs.
- Left and right panels collapse independently.
- `专注编辑` still frees Timeline space.
- 390x900 mobile viewport has no document-level horizontal overflow:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

Expected: 0 or no meaningful overflow.

- [ ] **Step 6: Update `docs/AI_HANDOFF.md`**

Add capability bullets:

```markdown
- Adds an API-shaped generation bridge contract for clip generation and project mix jobs.
- Uses stable `asset://clip/<assetId>` and `asset://mix/<assetId>` references for generated assets.
- Lets the Preview Layer start a project mix job when required clip assets exist.
- Reuses the project mix asset for full-project preview and WAV download.
- Keeps signed playback/download URLs, runtime progress, and job state out of `AsmrProject`, localStorage, and exported project JSON.
```

Update recommended next work:

```markdown
Recommended next step: **Real provider adapter spike**.

Why this next: the frontend now speaks through an API-shaped bridge with clip and project-mix jobs. The next step should prototype one replaceable provider adapter behind the bridge, not change the director UI contract.
```

- [ ] **Step 7: Update `docs/project-archive.md`**

Append:

```markdown
## 2026-06-24 - API-Backed Generation Bridge Skeleton

Implemented the API-backed generation bridge skeleton from:

- `docs/superpowers/specs/2026-06-24-api-backed-generation-bridge-design.md`
- `docs/superpowers/specs/2026-06-24-api-backed-generation-bridge-design.zh.md`
- `docs/superpowers/plans/2026-06-24-api-backed-generation-bridge.md`

What changed:

- Extended generation jobs from selected clips to both clip generation and project mix.
- Introduced stable `asset://clip/...` and `asset://mix/...` asset references.
- Added project mix readiness, durable WAV export state, and remix failure preservation.
- Made full-project preview and WAV download reuse the same project mix asset.
- Kept runtime job state and playback/download URLs out of project JSON.
```

- [ ] **Step 8: Run final verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: PASS.

- [ ] **Step 9: Commit docs and verification fixes**

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md apps/web/src
git commit -m "docs: record api-backed generation bridge"
```

---

## Self-Review Checklist

- Spec coverage:
  - Unified job model: Tasks 1, 3, 4.
  - Clip generation API-shaped flow: Tasks 1, 4, 6.
  - Project mix API-shaped flow: Tasks 2, 3, 4, 5, 6.
  - Stable `asset://clip` and `asset://mix` references: Tasks 1, 2, 4.
  - Full-project preview and WAV export sharing the same mix asset: Tasks 2, 5, 6.
  - Polling-first bridge shape: Task 4.
  - Missing clip assets block project mix: Tasks 2, 5, 6.
  - Failed regeneration/remix preserving prior assets: Tasks 2, 6.
  - Runtime state excluded from project JSON: Tasks 6, 7.

- Red-flag scan:
  - The plan contains no unresolved markers or unnamed files.
  - Each implementation task includes exact files, concrete test snippets, commands, expected results, and commit commands.

- Type consistency:
  - `ProjectMixExportType` is `"wav"` throughout.
  - Stable URI forms are `asset://clip/<assetId>` and `asset://mix/<assetId>`.
  - Runtime status keeps the existing `"generating"` name to reduce UI churn while API docs can still describe it as running.
  - Project mix durable state writes into existing `exports[type === "wav"]` rather than requiring a schema migration.

---

## Execution Choice

Plan complete. Recommended execution mode is **Subagent-Driven** because Tasks 1-6 are separable and each has focused tests.
