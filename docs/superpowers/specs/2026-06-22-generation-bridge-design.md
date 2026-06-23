# Generation Bridge Design

Date: 2026-06-22

## Context

The app now has the approved project workspace shell and preview layer branch:

- Project rail and project details dock can collapse independently.
- The right dock contains a lightweight preview layer and generation slots.
- Timeline, Storyboard, and Inspector show lightweight generation/readiness signals.
- The project remains local-first and schema-driven through `AsmrProject`.

The next roadmap step is **real generation chain**, but the project should not jump directly into real TTS, SFX, ambience generation, backend queues, or cloud assets. The next step is to define and implement a bridge that makes the product behave like a generation system while keeping the first implementation mockable and local.

This design should be implemented on top of the preview-layer work, or after that branch is merged into `master`.

## Approved Direction

Use **C: hybrid mock-first bridge with backend-shaped boundaries**.

The first implementation introduces a `GenerationBridge` and a runtime job store. The bridge uses mock generation locally, but its interface and state boundaries are shaped so it can later be replaced by an API-backed implementation without rewriting the preview layer, Timeline, Inspector, or persistence logic.

## Goals

- Add a clear generation command boundary for selected clips.
- Add a runtime-only job store for queued/generating/canceling/progress state.
- Keep durable generated asset references in `AsmrProject`.
- Keep transient job data out of imported/exported project JSON.
- Let the preview layer, Timeline, and Inspector consume one merged generation view.
- Allow mock-generated assets to be previewed without pretending they are real model output.
- Preserve the existing local-first workflow, Chinese UI, validation, import/export/reset, autosave, and shell collapse behavior.

## Non-Goals

- No real TTS integration.
- No real SFX or ambience model integration.
- No backend queue.
- No cloud storage.
- No account, auth, billing, collaboration, or publishing.
- No full project mix export.
- No batch generation for every track in the first implementation.
- No durable binary audio inside project JSON.
- No schema-breaking migration.

## Core Concept

Split generation state into three layers:

1. **Durable project data**
   - Stored in `AsmrProject`.
   - Imported, exported, autosaved, and reset with the project.
   - Holds final clip generation status, generation parameters, final asset ID, URI, and duration.

2. **Runtime job state**
   - Stored outside `AsmrProject`.
   - Lives only in the current browser session.
   - Holds job ID, queue/generation progress, canceling state, temporary job messages, and in-flight errors.
   - Never appears in exported project JSON.

3. **Generation bridge**
   - The only layer that knows whether generation is mock, local, or backend-backed.
   - UI components call the same bridge methods regardless of implementation.
   - Later real services replace the bridge implementation, not the surrounding product surface.

## Data Ownership

### Durable Project Data

The durable project remains the source of truth for finished asset readiness.

On successful generation, the app writes:

```ts
clip.generation.status = "asset_generated";
clip.generation.error = undefined;
clip.asset = {
  asset_id: "mock_clip_001_job_001",
  uri: "mock://asset/clip_001/job_001",
  duration: 6.2
};
```

On failed generation, the app writes a terminal failure state:

```ts
clip.generation.status = "asset_failed";
clip.generation.error = "Mock generation failed";
clip.asset = undefined;
```

On generation start, the first implementation should prefer keeping queued/generating/progress state in the runtime job store rather than persisting it into `AsmrProject`. The UI should derive the displayed "generating" state by merging project data with runtime jobs.

This avoids saving stale in-flight jobs into localStorage or exported JSON.

### Runtime Job State

The runtime store is keyed by `clipId` and `jobId`.

Recommended shape:

```ts
type GenerationRuntimeStatus =
  | "queued"
  | "generating"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

type GenerationJobSnapshot = {
  jobId: string;
  clipId: string;
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
```

Runtime jobs should be cleared when they reach a terminal state and their result has been committed to project data, except when a short-lived failure message is needed for UI feedback.

If the browser refreshes during a mock job, the job is lost. The clip should fall back to its durable project status, usually `asset_pending` or the last terminal state. The first implementation should not try to resume mock jobs.

## Generation Bridge Contract

Recommended bridge boundary:

```ts
type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: "generate" | "regenerate" | "retry";
};

type GeneratedAssetResult = {
  assetId: string;
  uri: string;
  duration: number;
};

type GenerationJobUpdate =
  | { type: "snapshot"; job: GenerationJobSnapshot }
  | { type: "succeeded"; job: GenerationJobSnapshot; asset: GeneratedAssetResult }
  | { type: "failed"; job: GenerationJobSnapshot; error: string }
  | { type: "canceled"; job: GenerationJobSnapshot };

type GenerationBridge = {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void
  ): Promise<{ jobId: string }>;
  cancelGeneration(jobId: string): Promise<void>;
};
```

`regenerate` and `retry` can call `generateClip` with different `reason` values. The app layer decides how to clear old asset data before starting the job.

## Mock Asset Strategy

The mock bridge must not save browser `blob:` object URLs into `AsmrProject`, because those URLs do not survive refresh or import/export.

Instead, mock generation returns a durable mock URI:

```txt
mock://asset/<clipId>/<jobId>
```

A runtime asset resolver can turn `mock://` URIs into playable local audio when the user previews the clip. The generated sound should be clearly placeholder audio, such as a short neutral tone, noise bed, or silence with a subtle marker. It must not be presented as real TTS/SFX output.

Later, a real bridge can return real asset URIs such as object-storage URLs or local file references without changing the UI contract.

## User Flow

### Generate Selected Clip

1. User selects a clip.
2. Inspector or preview layer shows `生成` when the clip has no asset.
3. User clicks `生成`.
4. The app validates that the clip is structurally usable.
5. Runtime job store records a queued job.
6. Mock bridge emits progress updates.
7. Timeline, preview layer, and Inspector show the merged effective state as `生成中`.
8. On success, the app writes `asset_generated` and `clip.asset` into `AsmrProject`.
9. Runtime job state is cleared.
10. Preview controls become available for that clip's mock asset.

### Regenerate Clip

1. User clicks `重生成`.
2. Runtime job starts with `reason: "regenerate"`.
3. Existing asset remains visible until the new job succeeds, unless the UI clearly communicates that it is replacing the asset.
4. On success, old asset metadata is replaced by the new asset result.
5. On failure or cancel, the previous generated asset remains available.

This rule prevents one failed regeneration from destroying a usable previous asset.

### Retry Failed Clip

1. User clicks `重试`.
2. Runtime job starts with `reason: "retry"`.
3. The old error remains visible until progress begins, then becomes secondary.
4. On success, the error is cleared and asset metadata is saved.
5. On failure, the failure status and latest short error are saved.

### Cancel In-Flight Job

1. User clicks `取消`.
2. Runtime job becomes `canceling`.
3. The bridge resolves as `canceled`.
4. Runtime job is cleared.
5. Durable project state returns to the previous terminal state:
   - pending if there was no prior asset.
   - generated if regeneration was canceled and a prior asset exists.
   - failed if retry was canceled after a previous failure.

## Effective Display State

Preview and editing components should not read runtime jobs directly in many places. Add a small derivation helper that merges project data and runtime jobs into display-ready state.

Recommended helper responsibility:

```ts
deriveGenerationView(project, runtimeJobs)
```

It should produce:

- Clip-level effective status.
- Selected clip generation action labels.
- Track/project generation slot summaries.
- Counts for pending, generating, failed, generated, and playable clips.
- Whether the preview button should be enabled.
- Which URI should be resolved for playback.

This keeps `PreviewLayerPanel`, `TimelinePanel`, `StoryboardPanel`, and `ClipInspector` simple.

## UI Scope

### Inspector

The Inspector is the primary control point for the first implementation.

It should show:

- Selected clip status.
- Asset slot.
- `生成`, `重生成`, `重试`, or `取消` depending on effective state.
- Progress while generating.
- Short error text when failed.
- Basic asset info when generated.

### Preview Layer

The right preview layer should show project readiness and the selected clip's playable state.

It may expose:

- Selected clip preview play control when a generated asset exists.
- Project-level counts.
- Generation slot statuses.
- A disabled project-mix play control until a later project mix step exists.

The first implementation should not add full project mix generation.

### Timeline and Storyboard

Timeline and Storyboard should continue to show compact generation status signals. They may show generating progress in a lightweight way if the data is available, but they should not become the main job-control surface.

## Validation Rules

Generation should be disabled for clips that cannot be generated safely, such as:

- Missing or invalid clip text/content for voice clips.
- Invalid duration.
- Broken timing that fails project validation.

Validation detail remains in the existing validation surfaces. Generation controls should use short disabled reasons such as `先修正片段`.

## Error Handling

- Mock bridge should support deterministic success and at least one testable failure path.
- Failed generation writes `asset_failed` and a short durable error.
- Runtime-only detailed messages should remain out of project JSON.
- Canceling should not be treated as failure.
- Failed regeneration must not delete a previously generated usable asset.
- Invalid import behavior remains unchanged.

## Persistence and Import/Export

- Runtime jobs are not saved to localStorage.
- Runtime jobs are not exported.
- Project JSON may contain `asset_generated`, `asset_failed`, final `asset` metadata, and generation parameters.
- Project JSON must not contain progress, queue position, job messages, or browser object URLs.
- Mock asset URIs may be exported as `mock://` values while the feature is still in mock mode.
- Importing a project with `mock://` assets should display them as mock assets and resolve them at runtime if possible.

## Component and File Boundaries

Likely additions:

- `generation-bridge.ts`
  - Bridge types and interface.

- `mock-generation-bridge.ts`
  - Local mock implementation.

- `generation-runtime-store.ts` or a focused React hook
  - Runtime job snapshots and update helpers.

- `generation-view.ts`
  - Pure derivation helper that merges `AsmrProject` with runtime jobs.

- `mock-asset-resolver.ts`
  - Resolves `mock://` assets into playable local audio sources.

Likely updates:

- `studio-app.tsx`
  - Owns bridge, runtime job state, and durable project commits.

- `generation-summary.ts`
  - Either remains as preview-only project summary, or is folded into the new generation view helper if the implementation plan chooses that path.

- `preview-layer-panel.tsx`
  - Displays effective preview/playability state.

- `generation-slot-list.tsx`
  - Displays effective slot status.

- `clip-inspector.tsx`
  - Adds selected clip generation controls.

- `timeline-panel.tsx` and `storyboard-panel.tsx`
  - Continue compact status display.

## Testing

Unit tests:

- Mock bridge emits queued/generating/succeeded updates.
- Mock bridge supports canceling.
- Mock bridge exposes a deterministic failure path.
- Runtime job updates are not serialized into project JSON.
- Generation view helper prefers runtime generating state over durable pending state.
- Successful generation commits `asset_generated` and final asset metadata.
- Failed generation commits `asset_failed` and no fake asset.
- Failed regeneration preserves previous generated asset.
- `mock://` asset URIs are accepted as mock generated assets.

Browser verification:

- Select a clip and click `生成`.
- Progress appears without layout collapse regressions.
- Generated clip becomes playable through mock asset resolution.
- Timeline, preview layer, and Inspector agree on status.
- `重生成`, `重试`, and `取消` states are visible and behave consistently.
- Import/export/reset/autosave still work.
- Left/right collapse and focused editing still keep the Timeline usable.

## Acceptance Criteria

- A clear generation bridge design exists before real model integration.
- Selected clips can enter a mock generation flow through the bridge.
- Runtime job state is separate from durable project data.
- Finished mock asset metadata is committed to `AsmrProject`.
- Browser `blob:` URLs are not saved into project JSON.
- Preview layer, Timeline, Storyboard, and Inspector consume merged effective generation state.
- Failed and canceled jobs behave predictably.
- The first implementation remains local-first and mock-only.
- The design leaves a direct path to a future API-backed bridge.
