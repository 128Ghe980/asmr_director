# Real Generation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Completed on 2026-07-07. The app now defaults to local GPT-SoVITS voice clip generation and stores playable `asset://clip/...` references.

**Goal:** Wire the proven local GPT-SoVITS runtime into the existing selected voice clip generation flow so a real WAV is generated, stored as a stable `asset://clip/...` reference, and played through the Preview Layer.

**Architecture:** Keep the existing `GenerationBridge` and UI state model. Add a local Next API layer that calls GPT-SoVITS, saves the WAV under `D:\CodexWorkplace\asmr_director_runtime`, returns a durable asset reference, and resolves `asset://clip/...` to playback bytes. The frontend bridge calls this API and falls back to mock only when explicitly configured.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Node `fs/promises`, Web `fetch`, Vitest, existing ASMR Project schema and generation runtime.

## Global Constraints

- Current roadmap source is `docs/ROADMAP.md`; this work is only Step 7, Real Generation MVP.
- Only voice clips are in scope.
- Do not add SFX, ambience, project mix, export mixing, training platform, account, cloud storage, billing, or full DAW features.
- Do not commit GPT-SoVITS source, Python env, model weights, reference audio, generated WAVs, or runtime caches.
- Project JSON may store only durable `asset://clip/...` references and final asset metadata.
- Runtime jobs, local absolute paths, browser `blob:` URLs, and `data:audio` URLs must not be serialized into `AsmrProject`.
- Preserve existing failure, retry, cancel, stale-fingerprint, import/export, autosave, reset, and Preview Layer behavior.
- Speak Chinese in UI copy.

---

## File Structure

- Create `apps/web/src/lib/asmr/local-runtime-config.ts`: reads runtime paths and provider URLs from environment variables with documented defaults.
- Create `apps/web/src/lib/asmr/voice-pack.ts`: loads and validates the local GPT-SoVITS voice pack JSON.
- Create `apps/web/src/lib/asmr/gpt-sovits-provider.ts`: maps a voice clip and voice pack to GPT-SoVITS `/tts` request payload and calls the local service.
- Create `apps/web/src/lib/asmr/local-asset-store.ts`: writes generated WAV buffers into the runtime asset store and resolves `asset://clip/...` IDs.
- Create `apps/web/src/app/api/generation/clip/route.ts`: POST endpoint for one selected voice clip generation.
- Create `apps/web/src/app/api/assets/clip/[assetId]/route.ts`: GET endpoint for local generated clip playback.
- Create `apps/web/src/lib/asmr/local-generation-bridge.ts`: browser-side bridge that calls the local API and emits existing `GenerationJobUpdate` events.
- Modify `apps/web/src/lib/asmr/generation-view.ts`: allow `asset://clip/...` selected clip assets to be playable.
- Modify `apps/web/src/components/studio/studio-app.tsx`: choose local real bridge by default and resolve real asset playback URLs.
- Modify docs after implementation: `docs/AI_HANDOFF.md`, `docs/project-archive.md`, `docs/ROADMAP.md`.

## Task 1: Runtime Config, Voice Pack, and Asset Store

**Files:**
- Create: `apps/web/src/lib/asmr/local-runtime-config.ts`
- Create: `apps/web/src/lib/asmr/voice-pack.ts`
- Create: `apps/web/src/lib/asmr/local-asset-store.ts`
- Test: `apps/web/src/lib/asmr/local-runtime-config.test.ts`
- Test: `apps/web/src/lib/asmr/voice-pack.test.ts`
- Test: `apps/web/src/lib/asmr/local-asset-store.test.ts`

**Interfaces:**
- Produces `getLocalRuntimeConfig(env?: NodeJS.ProcessEnv): LocalRuntimeConfig`
- Produces `loadVoicePack(config: LocalRuntimeConfig): Promise<VoicePack>`
- Produces `saveClipAsset(input: SaveClipAssetInput): Promise<GeneratedAssetResult>`
- Produces `resolveClipAssetPath(assetId: string, config: LocalRuntimeConfig): string`

**Implementation requirements:**
- Default runtime root is `D:\CodexWorkplace\asmr_director_runtime`.
- Default voice pack path is `<runtimeRoot>\voice-packs\default\voice-pack.json`.
- Default clip asset root is `<runtimeRoot>\assets\clips\app`.
- Asset IDs are safe path segments and include clip ID plus a timestamp or random suffix.
- `resolveClipAssetPath` rejects path traversal.

## Task 2: GPT-SoVITS Provider

**Files:**
- Create: `apps/web/src/lib/asmr/gpt-sovits-provider.ts`
- Test: `apps/web/src/lib/asmr/gpt-sovits-provider.test.ts`

**Interfaces:**
- Consumes `VoicePack`
- Produces `buildGptSovitsRequest(clip: TimelineClip, voicePack: VoicePack): GptSovitsRequest`
- Produces `requestGptSovitsWav(input: RequestGptSovitsWavInput): Promise<ArrayBuffer>`

**Implementation requirements:**
- Reject non-voice clips with a user-facing error.
- Use `clip.text` as GPT-SoVITS `text`.
- Use voice pack prompt text as GPT-SoVITS `prompt_text`.
- Use stable conservative params from `docs/tts-voice-pack-mvp-strategy.zh.md`: `batch_size: 1`, `parallel_infer: false`, `split_bucket: false`, `text_split_method: "cut5"`, `prompt_lang: "ja"`, `text_lang: "all_zh"`, `speed_factor: 0.86`.
- Send UTF-8 JSON through `fetch`, not PowerShell or query strings.
- Treat non-2xx responses and empty audio bodies as provider failures.

## Task 3: Local Generation and Asset API Routes

**Files:**
- Create: `apps/web/src/app/api/generation/clip/route.ts`
- Create: `apps/web/src/app/api/assets/clip/[assetId]/route.ts`
- Test: helper-level coverage through Task 1 and Task 2; route behavior verified by integration/manual checks.

**Interfaces:**
- `POST /api/generation/clip` accepts `{ project, clipId, reason }`.
- Success response: `{ asset: { assetId, uri, duration } }`.
- Failure response: `{ error: string }` with appropriate HTTP status.
- `GET /api/assets/clip/:assetId` returns `audio/wav`.

**Implementation requirements:**
- Validate the project with the existing `AsmrProjectSchema`.
- Find the selected clip via `flattenClips`.
- Only allow `voice` clips in Step 7.
- Save WAV to the local runtime asset store.
- Return only stable `asset://clip/<assetId>` to the client.
- Never expose local absolute paths in JSON responses.

## Task 4: Browser Real Generation Bridge and Playback Resolver

**Files:**
- Create: `apps/web/src/lib/asmr/local-generation-bridge.ts`
- Modify: `apps/web/src/lib/asmr/generation-view.ts`
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Test: `apps/web/src/lib/asmr/local-generation-bridge.test.ts`
- Test: `apps/web/src/lib/asmr/generation-view.test.ts`

**Interfaces:**
- Produces `createLocalGenerationBridge(options?: LocalGenerationBridgeOptions): GenerationBridge`
- Emits queued/generating/succeeded/failed/canceled updates using existing `GenerationJobUpdate`.
- Converts `asset://clip/<assetId>` to `/api/assets/clip/<assetId>` for playback.

**Implementation requirements:**
- Keep selected clip control labels unchanged.
- Use local bridge by default unless `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock`.
- Generate job snapshots client-side because the first local API is synchronous.
- Preserve cancel behavior by ignoring stale updates if cancellation wins locally.
- Let Preview Layer play both `mock://asset/...` and `asset://clip/...`.

## Task 5: Verification and Docs

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

**Verification commands:**
- `npm.cmd run test --prefix apps/web`
- `npm.cmd run lint --prefix apps/web`
- `npm.cmd run build --prefix apps/web`
- Manual check with GPT-SoVITS API running: select a voice clip, click `生成`, confirm `asset://clip/...` is written, and Preview Layer plays a real WAV.

**Documentation requirements:**
- If manual GPT-SoVITS runtime is unavailable, state that Step 7 code path is implemented but manual real-provider verification is blocked.
- If manual generation works, update Step 7 status and archive exact generated asset behavior.
