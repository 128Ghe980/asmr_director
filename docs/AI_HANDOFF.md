# AI ASMR Studio Handoff

Last updated: 2026-07-06

Read this first when resuming the project after context compaction or as a new AI agent. This is the high-signal handoff. For history and rationale, read `docs/project-archive.md`.

## Workspace Location

Primary Codex desktop workspace path:

- `D:\CodexWorkplace\asmr_director`

Current feature work was completed in the Superpowers worktree:

- `C:\Users\Yuki1\.config\superpowers\worktrees\asmr_director\preview-layer-before-real-audio`
- Branch: `codex/preview-layer-before-real-audio`

Treat the repository root as the source of truth if the project is opened from another environment.

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
- Adds a mock-first Generation Bridge for selected clips.
- Keeps runtime generation job state outside `AsmrProject` and out of exported project JSON.
- Commits only final `asset_generated` / `asset_failed` state and final asset metadata into the durable project.
- Resolves `mock://asset/<clipId>/<jobId>` URIs to playable local mock audio at runtime.
- Exposes selected clip `生成`, `重生成`, `重试`, and `取消` controls in Inspector.
- Enables selected clip mock preview in the right Preview Layer while keeping project-mix preview out of scope.

Current product status: the checked-in Next.js app still uses the mock Generation Bridge in the UI. Real local TTS has now been proven manually through a GPT-SoVITS runtime, but it is not yet wired into the app's selected-clip generation control, durable asset flow, or Preview Layer.

There is still no checked-in backend route, real SFX generation, real ambience generation, real waveform rendering, cloud persistence, auth, billing, collaboration, or production export flow.

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

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/components/studio/studio-app.tsx` owns editable project state, runtime generation state, bridge callbacks, export, import, autosave, reset, validation, selected clip state, mock playback, director presets, and timing nudges.
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
- Normal generation failure commits `asset_failed` and an error.
- Failed regeneration preserves a previous generated asset.
- `mock://` URIs are resolved into data URLs only at runtime for playback.
- Exported JSON must not contain browser `blob:` URLs, `data:audio` URLs, runtime progress, or runtime job state.

localStorage key:

- `ai-asmr-studio:v0:project`

## Current Verification

Use these commands from repo root:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web
```

Latest verified state before this handoff:

- `npm.cmd run test --prefix apps/web`: 13 test files passed, 92 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed.
- `npm.cmd run build --prefix apps/web`: passed.
- Browser verification used a local dev server at `http://localhost:3000/` and Playwright with system Chrome, because the in-app browser Node runtime returned `failed to write kernel assets`.
- Browser verification passed for Chinese UI text, selected clip `生成`, progress and `取消`, mock success to `重生成`, enabled selected clip preview playback, local saved project containing `mock://asset/`, no runtime job state in local saved project, independent/focus collapse, desktop overflow, collapsed desktop overflow, 390x900 mobile overflow, and no console/page errors.

Run locally:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
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

Recommended next step: **Continue Real Generation MVP by wiring the proven local GPT-SoVITS runtime into the workbench generation flow**.

Why this next:

- The UI already has a stable generation/mix asset surface.
- The generation interaction loop, asset references, preview surface, and project mix skeleton are in place.
- The next useful project step must produce at least one real playable generated audio result, not another mock-only bridge milestone.

Concrete next scope:

- Prioritize one voice clip generation path.
- Use the existing generation contract and asset reference model.
- Add adapter / API / provider wrapper code only as an implementation detail of this work.
- Reuse the proven local GPT-SoVITS runtime as the first real provider.
- Produce a real playable audio file through the selected voice clip generation control, not only through manual scripts.
- Persist only the stable asset reference in project JSON.
- Play the result through the existing selected-clip preview / Preview Layer flow.
- Preserve failure, retry, and cancellation behavior.

## Initial Product Path

The canonical roadmap is `docs/ROADMAP.md`.

Do not treat this file as a competing roadmap. Current summary only:

- Completed: roadmap steps 1-6.
- Current / next: Real Generation MVP. Manual local GPT-SoVITS generation has been proven; product integration is still pending.
- Pending: the remaining post-MVP generation, real mix/export, and product workflow hardening work.

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

Do not jump straight into:

- Backend project persistence.
- Auth or cloud sync.
- Real project-mix rendering.
- Real waveform rendering from generated audio.
- Full DAW drag/drop timeline.
- Payment or publishing flows.
- New mock-only or bridge-only top-level milestones that postpone the canonical roadmap.
- Turning adapter / API / provider wrapper work into a new top-level roadmap gate without user approval.

Those are later versions. The near-term path should keep proving the editable Timeline DSL and director workflow.

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
