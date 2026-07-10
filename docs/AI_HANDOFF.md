# AI ASMR Studio Handoff

Last updated: 2026-07-10

Read this first when resuming the project after context compaction or as a new AI agent. This is the high-signal handoff. For history and rationale, read `docs/project-archive.md`.

## Workspace Location

Primary Codex desktop workspace path:

- `D:\CodexWorkplace\asmr_director`

Current feature work is in the primary workspace:

- `D:\CodexWorkplace\asmr_director`
- Branch at the time of this handoff: `master`

Treat the repository root as the source of truth if the project is opened from another environment. The local runtime lives outside git under `D:\CodexWorkplace\asmr_director_runtime`.

## Product North Star

This project is an **AI ASMR director console**, not a generic AI ASMR generator.

The user should receive an editable sound project: structured timeline, storyboard, emotional beats, binaural positioning, generation metadata, validation, import/export, and eventually local regeneration. The durable product moat is the director layer and Timeline DSL, not a specific TTS or SFX model.

## Current State

The app is a Next.js frontend prototype at `apps/web`.

Current user-facing capabilities:

- Renders the "雨夜睡前陪伴" demo project from a validated ASMR Project JSON / Timeline DSL.
- Shows the C+ Project Shell: collapsible left project rail, top workspace status/action bar, center editor, and right project details dock.
- Lets the left project rail and right project details dock collapse independently.
- `专注编辑` collapses both side regions together; when both sides are collapsed, clicking it again expands both sides.
- Keeps project-level operations `导出`, `载入`, and `重置` in the workspace header.
- Shows the approved C hybrid lightweight preview layer in the right project details dock.
- Allows selecting clips from Storyboard or Timeline.
- Shows lightweight generation-status dots on Timeline clips.
- Allows editing selected clip fields in Inspector.
- Shows the selected clip asset slot in Inspector.
- Syncs edits across Storyboard, Timeline, Inspector, Validation Panel, Project Details Dock, workspace summaries, Preview Layer, and Export JSON.
- Validates current project live via Zod schema.
- Highlights selected Clip Inspector fields when their schema validation issues map to editable inputs.
- Shows compact inline field messages while keeping the global Validation Panel as the full issue list.
- Shows voice-only Director Actions in Clip Inspector: `更柔`, `更近`, `左耳`, `右耳`, `停顿`, `降低`.
- Shows compact Timing Actions for the selected clip: `开始 -0.5秒`, `开始 +0.5秒`, `时长 -0.5秒`, `时长 +0.5秒`.
- Exports current project JSON from the workspace header.
- Autosaves current project to browser `localStorage`.
- Restores saved project on reload.
- Imports pasted JSON if schema-valid.
- Rejects invalid import JSON without replacing current project.
- Resets to the built-in demo project.
- Uses Chinese-first interface copy with short, clear button names while keeping technical abbreviations such as `ASMR`, `JSON`, `dB`, `LUFS`, and `seed`.
- Adds a local real Generation Bridge for selected voice clips, using mock only when `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock`.
- Keeps runtime generation job state outside `AsmrProject` and out of exported project JSON.
- Commits only final `asset_generated` / `asset_failed` state and final asset metadata into the durable project.
- Resolves `mock://asset/<clipId>/<jobId>` URIs to playable local mock audio at runtime.
- Resolves `asset://clip/<assetId>` URIs to `/api/assets/clip/<assetId>` for local generated WAV playback.
- Exposes selected clip `生成`, `重生成`, `重试`, and `取消` controls in Inspector.
- Enables selected clip preview in the right Preview Layer for both mock assets and local real `asset://clip/...` assets. Real project-mix preview is the current Roadmap Step 9 target.
- Generates local semi-real WAV assets for `breath`, `sfx`, and `ambience` clips through the same selected-clip `生成` / `重生成` flow.

Current product status: roadmap Steps 7 and 8 are implemented. Voice clips use local GPT-SoVITS; breath, SFX, and ambience clips use the local procedural WAV renderer. All generated clips write stable `asset://clip/...` references into Project JSON and are served through the local clip asset playback API.

Roadmap Step 9 still needs real project-mix rendering/export. Step 10 still covers real waveform rendering, cloud persistence, auth, billing, collaboration, and production export flow.

## Real Generation Runtime Notes

2026-07-06 manual runtime proof:

- Runtime root: `D:\CodexWorkplace\asmr_director_runtime`.
- GPT-SoVITS repo: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`.
- GPT-SoVITS upstream: `https://github.com/RVC-Boss/GPT-SoVITS.git`; local checked commit `bf81cdb`; root code license observed locally is MIT. See `docs/THIRD_PARTY_RUNTIMES.md`.
- Python env: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone`.
- API command used from the GPT-SoVITS repo:

```powershell
D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

- Local API endpoint: `http://127.0.0.1:9880/tts`.
- Voice pack: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\voice-pack.json`.
- Reference audio: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\reference.wav`, converted from the user's `D:\temp\音频.MP3`.
- ASR output for reference text: `D:\CodexWorkplace\asmr_director_runtime\asr\output\reference-input.list`.
- Current prompt text is Japanese ASR text:

```text
助けてくれたのかなあの時はありがとう今は財布持ってないから昼休みに非常階段に来てもらって
```

- Current voice pack language settings: `promptLanguage: "ja"`, `textLanguage: "zh"`; manual longer Chinese tests used `text_lang: "all_zh"`.
- Faster Whisper ASR model is downloaded under `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3`.
- Model file check on 2026-07-06: `model.bin` is `3,087,284,237` bytes; no `.incomplete` or `.lock` files remained; ASR successfully produced the Japanese transcript above.
- Successful single real TTS test: `D:\CodexWorkplace\asmr_director_runtime\assets\clips\manual-test-prompt-transcribed-ja-serial.wav`, duration `5.26s`.
- Successful manual "workbench-like" multi-clip ASMR test:
  - Mix: `D:\CodexWorkplace\asmr_director_runtime\assets\mixes\workbench-asmr-test-2026-07-06.wav`.
  - Manifest and clip WAVs: `D:\CodexWorkplace\asmr_director_runtime\assets\clips\workbench-asmr-test-2026-07-06\manifest.json`.
  - Duration: `59.53s`, format `32kHz mono PCM WAV`.
  - It was generated as six real GPT-SoVITS voice clips, then concatenated with short silences. This is a manual runtime proof, not product-integrated Step 9 project mixing.

Known runtime lessons:

- In GPT-SoVITS, `prompt_text` is the transcript of the reference audio, not the text to synthesize. The actual generated content is `text`.
- A Japanese reference audio should use a Japanese prompt transcript and `prompt_lang: "ja"` / possibly `all_ja`.
- Fake Chinese prompt text against Japanese reference audio produced poor / unstable output.
- PowerShell pipeline encoding can corrupt Chinese request text into `?`; send JSON through Python with proper UTF-8 handling or Unicode escapes.
- On the user's RTX 3060 Laptop GPU, GPT-SoVITS parallel inference can hit CUDNN memory allocation failures. A stable test path used `parallel_infer: false`, `split_bucket: false`, `batch_size: 1`, and API restart before generation.
- C drive space has been critically low. Keep Hugging Face, ModelScope, Torch, temp files, generated assets, and runtime models on D drive.
- Cleared C drive Hugging Face / Torch / pip caches once during this work. Do not assume C drive has enough headroom.

2026-07-07 product integration:

- Roadmap Step 7 is now wired into the app for voice clips.
- Default local runtime config:
  - Runtime root: `D:\CodexWorkplace\asmr_director_runtime`.
  - GPT-SoVITS URL: `http://127.0.0.1:9880`.
  - Voice pack path: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\voice-pack.json`.
  - App clip asset root: `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`.
- Environment overrides:
  - `ASMR_DIRECTOR_RUNTIME_ROOT`
  - `ASMR_GPT_SOVITS_URL`
  - `ASMR_VOICE_PACK_PATH`
  - `ASMR_CLIP_ASSET_ROOT`
  - `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` switches the UI back to the mock bridge.
- App routes:
  - `POST /api/generation/clip` accepts `{ project, clipId, reason }`, validates the project, only allows voice clips, calls GPT-SoVITS, saves a WAV, and returns `{ asset }`.
  - `GET /api/assets/clip/[assetId]` serves local generated clip WAV bytes as `audio/wav`.
- The browser-side local bridge emits the same queued/generating/succeeded/failed/canceled update shapes as the previous mock bridge. Runtime `jobId` and progress still never enter Project JSON.
- A generated voice clip stores only final asset metadata and a stable `asset://clip/<assetId>` URI in Project JSON.
- Playback resolution:
  - `asset://clip/<assetId>` -> `/api/assets/clip/<assetId>`
  - `mock://asset/<clipId>/<jobId>` -> runtime mock WAV data URL
- Verified generated app asset:
  - `asset://clip/voice_001_20260706T211523064Z_d3b95513`
  - Playback response: `audio/wav`, `241,964` bytes, WAV header `RIFF`.
- Cancel limitation for Step 7: cancellation is client-side best effort for the synchronous local provider. The UI cancels local commit / ignores late success, but GPT-SoVITS itself is not interrupted after a request is already sent.

2026-07-07 multi-type generation integration:

- Roadmap Step 8 is now wired into the app for non-voice clips.
- Non-voice provider: `apps/web/src/lib/asmr/procedural-audio.ts`.
- Supported procedural clip types:
  - `breath`: soft noise shaped with inhale/exhale envelopes.
  - `sfx`: friction noise for cloth / blanket / rubbing labels, with a tap-like impulse branch for future tapping labels.
  - `ambience`: rain-like continuous bed plus sparse droplet ticks.
- `apps/web/src/lib/asmr/local-clip-generation.ts` now exports `generateLocalClip`:
  - `voice` routes to GPT-SoVITS.
  - `breath`, `sfx`, and `ambience` route to the procedural renderer.
  - `generateLocalVoiceClip` remains as a compatibility wrapper.
- `POST /api/generation/clip` calls `generateLocalClip`, so the existing browser bridge and Inspector generation button work for voice and non-voice clips.
- Verified generated assets:
  - `asset://clip/breath_001_20260706T213815920Z_b55ae7b8`, playback `audio/wav`, `153,644` bytes, WAV header `RIFF`.
  - `asset://clip/sfx_blanket_001_20260706T213816276Z_0089677d`, playback `audio/wav`, `217,644` bytes, WAV header `RIFF`.
- Procedural generation is intentionally a local semi-real preview provider, not final studio-quality sound design. It exists to make the timeline contract real enough for Step 9 mixing.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/app/api/generation/clip/route.ts` runs selected voice clip generation through the local provider and returns stable asset metadata.
- `apps/web/src/app/api/assets/clip/[assetId]/route.ts` serves local generated clip WAV bytes for playback.
- `apps/web/src/components/studio/studio-app.tsx` owns editable project state, runtime generation state, bridge callbacks, export, import, autosave, reset, validation, selected clip state, playback, director presets, and timing nudges. It uses the local real bridge by default and the mock bridge only when `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock`.
- `apps/web/src/components/studio/project-workspace.tsx` composes the C+ workspace shell around the editor panels.
- `apps/web/src/components/studio/project-workspace-header.tsx` shows workspace status, project summary, focus controls, and project-level `导出` / `载入` / `重置` actions.
- `apps/web/src/components/studio/project-rail.tsx` renders the collapsible left project rail.
- `apps/web/src/components/studio/project-details-dock.tsx` renders the collapsible right project details dock and hosts the Preview Layer surface.
- `apps/web/src/components/studio/project-workspace-badge.tsx` provides compact workspace badge display helpers.
- `apps/web/src/components/studio/preview-layer-panel.tsx` renders the lightweight Preview Layer and selected clip mock playback control.
- `apps/web/src/components/studio/preview-waveform-placeholder.tsx` renders the non-audio waveform placeholder.
- `apps/web/src/components/studio/generation-slot-list.tsx` renders project/track/clip asset slot summaries.
- `apps/web/src/components/studio/storyboard-panel.tsx` renders chronological clip cards.
- `apps/web/src/components/studio/timeline-panel.tsx` renders fixed track timeline blocks and compact generation-status dots.
- `apps/web/src/components/studio/clip-inspector.tsx` edits selected clip fields, displays field-level validation state, exposes Director Actions, Timing Actions, selected clip asset slot, and selected clip generation controls.
- `apps/web/src/components/studio/validation-panel.tsx` shows live schema issues.
- The former `project-header.tsx` and `project-controls.tsx` were deleted; do not reintroduce project-level actions there.

Domain/data:

- `apps/web/src/lib/asmr/schema.ts` defines the Zod schema and TypeScript types for ASMR Project JSON / Timeline DSL.
- `apps/web/src/lib/asmr/mock-project.ts` is the canonical "雨夜睡前陪伴" demo project.
- `apps/web/src/lib/asmr/validate.ts` wraps schema parsing and clip flattening.
- `apps/web/src/lib/asmr/view-model.ts` contains display helpers and `flattenClips`.
- `apps/web/src/lib/asmr/ui-copy.ts` contains shared Chinese UI labels and validation-message translations.
- `apps/web/src/lib/asmr/edit-project.ts` contains immutable clip update helpers, selected-clip timing nudges, validation issue formatting, and selected-clip field issue mapping.
- `apps/web/src/lib/asmr/project-persistence.ts` contains import parsing, JSON serialization, and localStorage helpers.
- `apps/web/src/lib/asmr/director-presets.ts` contains deterministic Director Action preset behavior for voice clips.
- `apps/web/src/lib/asmr/project-summary.ts` derives project-level summary metrics for the workspace shell.
- `apps/web/src/lib/asmr/generation-summary.ts` derives preview-layer generation counts and asset slots from `AsmrProject` without mutating the schema or export contract.
- `apps/web/src/lib/asmr/generation-bridge.ts` defines the backend-shaped generation bridge contract.
- `apps/web/src/lib/asmr/mock-generation-bridge.ts` implements the local mock bridge.
- `apps/web/src/lib/asmr/generation-project-state.ts` commits final generation success/failure into `AsmrProject`.
- `apps/web/src/lib/asmr/generation-runtime.ts` manages runtime-only generation jobs keyed by `jobId` and `clipId`.
- `apps/web/src/lib/asmr/generation-view.ts` merges durable project data and runtime generation state into UI-ready controls and preview summaries.
- `apps/web/src/lib/asmr/mock-asset-resolver.ts` resolves `mock://` asset URIs to runtime-only playable WAV data URLs.
- `apps/web/src/lib/asmr/local-runtime-config.ts` reads local runtime paths and provider URL with D-drive defaults and environment overrides.
- `apps/web/src/lib/asmr/voice-pack.ts` loads and validates the GPT-SoVITS voice pack and prompt transcript.
- `apps/web/src/lib/asmr/gpt-sovits-provider.ts` maps voice clips into GPT-SoVITS `/tts` payloads and requests WAV bytes.
- `apps/web/src/lib/asmr/local-asset-store.ts` writes local generated WAVs and resolves safe `asset://clip/...` IDs.
- `apps/web/src/lib/asmr/procedural-audio.ts` renders deterministic local WAV files for breath, SFX, and ambience clips.
- `apps/web/src/lib/asmr/local-clip-generation.ts` ties project clip lookup, voice pack loading, GPT-SoVITS voice generation, procedural non-voice generation, and asset saving together.
- `apps/web/src/lib/asmr/local-generation-bridge.ts` implements the browser-side bridge for the local generation API.
- `apps/web/src/lib/asmr/playback-asset-resolver.ts` resolves both `asset://clip/...` and `mock://asset/...` playback URIs.

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/director-presets.test.ts`
- `apps/web/src/lib/asmr/ui-copy.test.ts`
- `apps/web/src/lib/asmr/project-summary.test.ts`
- `apps/web/src/lib/asmr/generation-summary.test.ts`
- `apps/web/src/lib/asmr/mock-generation-bridge.test.ts`
- `apps/web/src/lib/asmr/generation-project-state.test.ts`
- `apps/web/src/lib/asmr/generation-runtime.test.ts`
- `apps/web/src/lib/asmr/generation-view.test.ts`
- `apps/web/src/lib/asmr/mock-asset-resolver.test.ts`
- `apps/web/src/lib/asmr/local-runtime-config.test.ts`
- `apps/web/src/lib/asmr/voice-pack.test.ts`
- `apps/web/src/lib/asmr/local-asset-store.test.ts`
- `apps/web/src/lib/asmr/gpt-sovits-provider.test.ts`
- `apps/web/src/lib/asmr/procedural-audio.test.ts`
- `apps/web/src/lib/asmr/local-clip-generation.test.ts`
- `apps/web/src/lib/asmr/local-generation-bridge.test.ts`
- `apps/web/src/lib/asmr/playback-asset-resolver.test.ts`

Docs:

- `docs/ROADMAP.md` is the canonical top-level roadmap and the only hard source for product sequence.
- `docs/PROJECT_MANAGEMENT.md` defines project collaboration and roadmap-following rules.
- `docs/THIRD_PARTY_RUNTIMES.md` records external runtime projects, licenses, and asset ownership boundaries.
- `docs/AI_HANDOFF.md` is the high-signal recovery entrypoint.
- `docs/project-archive.md` is the running project archive.
- `docs/asmr导演早期设计.md` is the original product/technical vision.
- `docs/superpowers/specs/` contains approved specs.
- Starting 2026-06-17, approved specs should include a Chinese companion file named `*.zh.md` for user review and context recovery.
- `docs/superpowers/plans/` contains implementation plans.

## Data Model Facts

Fixed timeline tracks:

- `voice`
- `breath`
- `sfx`
- `ambience`
- `post_processing`

Important validation rules:

- Timeline must contain exactly one of each fixed track.
- `position.pan` must be between `-1` and `1`.
- Clip `duration` must be positive.
- Clip start/end must be within project duration.
- Emotion curve points must have `end > start`.
- Emotion curve start/end must be within project duration.

Generation persistence rules:

- Runtime `jobId`, progress, queued/generating/canceling state, and callback state stay outside `AsmrProject`.
- Successful mock generation commits `asset_generated` plus final asset metadata with a `mock://asset/<clipId>/<jobId>` URI.
- Successful local voice and non-voice generation commits `asset_generated` plus final asset metadata with an `asset://clip/<assetId>` URI.
- Normal generation failure commits `asset_failed` and an error.
- Failed regeneration preserves a previous generated asset.
- `mock://` URIs are resolved into data URLs only at runtime for playback.
- `asset://clip/...` URIs are resolved into local API playback URLs only at runtime for playback.
- Exported JSON must not contain browser `blob:` URLs, `data:audio` URLs, runtime progress, or runtime job state.

localStorage key:

- `ai-asmr-studio:v0:project`

## Current Verification

Use these commands from repo root:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Latest verified state before this handoff:

- `npm.cmd run test --prefix apps/web`: 22 test files passed, 124 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed.
- `npm.cmd run build --prefix apps/web -- --webpack`: passed. The default Turbopack build is not the verification command on this Windows environment because Turbopack reports an unsupported native binding and asks to use Webpack.
- Browser verification used a local dev server at `http://localhost:3000/` and a temporary headless Chrome controlled through CDP. The in-app browser was able to display the page but its snapshot / click control was unreliable in this session.
- Browser verification passed for hydrated UI, selecting `voice_001`, selected clip `生成`, real local GPT-SoVITS generation to `asset://clip/voice_001_20260706T211523064Z_d3b95513`, Project JSON/localStorage containing the stable `asset://clip/...` reference, `重生成` after success, playback API returning `audio/wav` with `RIFF` header, and no page error/warning logs.
- Step 8 browser verification passed for `breath_001` and `sfx_blanket_001`: both generated through the workbench UI, wrote `asset://clip/...`, and served playable `audio/wav` files with `RIFF` headers.

Run locally:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Open:

```text
http://localhost:3000/
```

## Recent Commit Trail

Most recent generation bridge commits:

- `aed50b5 fix: use flattened clips in generation view`
- `2bee9bc fix: harden mock generation controls`
- `a024267 feat: wire mock generation controls`
- `acc91b9 test: harden mock asset WAV headers`
- `18e29c8 feat: resolve mock audio assets`
- `3bf98ae fix: handle terminal generation jobs`
- `863ce65 feat: derive runtime generation view`
- `848f8d6 feat: commit generated assets to project state`
- `7c2f429 fix: make mock generation cancellation immediate`
- `df9b14d fix: align mock generation bridge contract`
- `bf2ec6c feat: add mock generation bridge`

Recent preview/workspace commits:

- `44b9abf fix: expose timeline generation status accessibly`
- `04e3ce4 feat: show lightweight generation status`
- `59f373e feat: wire preview layer into project shell`
- `91cca6e feat: add preview layer components`
- `ad85af5 fix: align preview summary public types`
- `8dbd589 fix: refine preview generation summary`
- `b34b2c4 feat: derive preview generation summary`
- `1fffef3 docs: plan preview layer implementation`
- `f74568c docs: design preview layer before real audio`
- `b29129f feat: add collapsible project workspace shell`
- `154f973 feat: localize studio ui copy`
- `6dbee1a feat: add inspector timing actions`
- `cbfee19 feat: highlight invalid inspector fields`
- `b207728 feat: persist studio projects locally`
- `8d6b4c1 feat: add v0 editing loop`

## Recommended Next Work

Recommended next step: **Roadmap Step 9, 真实项目混音与导出**.

Why this next:

- Step 7 proved voice clip generation.
- Step 8 proved non-voice clip generation for breath, SFX, and ambience using the same `asset://clip/...` contract.
- The next missing product capability is to combine generated clip assets according to timeline timing into one real project WAV.

Concrete next scope:

- Add a local project mix renderer that reads generated `asset://clip/...` files from the runtime asset store.
- Place each clip by `start` / `duration` and apply basic gain, fades, and pan-aware mono/stereo handling.
- Save the mix as `asset://mix/...` or the existing project mix reference shape, without serializing local paths.
- Wire full-project preview / WAV download to the real mix output.
- Keep clip-level generation independent; Step 9 should consume generated assets, not regenerate them.

## Initial Product Path

The canonical roadmap is `docs/ROADMAP.md`.

Do not treat this file as a competing roadmap. Current summary only:

- Completed: roadmap steps 1-8.
- Current / next: roadmap Step 9, 真实项目混音与导出.
- Pending after Step 9: Roadmap Step 10 product workflow hardening.

When the user asks “what next?”, first read `docs/ROADMAP.md`, then compare it with current project status before answering.

## Next Work Protocol

When the user asks "what next?", "what should we do now?", "理论上下一步是什么？", or any equivalent roadmap question, do not answer from fresh intuition alone.

First read `docs/ROADMAP.md`, `docs/PROJECT_MANAGEMENT.md`, and this file, then do a fresh project reality check before recommending work. At minimum, check current git status/recent commits and inspect the relevant files or app behavior when the route depends on implementation details.

Answer from `docs/ROADMAP.md`, `Recommended Next Work`, and current project reality using this shape:

```text
Documented path points to:
Current project reality check:
Already done:
Recommended next step:
Route adjustment needed?:
Why not the other options yet:
Needed doc/plan/implementation step:
```

If the documented path feels stale, conflicts with current implementation, or the implementation work reveals a design gap, say that explicitly and propose a documentation update before changing direction. Do not silently replace the roadmap with a newly invented one, and do not blindly follow stale roadmap steps when current project facts show they need revision.

## Do Not Do Yet

Do not jump around the canonical route into Step 10 / productization work before completing current Roadmap Step 9:

- Backend project persistence.
- Auth or cloud sync.
- Real waveform rendering from generated audio.
- Full DAW drag/drop timeline.
- Payment or publishing flows.
- New mock-only or bridge-only top-level milestones that postpone the canonical roadmap.
- Turning adapter / API / provider wrapper work into a new top-level roadmap gate without user approval.

Real project-mix rendering/export is no longer "Do Not Do Yet"; it is the current Roadmap Step 9. The Step 9 implementation should stay scoped to consuming existing generated clip assets, rendering a real mix, wiring full-project preview, and returning a real WAV download.

## Working Rules For Future Agents

- Speak Chinese to the user unless they ask otherwise.
- Treat `docs/ROADMAP.md` as the only top-level roadmap source.
- Read `docs/PROJECT_MANAGEMENT.md` before answering next-step / roadmap questions.
- Do not insert, rename, or reorder top-level roadmap steps without user approval.
- If the roadmap looks stale, explain the mismatch and propose a roadmap edit instead of silently changing direction.
- Prefer existing schema and helpers over ad hoc object manipulation.
- Keep Project Workspace, Storyboard, Timeline, Inspector, Validation Panel, Project Details Dock, Preview Layer, and Export JSON driven by the same `AsmrProject` state plus runtime-only UI state.
- Keep runtime generation state out of `AsmrProject`, localStorage project JSON, and export JSON.
- Use TDD for behavior changes in `apps/web/src/lib/asmr/`.
- After meaningful UI changes, run browser verification at desktop and mobile widths.
- Preserve the Studio Console visual direction: professional tool first, restrained ASMR atmosphere second.
- Keep docs updated when changing product direction, data contracts, or next-step recommendations.
- For new approved specs, keep the English spec and add a Chinese companion `*.zh.md` version.
- Treat roadmap questions as document-synchronized and project-synchronized work: check `docs/ROADMAP.md`, `Recommended Next Work`, `Next Work Protocol`, and current repo/app reality before recommending the next task.
