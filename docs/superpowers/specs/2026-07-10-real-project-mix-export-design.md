# Real Project Mix And WAV Export Design

Status: Approved by the user on 2026-07-10 as Roadmap Step 9 scope.

## Goal

Roadmap Step 9 turns generated clip assets into a real full-project WAV. The workbench should consume existing `asset://clip/...` files, mix them according to the Timeline DSL, save one durable `asset://mix/...` reference, play that mix in the Preview Layer, and download the same WAV file.

This step proves that ASMR Director can produce a complete editable audio project output. It does not add a new top-level roadmap gate.

## Selected Approach

Use a local-first, strict-assets project mix renderer.

Every audio-bearing clip must already have a generated `asset://clip/...` asset before the project mix can run. If any `voice`, `breath`, `sfx`, or `ambience` clip is missing a durable local clip asset, the mix action stays disabled and the API rejects the request. The first implementation must not silently replace missing clips with silence.

The mix renderer runs in the local Next.js Node runtime, reads WAV files from the D-drive runtime asset store, writes a real WAV mix under the local runtime, and returns `asset://mix/<assetId>`. The browser never stores local filesystem paths, `blob:` URLs, `data:audio` URLs, signed URLs, job IDs, or progress in Project JSON.

## Current Code Facts

The existing app already provides these useful boundaries:

- `AsmrProject.timeline.mixing` contains `target_lufs`, `binaural`, and `master_limiter`.
- `AsmrProject.exports` can persist export status and URI values.
- Selected clip generation writes `asset://clip/...` into clip assets.
- `/api/assets/clip/[assetId]` serves local generated clip WAV files.
- Preview Layer already has a `project_mix` slot, selected-clip playback, and compact generation status.
- `GenerationBridge`, runtime state, and `StudioApp` are currently clip-oriented.

The missing piece is a real local project mix pipeline and UI wiring for full-project preview/download.

## Non-Goals

- Do not generate missing clips automatically.
- Do not allow `silence_missing_assets` in the first implementation.
- Do not add MP3, stems, cloud persistence, accounts, billing, publishing, or collaboration.
- Do not add real waveform extraction.
- Do not implement full DAW editing or drag/drop timeline changes.
- Do not implement true HRTF binaural rendering or strict broadcast LUFS measurement.
- Do not turn bridge cleanup, route shape, or adapter refactors into new roadmap steps.

## Project Mix Readiness

Audio-bearing clips are all timeline clips from:

- `voice`
- `breath`
- `sfx`
- `ambience`

The project mix is ready only when every audio-bearing clip satisfies all of these:

- `generation.status === "asset_generated"`
- `asset.asset_id` is present
- `asset.uri` starts with `asset://clip/`

The `post_processing` track is not an audio source. It influences intent only through `timeline.mixing` for this step.

Missing assets should produce a concise UI reason such as `先生成片段`. Detailed missing clip IDs belong in helper state or API error details, not in a crowded button label.

## Local Runtime And Asset Store

Extend local runtime config with a mix asset root:

```text
ASMR_MIX_ASSET_ROOT
default: D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app
```

The existing clip asset root remains unchanged:

```text
D:\CodexWorkplace\asmr_director_runtime\assets\clips\app
```

The local asset store should support:

- `resolveClipAssetPath(assetId, config)` for existing clip playback.
- `saveClipAsset(...)` for existing clip generation.
- `resolveMixAssetPath(assetId, config)` for mix playback/download.
- `saveMixAsset(...)` for project mix output.

Safe asset ID validation must remain strict: only letters, numbers, `_`, and `-` are valid path segments. Resolved paths must remain under their configured asset roots.

Mix asset IDs should be stable enough for debugging and unique enough for repeated mixes:

```text
<projectId>_wav_<timestamp>_<random8>
```

The persisted URI is:

```text
asset://mix/<assetId>
```

## Mix Renderer

Add a focused audio module responsible for WAV parsing, timeline rendering, and WAV encoding. It should not know React, API routes, or browser state.

The renderer should:

- Read required `asset://clip/...` WAV files from the local clip asset store.
- Decode PCM WAV assets, supporting at least 16-bit PCM mono and stereo.
- Resample sources to the output sample rate with simple linear resampling when needed.
- Produce a 32 kHz stereo PCM WAV for the full project.
- Allocate an output buffer based on `project.duration`.
- Place each clip at `clip.start`.
- Use `clip.duration` as the timeline target duration.
- Trim source audio that is longer than `clip.duration`.
- Pad non-looping source audio with silence when it is shorter than `clip.duration`.
- Repeat looping ambience sources when `clip.type === "ambience"` and `clip.loop === true`.
- Apply `volume_db`, `fade_in`, `fade_out`, `position.pan`, `position.distance`, and `position.movement`.
- Apply `timeline.mixing.target_lufs` as approximate RMS normalization, not strict LUFS.
- Apply a simple peak limiter when `timeline.mixing.master_limiter === true`.

### Spatial Rules

The first implementation should keep spatial rendering simple and predictable:

- Convert each source to mono before panning.
- Output stereo.
- Use equal-power panning for `position.pan`.
- Apply distance as a gain scalar:
  - `far`: quieter
  - `mid`: moderately quiet
  - `near`: neutral
  - `close`: slightly present
  - `very_close`: most present
- `static` keeps the clip pan stable.
- `left_to_right` linearly moves pan from left to right across the clip.
- `right_to_left` linearly moves pan from right to left.
- `approach` gently increases distance gain across the clip.
- `recede` gently decreases distance gain across the clip.

The `binaural` flag should be preserved as project intent. In this step it can map to the stereo panning behavior above. True HRTF rendering remains Step 10 or later.

## Project Export State

Add a focused project-mix state helper.

On successful WAV mix:

```ts
exports[type === "wav"].status = "exported";
exports[type === "wav"].uri = "asset://mix/<assetId>";
```

If the project has no `wav` export entry, add one. This keeps older demo/project JSON compatible with Step 9 without changing the schema.

On first mix failure:

```ts
exports[type === "wav"].status = "export_failed";
exports[type === "wav"].uri = null;
```

On remix failure when a previous WAV mix exists, preserve the previous `asset://mix/...` URI and keep the previous exported WAV usable. Runtime UI may show the latest error, but a failed remix must not destroy the last usable full-project audio.

## Fingerprints And Stale Results

Add a project mix fingerprint function. It should include:

- project ID
- project duration
- requested export type, initially `wav`
- timeline mixing settings
- every audio-bearing clip ID
- clip `start`, `duration`, `volume_db`, `fade_in`, `fade_out`
- clip `position`
- clip asset URI
- clip asset duration

It should not include runtime job IDs, progress, temporary messages, or local filesystem paths.

The UI should commit a completed mix only when the returned or remembered fingerprint still matches the current project. If the user edits the timeline while a mix is running, the late result is ignored.

## Bridge And Runtime State

Extend the current generation boundary instead of replacing it.

The browser-side bridge should gain a project mix operation:

```ts
generateProjectMix(
  request: GenerateProjectMixRequest,
  onUpdate: (update: ProjectMixJobUpdate) => void,
): Promise<{ jobId: string }>;
```

The local bridge can remain synchronous behind the scenes, matching the current selected-clip local bridge:

1. emit queued snapshot
2. emit generating snapshot
3. call `/api/generation/mix`
4. emit succeeded or failed update

Runtime project mix jobs stay outside `AsmrProject`, localStorage, and exported JSON. Existing clip job behavior must keep working.

## API Routes

Use a simple local API shape for Step 9:

```http
POST /api/generation/mix
```

Request:

```json
{
  "project": {},
  "exportType": "wav"
}
```

Response:

```json
{
  "asset": {
    "assetId": "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    "uri": "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    "duration": 210
  }
}
```

Missing clip assets should return `409` with a clear error payload:

```json
{
  "error": "Generate all required clips before project mix.",
  "missingClipIds": ["voice_001", "ambience_rain_001"]
}
```

Playback/download route:

```http
GET /api/assets/mix/[assetId]
```

It returns `audio/wav` bytes. For download, the UI may use the same route with an anchor `download` attribute. The route should use `cache-control: no-store`.

## UI Behavior

The Preview Layer is the primary project-mix surface.

Add compact controls there:

- `生成整段`: enabled only when all required clip assets exist and no current mix exists.
- `重混`: enabled when a previous mix exists but the current fingerprint is stale or the user wants to regenerate.
- `试听`: enabled when a current `asset://mix/...` exists.
- `WAV`: downloads the same current mix asset.

Button names must stay short and clear. The top workspace header should continue to handle project JSON import/export/reset. If needed for clarity, the existing header export copy can become `JSON` or `导出JSON` so it does not conflict with WAV download.

Preview Layer status should distinguish:

- missing clip assets
- ready to mix
- mixing
- mix exported
- stale mix after timeline/asset edits
- mix failed

The existing selected-clip preview button remains available and separate from full-project playback.

## Persistence And Import/Export

Persist:

- final `exports[type === "wav"].status`
- final `exports[type === "wav"].uri`
- final clip asset references
- short durable failure state if needed

Never persist:

- runtime job state
- progress
- local file paths
- generated playback URLs
- browser `blob:` URLs
- browser `data:audio` URLs

Importing project JSON with `asset://mix/...` should keep the URI. Playback may fail if the local runtime cannot resolve the asset, but the project JSON remains valid metadata.

## Testing Strategy

Unit tests:

- WAV decoder accepts 16-bit PCM mono/stereo and rejects malformed WAV.
- Renderer places clips by `start` and `duration`.
- Renderer applies gain, fade, pan, simple movement, and limiter behavior.
- Looping ambience repeats when the source is shorter than the timeline clip.
- Missing assets block mix readiness and API creation.
- Mix asset store saves and resolves `asset://mix/...`.
- Project mix success writes or creates the `wav` export entry.
- Project remix failure preserves a previous exported mix URI.
- Project mix fingerprint changes when timing, mixing settings, or asset URIs change.
- Playback resolver maps `asset://mix/...` to `/api/assets/mix/...`.
- Local project mix bridge emits queued, generating, succeeded, failed, and canceled updates without serializing runtime state.

Browser/manual verification:

- Use a project where all audio-bearing clips have real `asset://clip/...` references.
- Confirm Preview Layer enables `生成整段`.
- Generate mix and confirm Project JSON/localStorage stores `asset://mix/...`, not local paths.
- Confirm `/api/assets/mix/<assetId>` returns `audio/wav` and `RIFF`.
- Confirm full-project `试听` plays the real mix.
- Confirm `WAV` downloads the same mix asset.
- Edit a clip timing after mix and confirm the UI treats the old mix as stale.

## Acceptance Criteria

- Project mix consumes real local `asset://clip/...` assets.
- Missing audio-bearing clip assets block project mix.
- The rendered WAV follows timeline `start` / `duration`.
- Basic gain, fade, pan, distance, movement, normalization, and limiter intent are applied.
- Full-project preview plays a real `asset://mix/...` WAV.
- WAV download returns the same real mix file.
- Project JSON stores only durable `asset://mix/...` export state.
- Runtime project mix jobs do not enter Project JSON, localStorage project data, or export JSON.
- Step 10 productization work remains out of scope.
