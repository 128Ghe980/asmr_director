# API-Backed Generation Bridge Design

Date: 2026-06-24

## Context

The studio already has a mock-first `GenerationBridge` for selected clip generation. That bridge proved the important product boundaries:

- UI components do not know whether generation is mock or real.
- Runtime job state stays outside `AsmrProject`.
- Final clip assets are committed into durable project data only after terminal success.
- Failed generation commits short durable failure state.
- Failed regeneration preserves the previous usable asset.
- `mock://` asset URIs are resolved at runtime for playback and are not replaced by browser `blob:` or `data:` URLs in project JSON.

The next step is not to wire a specific TTS, SFX, ambience, storage, or mixing vendor directly into the frontend. The next step is to design the API-backed generation contract that can replace the mock bridge while preserving the director workflow.

## Approved Direction

Use **B: API-backed clip generation plus project mix**.

The API contract should cover both:

1. **Clip generation**
   - Generate one timeline clip into a reusable clip asset.
   - Supports voice, breath, SFX, and ambience clips.
   - Keeps the current Inspector-centered generation workflow.

2. **Project mix**
   - Mix generated clip assets according to the Timeline DSL into one full project audio asset.
   - The project mix asset is the shared source for full-project preview and WAV export.
   - Export should not run a separate audio generation path when a valid mix asset already exists.

## Goals

- Define a backend-shaped API contract for generation without binding to a specific provider.
- Extend the current bridge idea from selected clips to project-level mix jobs.
- Keep a unified job lifecycle for clip generation and project mix.
- Keep stable asset references in `AsmrProject` instead of temporary playback URLs.
- Make full-project preview and WAV export reuse the same durable project mix asset.
- Preserve the existing local-first frontend, import/export/reset/autosave, validation, Preview Layer, Inspector, Timeline status signals, and concise Chinese UI copy.
- Leave a clean path for polling first, then optional SSE or WebSocket progress later.

## Non-Goals

- No real TTS, SFX, ambience, or mixing provider integration in this design step.
- No cloud project persistence, auth, billing, collaboration, publishing, or account system.
- No full DAW drag/drop editing.
- No real waveform extraction requirement.
- No browser `blob:` URLs, `data:audio` URLs, job progress, or queue state persisted into project JSON.
- No MP3 requirement in the first implementation. MP3 can be reserved as a later transcode/export format.

## Core Architecture

The generation system has five boundaries:

1. **Frontend generation bridge**
   - TypeScript interface used by `StudioApp`.
   - Keeps current UI components decoupled from HTTP details.
   - Owns client-side polling or future event subscription.

2. **Generation API**
   - Receives generation commands.
   - Creates jobs.
   - Exposes job snapshots and cancellation.
   - Returns final asset references when jobs succeed.

3. **Job store**
   - Backend-owned job state.
   - Holds queue/running/progress/error/cancellation state.
   - Job state is not stored inside `AsmrProject`.

4. **Provider adapters**
   - Behind the API boundary.
   - Later adapters can call TTS, SFX, ambience, or local mixing services.
   - The frontend never calls providers directly.

5. **Asset store and resolver**
   - Stores generated clip assets and project mix assets.
   - `AsmrProject` stores stable internal URIs such as `asset://clip/<assetId>` and `asset://mix/<assetId>`.
   - Playback and download use resolver endpoints that return short-lived URLs.

## Job Model

All generation work uses one job model.

```ts
type GenerationJobType = "clip_generation" | "project_mix";

type GenerationJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

type GenerationJobSnapshot = {
  jobId: string;
  type: GenerationJobType;
  projectId: string;
  target:
    | { type: "clip"; clipId: string }
    | { type: "project_mix"; exportType: "wav" };
  status: GenerationJobStatus;
  progress: number;
  message?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  result?: {
    asset: GeneratedAssetReference;
  };
  inputFingerprint: string;
  createdAt: string;
  updatedAt: string;
};
```

The status lifecycle is:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> canceling -> canceled
queued -> canceling -> canceled
```

Cancellation is not a durable failure. It clears the runtime job and leaves the previous durable project state intact.

## Asset Model

Generated assets are durable references, not direct playback URLs.

```ts
type GeneratedAssetKind = "clip" | "project_mix";

type GeneratedAssetReference = {
  assetId: string;
  kind: GeneratedAssetKind;
  uri: string; // asset://clip/<assetId> or asset://mix/<assetId>
  duration: number;
  format: "wav" | "mp3";
  mimeType: string;
  sampleRate?: number;
  channels?: number;
  sizeBytes?: number;
  sourceJobId: string;
};
```

Stable asset URIs:

```text
asset://clip/<assetId>
asset://mix/<assetId>
```

The frontend should never persist signed HTTP URLs, browser object URLs, or data URLs. To play or download, it asks the asset resolver for a fresh URL.

## Durable Project Writes

### Clip Generation Success

On successful clip generation, commit the final asset reference into the selected clip:

```ts
clip.generation.status = "asset_generated";
clip.generation.error = null;
clip.asset = {
  asset_id: asset.assetId,
  uri: "asset://clip/<assetId>",
  duration: asset.duration
};
```

### Clip Generation Failure

On first-generation failure:

```ts
clip.generation.status = "asset_failed";
clip.generation.error = "short user-readable error";
clip.asset = {
  asset_id: null,
  uri: null,
  duration: null
};
```

On regeneration failure, preserve the previous usable generated asset and keep the clip in `asset_generated`. This preserves creative work and matches the current mock bridge behavior.

### Project Mix Success

The first API-backed design should reuse the existing project `exports` array instead of adding a schema-breaking project-level asset section.

On successful WAV mix:

```ts
exports[type === "wav"].status = "exported";
exports[type === "wav"].uri = "asset://mix/<assetId>";
```

The Preview Layer reads this same WAV export URI as the full-project preview source. The WAV export button also downloads this same asset. This makes full-project preview and export one shared audio result.

### Project Mix Failure

On first mix failure:

```ts
exports[type === "wav"].status = "export_failed";
exports[type === "wav"].uri = null;
```

On remix failure when a previous mix asset exists, preserve the previous `asset://mix/<assetId>` and keep the previous exported WAV available. The UI may show the latest remix error as runtime feedback, but a failed remix should not destroy the last usable full-project audio.

## API Endpoints

The first API contract uses polling as the baseline. SSE or WebSocket progress can be added later without changing the durable project model.

### Create Clip Generation Job

```http
POST /api/generation/jobs/clip
```

Request:

```json
{
  "project": { "project_id": "asmr_demo_001" },
  "clipId": "voice_001",
  "reason": "generate",
  "inputFingerprint": "sha256:...",
  "idempotencyKey": "client-generated-key"
}
```

`project` contains the full `AsmrProject` snapshot in the local-first phase. Later, when backend project persistence exists, the request may pass `projectId` plus `projectVersion` instead.

Response:

```json
{
  "job": {
    "jobId": "job_123",
    "type": "clip_generation",
    "projectId": "asmr_demo_001",
    "target": { "type": "clip", "clipId": "voice_001" },
    "status": "queued",
    "progress": 0,
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:00.000Z"
  }
}
```

Allowed reasons:

```ts
type ClipGenerationReason = "generate" | "regenerate" | "retry";
```

### Create Project Mix Job

```http
POST /api/generation/jobs/project-mix
```

Request:

```json
{
  "project": { "project_id": "asmr_demo_001" },
  "exportType": "wav",
  "reason": "mix",
  "mixPolicy": "require_all_assets",
  "inputFingerprint": "sha256:...",
  "idempotencyKey": "client-generated-key"
}
```

Allowed reasons:

```ts
type ProjectMixReason = "mix" | "remix" | "retry";
```

The default `mixPolicy` is `require_all_assets`. Under this rule, the API rejects the request if any audio-bearing timeline clip lacks a generated asset. This keeps the first real mix honest and avoids silently exporting incomplete audio.

Future policy:

```ts
type ProjectMixPolicy = "require_all_assets" | "silence_missing_assets";
```

`silence_missing_assets` is reserved for later. It should not be the first implementation default.

Response:

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "queued",
    "progress": 0,
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:00.000Z"
  }
}
```

If required clip assets are missing, return `409`:

```json
{
  "error": {
    "code": "missing_required_assets",
    "message": "Generate all required clips before project mix.",
    "details": {
      "missingClipIds": ["voice_001", "ambience_rain_001"]
    }
  }
}
```

### Read Job Snapshot

```http
GET /api/generation/jobs/:jobId
```

Response:

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "running",
    "progress": 62,
    "message": "Mixing timeline",
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:10.000Z"
  }
}
```

On success:

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "succeeded",
    "progress": 100,
    "inputFingerprint": "sha256:...",
    "result": {
      "asset": {
        "assetId": "mix_789",
        "kind": "project_mix",
        "uri": "asset://mix/mix_789",
        "duration": 210,
        "format": "wav",
        "mimeType": "audio/wav",
        "sampleRate": 48000,
        "channels": 2,
        "sourceJobId": "job_456"
      }
    },
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:01:20.000Z"
  }
}
```

### Cancel Job

```http
POST /api/generation/jobs/:jobId/cancel
```

Response:

```json
{
  "job": {
    "jobId": "job_456",
    "status": "canceling"
  }
}
```

Cancellation is best-effort. If the provider has already completed, the next job snapshot may be `succeeded`. The frontend must still use input fingerprints before committing results.

### Resolve Playback URL

```http
GET /api/assets/:assetId/playback-url
```

Response:

```json
{
  "assetId": "mix_789",
  "url": "https://signed.example/audio/mix_789.wav",
  "expiresAt": "2026-06-24T00:11:20.000Z"
}
```

### Resolve Download URL

```http
GET /api/assets/:assetId/download-url
```

Response:

```json
{
  "assetId": "mix_789",
  "url": "https://signed.example/download/mix_789.wav",
  "filename": "rain-night-before-sleep.wav",
  "expiresAt": "2026-06-24T00:11:20.000Z"
}
```

## Frontend Bridge Contract

The existing bridge should be extended instead of replaced.

```ts
type ApiGenerationBridge = {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;

  generateProjectMix(
    request: GenerateProjectMixRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;

  cancelGeneration(jobId: string): Promise<void>;

  resolvePlaybackUrl(assetUri: string): Promise<string>;

  resolveDownloadUrl(assetUri: string): Promise<{
    url: string;
    filename: string;
  }>;
};
```

The bridge owns polling. UI components continue to consume derived generation view state, not raw HTTP responses.

## Input Fingerprints And Stale Results

Every job request includes `inputFingerprint`.

For clip generation, the fingerprint should include:

- Clip ID.
- Clip content fields.
- Timing and duration.
- Position and volume.
- Generation model, seed, temperature, retry count, and relevant generation parameters.

For project mix, the fingerprint should include:

- Project ID.
- Project duration.
- Timeline tracks and clip positions.
- Clip asset URIs and durations.
- Mixing settings such as target LUFS, binaural, and master limiter.
- Requested export type.

The frontend should only commit a completed result when the returned job fingerprint still matches the current project or clip fingerprint. This preserves the existing protection against stale callbacks.

## Project Mix Readiness

The first implementation should use this default rule:

```text
Project mix is enabled only when every audio-bearing clip has a generated asset.
```

Audio-bearing clips are:

- `voice`
- `breath`
- `sfx`
- `ambience`

The `post_processing` track is not a generated audio asset source.

If required assets are missing, the Preview Layer should show a short disabled reason such as:

```text
先生成缺失片段
```

The full missing clip list should be available in validation or job error details, not squeezed into the button label.

## Mixing Rules

The Timeline DSL is the source of truth for final alignment.

The mix engine should:

- Place each clip asset at `clip.start`.
- Use `clip.duration` as the intended timeline duration.
- Apply clip `volume_db`, `fade_in`, `fade_out`, `position.pan`, `position.distance`, and `position.movement`.
- Apply project mixing settings: `target_lufs`, `binaural`, and `master_limiter`.
- Trim or pad minor asset-duration mismatches to match the timeline duration.
- Fail the job if an asset URI cannot be resolved or a required asset is missing under `require_all_assets`.

The first implementation can keep advanced mastering and real binaural rendering simple behind the API boundary. The contract only needs to preserve the intent and output asset semantics.

## UI Surface

### Inspector

The Inspector remains the primary selected-clip generation surface:

- Generate pending clip.
- Cancel active clip generation.
- Retry failed clip.
- Regenerate generated clip.
- Show short error and progress.

### Preview Layer

The Preview Layer becomes the primary project-mix surface:

- Show selected clip playback if the selected clip has a generated asset.
- Show project mix readiness.
- Show `生成整段` or equivalent concise Chinese action when all required clip assets exist.
- Show project mix progress.
- Enable full-project playback when the mix asset exists.
- Reuse the same mix asset for WAV export.

### Timeline

The Timeline continues to show compact clip-level generation status. It may show project mix readiness indirectly through Preview Layer counts, but it should not become the main project-mix control surface.

### Export

The WAV export action should:

- Download the existing `asset://mix/<assetId>` if one exists and matches the current project mix fingerprint.
- Otherwise guide the user to generate or regenerate the project mix first.

MP3 can be shown later as a separate transcode/export job. It should not be required for the first API-backed bridge implementation.

## Error Handling

Recommended durable/user-facing error categories:

- `invalid_project`
- `invalid_clip`
- `missing_required_assets`
- `asset_not_found`
- `provider_failed`
- `mix_failed`
- `canceled`
- `rate_limited`
- `network_error`

Rules:

- Runtime details stay in job snapshots.
- Durable project JSON stores only short user-facing errors.
- Canceling does not become a durable failure.
- Failed clip regeneration preserves the previous clip asset.
- Failed project remix preserves the previous project mix asset.
- Missing assets should prevent project mix creation with a clear `409` response.

## Persistence And Import/Export

Persist in project JSON:

- Final clip `asset_generated` / `asset_failed`.
- Final clip `asset` metadata.
- Final WAV export status and `asset://mix/<assetId>` URI.
- Short durable errors.

Never persist:

- Job progress.
- Queue state.
- Polling state.
- Runtime messages.
- Signed playback URLs.
- Signed download URLs.
- Browser `blob:` URLs.
- Browser `data:audio` URLs.

Importing a project that contains `asset://` URIs should keep those URIs as stable asset references. Playback or download may fail if the current backend cannot resolve them, but the JSON remains valid as project metadata.

## Testing Strategy

Unit tests:

- API bridge starts clip jobs and maps job snapshots into current `GenerationJobUpdate` shape.
- API bridge starts project mix jobs and maps successful mix assets into project export state.
- Project mix readiness detects missing clip assets.
- Clip success commits `asset://clip/<assetId>`.
- Project mix success commits `asset://mix/<assetId>` into the WAV export.
- Clip regeneration failure preserves prior clip asset.
- Project remix failure preserves prior mix asset.
- Signed playback/download URLs are never serialized into `AsmrProject`.
- Stale fingerprint results are ignored.

Browser verification:

- Generate a clip through the bridge-shaped flow.
- Project mix remains disabled while required clips are missing.
- Once required clips have assets, project mix action becomes enabled.
- Project mix progress appears in the Preview Layer.
- Successful project mix enables full-project playback.
- WAV export downloads the same project mix asset.
- Reset/import/export/autosave still exclude runtime job state.
- Left/right panel collapse and focused editing still keep the Timeline usable.

## Acceptance Criteria

- The design defines one job model for clip generation and project mix.
- Clip generation and project mix have explicit API endpoints.
- Full-project preview and WAV export share the same durable mix asset.
- `asset://clip/...` and `asset://mix/...` are the stable persisted URI forms.
- Signed playback/download URLs are resolved at use time and are not saved into project JSON.
- Project mix is disabled by default until all required clip assets exist.
- Failed regeneration/remix does not destroy the last usable asset.
- Polling is sufficient for the first API-backed implementation, with SSE/WebSocket left as an optional future optimization.
- The design does not require real provider integration, auth, billing, cloud project persistence, or a full DAW.

## Implementation Planning Notes

The next implementation plan should not start by wiring real providers. It should start by adding the API-backed bridge types, project-mix state derivation, asset URI helpers, and tests around durable state commits. A mock API adapter can stand in for the backend while preserving the new HTTP-shaped contract.
