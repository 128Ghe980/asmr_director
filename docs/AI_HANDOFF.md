# AI ASMR Studio Handoff

Last updated: 2026-09-08

Read this first when resuming the project after context compaction or as a new AI agent. This is the high-signal handoff. For history and rationale, read `docs/project-archive.md`.

## Workspace Location

Primary Codex desktop workspace path:

- `D:\CodexWorkplace\asmr_director`

Current feature work is in the primary workspace:

- `D:\CodexWorkplace\asmr_director`
- Branch at the time of this handoff: `codex/step10-product-workflow`

Treat the repository root as the source of truth if the project is opened from another environment. The local runtime lives outside git under `D:\CodexWorkplace\asmr_director_runtime`.

## Product North Star

This project is an **AI ASMR director console**, not a generic AI ASMR generator.

The user should receive an editable sound project: structured timeline, storyboard, emotional beats, binaural positioning, generation metadata, validation, import/export, and eventually local regeneration. The durable product moat is the director layer and Timeline DSL, not a specific TTS or SFX model.

## Current Priority (2026-09-08)

The user accepted **AI 创意策划 / LLM Planner V1** for this iteration on 2026-09-08 ("暂时算是过了") and asked to record/push the milestone, then prepare VoxCPM2 integration into real product generation. Immediate priority returns to **人声导演与真实 ASMR 音效质量 V1**. Its experimental conclusions remain valid; product integration is not yet implemented. There is no numbered Step 11.

Planner design: `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.md` and `.zh.md`. Accepted milestone `bd0d058` was pushed to `origin/codex/step10-product-workflow` on 2026-09-08.

VoxCPM2 integration preparation is complete: `docs/superpowers/specs/2026-09-08-voxcpm2-product-integration-design.md` and `.zh.md`. The next implementation slice is optional VoxCPM2 generation → candidate comparison → explicit adopt/undo → 48 kHz-compatible remix/export, followed by the selected long-text mode. This is a design and readiness result, not a completed product integration.

Planner implementation is accepted for this iteration; real external DeepSeek generation, section rewrite and project adoption have passed browser acceptance. Local Ollama acceptance remains pending memory recovery as a non-blocking follow-up. The studio has planning/editing views, separate locally saved creative drafts, local Ollama and configured external JSON-mode API options, single-section rewrite/cancel/undo, script download, and safe adoption into a new project. Draft metadata stays outside Project JSON. Do not represent unavailable sound suggestions as generated assets.

New implementation entry points:

- `apps/web/src/components/studio/planner-panel.tsx`: editable planner workflow, local save, request identity/cancellation, in-session undo, script download.
- `apps/web/src/lib/asmr/planner.ts` and `planner-persistence.ts`: creative contracts, deterministic voice-project compilation, independent working draft with original brief.
- `apps/web/src/lib/asmr/planner-provider.ts` and `apps/web/src/app/api/planner/route.ts`: local Ollama / configured JSON-mode API, bounded requests, one structural repair, safe errors and cancellation.
- `project-library.ts`: safe adoption plus validated entry/revision `plannerSource`; replacements clear source and revision restores recover it.
- Voice WAVs now record actual duration; `commitGenerationSuccess(..., { fitVoiceTiming: true })` extends underestimated Planner voice clips and shifts following timing. Only Planner voice generation ignores start-time changes in stale-result fingerprints; other edits remain protected.

Runtime configuration is documented in `apps/web/README.md` and `.env.example`. Default local model is the already installed `qwen3:1.7b`; default context is 8192, GPU layers -1 (automatic), explicit 0 enables CPU. The user has now configured and authorized their external DeepSeek V4 API.

Configuration follow-up: the user filled the key locally in Git-ignored `apps/web/.env.local`, using the official base URL, `deepseek-v4-pro`, and default provider `api`. GET `/api/planner` reports external configuration complete. Next dev automatically loaded the change; browser refresh updated the catalog without a service restart. There is currently no frontend credentials form. Saved drafts preserve their selected provider. Do not log or echo the key.

Initial Planner implementation verification (2026-09-07, before the UI cleanup below): 34 Vitest files / 260 tests passed, including 9 React StrictMode planner interaction tests with mocked provider HTTP responses. Full ESLint, TypeScript, production webpack build, and `git diff --check` passed. The existing Windows native SWC warning falls back to WASM; the build exits successfully. Browser checks covered form editing, unconfigured-provider and real-provider failure states, cancellation, reload persistence, and 1280px / 390px layouts without horizontal overflow.

Real DeepSeek browser acceptance (2026-09-07, about 22:20–22:25 HKT): the user's deep-night bookstore theme and 180-second target generated 《深夜书店的翻书声》, 6 sections / 380 readable characters. A real section-4 rewrite changed only its spoken text and direction; all other text fields were unchanged. Undo restored every original text field, then manual editing retained the revised text and direction (367 total characters). Adoption created `asmr_planner_20260907_142342`, 6 pending voice clips, estimated 02:55, valid project JSON, with the previous demo preserved and given a safety revision. Reload restored the project, draft and external provider; loading the project source matched every saved text field. The 390px long-draft layout had no horizontal overflow; console error/warn was empty. Two browser Planner POST actions were used; internal repair count and exact upstream token cost were not captured. Export was triggered, but the downloaded JSON contents were not inspected in this browser run; export boundaries remain covered by automated tests. No new audio was generated.

Remaining local verification boundary (2026-09-07): real Ollama generation failed on both GPU and a minimal CPU probe due to memory allocation. Evidence is under `D:\CodexWorkplace\asmr_director_runtime\planner-verification`, especially `real-generation-failure.json` and `cpu-probe-after-build.json`. Earlier automatic approval rejected restarting the task-started Ollama service and starting a separately configured fixture app, reporting only `blocked by policy`; no bypass was attempted. These historical failures do not block the verified external API path. The user's 2026-09-08 acceptance defers local-model acceptance without pretending it succeeded; the bilingual spec records that iteration boundary. One real external sample does not establish general artistic quality. Fixture responses / unit tests are not real LLM evidence.

## UI Information Policy and Current Cleanup (2026-09-07)

The user said the functionality was mostly usable, but the frontend was filled with unnecessary information and notes intended for the development team. Treat this as an explicit product correction inside the current Planner stage, not a new roadmap stage. Default surfaces should contain the current task's actions and creative content. Keep technical data behind optional disclosure controls. Do not reintroduce implementation explanations, marketing copy, workflow step banners or duplicate status messages into the main flow.

Planning now uses a task-focused header and a theme/settings column beside the script on wide screens, stacked on narrow screens. The project details dock and engineering import/export/reset controls belong to project editing only. Scene/character settings, per-section director/sound/performance fields and project-source loading are expandable. The script remains directly editable; rewrite, undo, download and adoption remain available. Required error, save-state and external-transmission/cost messages remain visible when relevant.

The project rail starts collapsed and no longer repeats the current project's header card. On mobile, the collapsed rail is hidden and the header's project button opens it. Editing and preview surfaces remove repeated IDs, status badges, statistics, placeholder waveforms and implementation notes. History, metadata, technical generation fields, non-empty track progress and quality details are expandable; actual generation/mix/analysis failures and actionable validation or audio problems remain visible.

This cleanup changes presentation, not domain/provider/generation behavior. Preserve the user's current 5-section / 203-character draft and existing projects; do not replace it with earlier verification samples or trigger a model call merely to check layout. Cleanup verification: all 260 tests passed; after final markup adjustments, all 9 Planner component cases, full ESLint, TypeScript and the production webpack build passed. Browser checks confirmed draft fields unchanged across reload, planning without the engineering dock, expandable director/rewrite inputs, and editing/preview controls retained at 1280px. At 390px, page width was 380px without horizontal overflow. Final refresh and interactions after 14:56 UTC produced no new error/warn logs; transient 14:47 JSX errors during editing were fixed before final checks. No model generation was triggered for these layout checks.

## Current State

The app is a Next.js frontend prototype at `apps/web`.

Current user-facing capabilities:

- Renders the "雨夜睡前陪伴" demo project from a validated ASMR Project JSON / Timeline DSL.
- Shows task-specific planning/editing views with a collapsible project rail; the right project details dock is rendered only for editing.
- Lets the left project rail and right project details dock collapse independently.
- `专注编辑` collapses both side regions together; when both sides are collapsed, clicking it again expands both sides.
- Keeps project-level operations `导出`, `载入`, and `重置` in the workspace header.
- Shows the approved C hybrid lightweight preview layer in the right project details dock.
- Allows selecting clips from Storyboard or Timeline.
- Shows lightweight generation-status dots on Timeline clips.
- Allows editing selected clip fields in Inspector.
- Exposes the selected clip asset details in the Inspector's expandable technical section.
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
- Enables selected clip preview in the right Preview Layer for both mock assets and local real `asset://clip/...` assets.
- Generates local semi-real WAV assets for `breath`, `sfx`, and `ambience` clips through the same selected-clip `生成` / `重生成` flow.
- Mixes generated `asset://clip/...` assets into a real full-project `asset://mix/...` WAV through the Preview Layer.
- Exposes Preview Layer project-mix controls: `生成整段`, `重混`, `试听`, `WAV`, and `取消`.
- Stores a versioned local multi-project library under `ai-asmr-studio:v1:project-library` and migrates the legacy single-project key.
- Lets users create, switch, duplicate, and delete local projects from the real left-rail project list.
- Keeps at most 12 recovery revisions per project, with manual `留版本` and safety revisions before replacement, reset, restore, and project switching.
- Analyzes real local clip/mix WAV assets through `GET /api/assets/analysis` and renders true 64-bar peak waveforms in Preview Layer.
- Offers expandable right-dock checks for schema validity, clip readiness, mix freshness, WAV analysis, channels, and peak headroom, while keeping actionable failures visible.
- Persists successful mix fingerprints in project-library metadata so stale or unverified mixes remain marked `需重混` after switching or reload.
- Surfaces `本地保存不可用` when browser persistence fails instead of claiming the project is saved.

Current product status: all fixed roadmap Steps 1-10 are implemented. Voice clips still use local GPT-SoVITS; breath, SFX, and ambience clips still use the local procedural WAV renderer. All generated clips write stable `asset://clip/...` references into Project JSON and are served through the local clip asset playback API. Full-project mixes write stable `asset://mix/...` references into `exports[type="wav"]` and are served through the local mix asset playback API. Step 10 adds the local product-management layer without changing the Timeline DSL schema.

The user approved **人声导演与真实 ASMR 音效质量 V1** on 2026-07-13 and prioritized Planner V1 on 2026-09-07. Audio Quality V1 remains an approved unfinished named stage. Independent audio experiments have progressed substantially, but none of the new VoxCPM2, semantic grouping, adaptive pause, or improved spatial recipes are wired into the checked-in app yet.

## Audio Quality V1 Experiment Handoff (2026-09-07)

### Current status boundary

- The experiment assets, scripts, manifests, and listening records live outside Git under `I:\AI\voxcpm2-evaluation`.
- The checked-in product still generates voice through GPT-SoVITS and non-voice clips through the procedural renderer.
- Therefore the stage is `in progress`: a current experimental recipe has been selected, but product integration, stable automation, and real SFX expansion are not complete.

### User-approved direction and constraints

- Prioritize actual audible quality over adding UI or another bridge layer.
- Keep solutions free/local where possible. Paid providers are postponed, and the user cannot provide newly recorded material.
- Keep VoxCPM2 as a user-selectable candidate. For the tested soft Chinese reference, the user judged it substantially better than the current GPT-SoVITS result, but generic `soft` / `whisper` prompts remain too random to count as a stable director action.
- Let users choose the normal/soft reference and Reference-only/reference-text mode in the generation UI instead of hiding those choices.
- Use post-processing for left/right, horizontal/vertical motion, and distance. Direct prompts such as “朝左耳说” and “朝右耳说” produced no audible dry-voice direction and must not be presented as the source of direction.
- The accepted “更近” experiment is a combination: regenerate a lower, more intimate speaking posture, then apply the stronger V2 spatial treatment. The dry regeneration alone did not create a strong physical near-field effect.
- Procedural noise can remain a clearly labelled fallback, but the limited range and realism of ASMR SFX are still an unresolved main-line problem.

### Current best soft-Chinese long-text recipe

Current accepted output:

`I:\AI\voxcpm2-evaluation\listening\longtext-deepseek-class-local-pause-20260904\03_deepseek_class_local_rule.wav`

Use these exact meanings; do not shorten them to the ambiguous phrase “split generation”:

1. VoxCPM2 runs locally from the GGUF runtime with `gpu_layers=0` / low-VRAM mode. The accepted source material used `cfg=2`, `timesteps=10`, and `temperature=1` with `references\soft-16k-s16.wav`. Groups 1–5 came from long-opening runs with `seed=7901` and `max_steps=420`; the true-ending run used `seed=8201` and `max_steps=220`. These seed/cap values record exact sample provenance, not product defaults.
2. Supply the accurate reference transcript with its punctuation replaced by spaces and preserve one trailing ASCII space.
3. The six-group layout was first produced by local Ollama `qwen3:1.7b`; DeepSeek API (`deepseek-v4-pro`) later independently returned the same groups: `1–3 / 4–5 / 6–8 / 9–10 / 11–12 / 13–16`. The short/medium/long boundary classes used in the final pause rule are from DeepSeek. Both models analyze text only; VoxCPM2 generates the audio.
4. For each non-final group, put the **current semantic group at the start**, append the remaining full text, generate the complete long continuation, then keep only that opening semantic group. Do not synthesize the group as an isolated short prompt. In the exact experiment harness, fixed neutral continuation clauses were also appended after the remaining source text so every run stayed long (16 clauses, roughly 177–196 Chinese characters). Whether this padding is necessary is not yet proven and must be tested during product design. Generate the last group as a true ending with natural final punctuation.
5. Main long-opening candidates connect short clauses with Chinese ellipses. The exact seed8201 ending target is `……我会一直陪在这里……不催促你，也不会突然离开，直到困意自然地靠近。`: it keeps an opening ellipsis, a linking ellipsis after “这里”, natural commas, and a terminal full stop.
6. Keep multiple candidates and reject incomplete text, large inhalations, electrical noise, rising pitch, voice drift, or bad seams. A single seed is not a stable capability.
7. The accepted sample is a hybrid: groups 1–4 follow the long-opening rule; group 5 is a manual clean replacement taken from the middle of another continuous long generation because the normal candidate read “一点一点变得轻松” poorly. Groups 1–5 originate from seed7901 long-opening runs (group 5 from the middle of the clause-09-start run), while group 6 uses the accepted seed8201 true ending. These seeds document this sample's provenance; they are not recommended fixed defaults.
8. Only after the voice groups are selected should the whole result receive one loudness adjustment.

Pause rule selected by the user:

- In the accepted class-local output, retiming applies only to the five joins **between semantic groups**. The ten clause pauses inside those groups remain exactly as VoxCPM2 generated them; they are measurement/fallback evidence, not retiming targets. Do not silently expand this recipe to all 15 clause boundaries.
- DeepSeek classifies each boundary as short, medium, or long. It does not choose milliseconds directly.
- Class ranges/defaults are: short `120–260 ms` / default `180 ms`; medium `261–480 ms` / default `350 ms`; long `481–900 ms` / default `600 ms`.
- For a join, separately average the real internal short-clause pauses in the preceding and following groups, then average those two group means equally.
- If that value is inside the DeepSeek class range, use it. Otherwise use the mean of other measured natural pauses that have the same class and already lie inside its range. If none exist, use the class default. A measured `0 ms` participates in a group mean but is not a same-class fallback sample.
- All five semantic-group joins in the accepted text were classified medium. The raw local values were `260 / 0 / 200 / 440 / 290 ms`; the first three were outside the medium range and had no valid same-class fallback, so the final joins are `350 / 350 / 350 / 440 / 290 ms`.
- The user found both the fixed-350 and local versions natural and selected the local version overall because it is more adaptive.

Primary records:

- Chinese/English evaluation reports: `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.zh.md` and `.md`.
- Key listening conclusions and evidence index: `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`. It is not a turn-by-turn log of every experiment from 2026-08-12 through 2026-09-03; use the package READMEs and JSON evidence for those details.
- Accepted-package README/READY: `I:\AI\voxcpm2-evaluation\listening\longtext-deepseek-class-local-pause-20260904`.
- DeepSeek classifications: `I:\AI\voxcpm2-evaluation\evidence\longtext-deepseek-v4-pause-classes.json`.
- Pause measurement: `I:\AI\voxcpm2-evaluation\evidence\longtext-deepseek-class-local-pause-measurement.json`.
- Source-generation provenance: `I:\AI\voxcpm2-evaluation\evidence\longtext-clause16-long-openings-generation.json` and `longtext-api-semantic-hybrid-final-generation.json`.

### One pending listening check

The following comparison is technically ready but has **not** received user listening feedback:

`I:\AI\voxcpm2-evaluation\listening\longtext-clause16-opening-default-pauses-20260904`

- `01_original_long_generation_first_clause_only.wav` is the old 03 control.
- `02_deepseek_default_pauses_safe_retime.wav` changes only the 15 clause-boundary timings to the DeepSeek class defaults. It does not run TTS or change gain.
- It is a safe edge retime, not a simple silence insertion: 1525 ms of verified low-energy edges were removed and 700 ms of all-zero silence was inserted. A cropped side keeps at least an 80 ms word-edge guard and receives a 10 ms fade inside that guard; an edge with no safely removable leading quiet is left untrimmed. Spoken-body PCM is sample-exact.
- READY, source hashes, 16/16 ASR coverage, no clipping, and boundary checks pass. Whole-file ASR wrote the last “困意” as “昆依”, while the source and retimed spoken-body PCM are identical; treat this as an ASR variation and still ask the user to verify the first/last sounds by ear.
- Next-session listening question: which of 01/02 has more natural pauses; whether 02 clips any first or last sound; and which boundary is still too long or short.

### Remaining risks and next-session entry

- This is the current best result for one soft Chinese reference, one text, and manually selected takes. It is not a universal best setting.
- Long-text generation still varies in inhalation, pace, pitch, timbre, and noise. Candidate generation plus automatic and human quality checks remain necessary.
- DeepSeek may incur external cost. Product behavior must keep a free local semantic splitter and fixed pause defaults as fallbacks.
- VoxCPM2 is not yet registered in the Generation Bridge, and its private parameters must not leak into the Timeline DSL.
- Spatial recipes remain experiment scripts rather than product actions. Real SFX coverage remains limited.
- Ignore the rejected `longtext-local-tempo-pause` packages, including `longtext-local-tempo-pause-rejected-gain-measurement-20260904`; one archived READY file still says `ready` and points at the old package root, but the method was rejected because it incorrectly used speed/milliseconds-per-character logic that the user did not request.

When resuming Audio Quality V1, record the pending 01/02 listening result if the user provides it; it does not block base integration. Follow the bilingual 2026-09-08 integration design. The checked-in app does **not** yet have a multi-candidate store/panel or explicit accept/undo flow; implement those boundaries through the existing Generation Bridge, durable assets, playback, project revisions and remix infrastructure. Preserve actual voice timing and Planner source metadata. Do not ask the user to re-approve the already approved audio-quality direction, and do not claim the stage is complete.

### VoxCPM2 integration readiness (2026-09-08)

- Native CLI: `I:\AI\voxcpm2-evaluation\src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`; both GGUF models and normal/soft reference WAVs exist. The external runtime profile is `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json`. CLI integration does not require a new Python server.
- Reuse source: `.worktrees/audio-quality-v1-round1`, branch `codex/audio-quality-v1-round1`, inspected HEAD `46d26d7`. It has candidate/accept/preview, 48 kHz and spatial foundations, but many dirty files and untracked Vox provider/profile modules. Recheck status and selectively port; never reset or merge the whole worktree merely to recover these modules.
- Correct old runtime integration: transcript mode must use Combined (`-r` plus prompt audio/text); preserve the transcript's trailing ASCII space; add low-VRAM, appropriate step limits, cancellation and resource exclusion. `gpu_layers=0` still uses GPU. Old in-memory undo and rejection of voice longer than its clip need replacement/adaptation.
- Current main mixer is 32 kHz and rejects mismatched rates; finish 48 kHz normalization and stereo preservation before claiming usable remix/export. Candidate adoption must be persistent, content-checked and safe across Planner timing shifts, refresh and later edits.
- Old `integration-result.json` is a 2026-07-29 prototype success, not current-branch acceptance. Long-text experiment scripts contain manual replacements/cuts; port algorithms, not fixed-text packages. The old ASR helper's `env-comfyui-clone\Scripts\python.exe` path is missing; recheck the auxiliary environment before long-text implementation.
- This readiness pass was read-only outside documentation: no service startup, audio generation or model API requests.

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

## Step 10 Product Workflow Integration

- Product-library state lives outside `AsmrProject` in `apps/web/src/lib/asmr/project-library.ts`.
- Storage envelope: `version: 1`, `currentProjectId`, and project entries containing current project JSON, update time, revisions, and optional successful mix fingerprint.
- The legacy `ai-asmr-studio:v0:project` key is read once and migrated to `ai-asmr-studio:v1:project-library`.
- New projects reuse the demo timeline structure but clear generated assets and export results. Duplicates retain assets but receive a collision-safe project ID and no trusted mix fingerprint.
- Revisions are deduplicated, capped at 12, and validated to keep the same project ID as their parent entry.
- `replaceLibraryProject` protects any existing same-ID project before import/reset and clears its old mix fingerprint.
- `GET /api/assets/analysis?uri=<durable-uri>&bars=64` accepts only local clip/mix durable URIs, reads the D-drive WAV, and returns waveform/technical metrics.
- `apps/web/src/lib/asmr/product-quality.ts` derives six stable checks: schema, assets, mix, analysis, channels, headroom.
- Unknown or lost mix fingerprints are intentionally conservative: an exported WAV remains playable/downloadable but is marked `需重混` until a current successful mix fingerprint is known.
- Project JSON export remains unchanged and does not contain library records, revisions, fingerprint metadata, waveform arrays, or runtime analysis.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/app/api/generation/clip/route.ts` runs selected voice clip generation through the local provider and returns stable asset metadata.
- `apps/web/src/app/api/assets/clip/[assetId]/route.ts` serves local generated clip WAV bytes for playback.
- `apps/web/src/app/api/generation/mix/route.ts` runs local full-project mix rendering from generated clip assets and returns stable mix asset metadata.
- `apps/web/src/app/api/assets/mix/[assetId]/route.ts` serves local generated mix WAV bytes for playback and download.
- `apps/web/src/components/studio/studio-app.tsx` owns editable project state, runtime generation state, bridge callbacks, export, import, autosave, reset, validation, selected clip state, playback, director presets, and timing nudges. It uses the local real bridge by default and the mock bridge only when `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock`.
- `apps/web/src/components/studio/project-workspace.tsx` composes planning/editing shells; planning hides the engineering details dock and returns its width to the creative content.
- `apps/web/src/components/studio/project-workspace-header.tsx` shows a planning header or compact editing identity/save state; focus and project-level `导出` / `载入` / `重置` actions are editing-only.
- `apps/web/src/components/studio/project-rail.tsx` renders the collapsible real local project library and project actions.
- `apps/web/src/components/studio/project-details-dock.tsx` renders the collapsible right dock and hosts Preview Layer, quality, version, and metadata surfaces.
- `apps/web/src/components/studio/project-workspace-badge.tsx` provides compact workspace badge display helpers.
- `apps/web/src/components/studio/preview-layer-panel.tsx` renders generation/playback/WAV controls, real analyzed waveforms and expandable non-empty track progress; no default count grid or placeholder waveform.
- `apps/web/src/components/studio/preview-waveform-placeholder.tsx` is the waveform renderer; the preview now passes real analyzed bars only.
- `apps/web/src/components/studio/project-quality-panel.tsx` keeps actionable issues visible and places the full six checks behind a disclosure control.
- `apps/web/src/components/studio/project-version-panel.tsx` renders recent revisions and recovery actions.
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
- `apps/web/src/lib/asmr/project-library.ts` owns the versioned multi-project/revision envelope, legacy migration, mix-fingerprint metadata, and safe replacement helpers.
- `apps/web/src/lib/asmr/director-presets.ts` contains deterministic Director Action preset behavior for voice clips.
- `apps/web/src/lib/asmr/project-summary.ts` derives project-level summary metrics for the workspace shell.
- `apps/web/src/lib/asmr/generation-summary.ts` derives preview-layer generation counts and asset slots from `AsmrProject` without mutating the schema or export contract.
- `apps/web/src/lib/asmr/generation-bridge.ts` defines the backend-shaped generation bridge contract.
- `apps/web/src/lib/asmr/mock-generation-bridge.ts` implements the local mock bridge.
- `apps/web/src/lib/asmr/generation-project-state.ts` commits final generation success/failure into `AsmrProject`.
- `apps/web/src/lib/asmr/generation-runtime.ts` manages runtime-only generation jobs keyed by `jobId`, selected clip IDs, and project mix export type.
- `apps/web/src/lib/asmr/generation-view.ts` merges durable project data and runtime generation state into UI-ready controls, including selected-clip controls and project-mix controls.
- `apps/web/src/lib/asmr/mock-asset-resolver.ts` resolves `mock://` asset URIs to runtime-only playable WAV data URLs.
- `apps/web/src/lib/asmr/local-runtime-config.ts` reads local runtime paths and provider URL with D-drive defaults and environment overrides.
- `apps/web/src/lib/asmr/voice-pack.ts` loads and validates the GPT-SoVITS voice pack and prompt transcript.
- `apps/web/src/lib/asmr/gpt-sovits-provider.ts` maps voice clips into GPT-SoVITS `/tts` payloads and requests WAV bytes.
- `apps/web/src/lib/asmr/local-asset-store.ts` writes local generated WAVs and resolves safe `asset://clip/...` and `asset://mix/...` IDs.
- `apps/web/src/lib/asmr/project-mix-state.ts` derives mix readiness, updates `exports[type="wav"]`, and preserves a previous usable mix when remix fails.
- `apps/web/src/lib/asmr/project-mix-renderer.ts` decodes PCM WAVs, renders timeline-aware stereo project mixes, applies gain/fades/pan/distance/movement/loop/normalization/limiting, and writes PCM16 WAV output.
- `apps/web/src/lib/asmr/local-project-mix-generation.ts` reads local clip assets, calls the renderer, and saves durable mix assets.
- `apps/web/src/lib/asmr/procedural-audio.ts` renders deterministic local WAV files for breath, SFX, and ambience clips.
- `apps/web/src/lib/asmr/local-clip-generation.ts` ties project clip lookup, voice pack loading, GPT-SoVITS voice generation, procedural non-voice generation, and asset saving together.
- `apps/web/src/lib/asmr/local-generation-bridge.ts` implements the browser-side bridge for the local generation API.
- `apps/web/src/lib/asmr/playback-asset-resolver.ts` resolves `asset://clip/...`, `asset://mix/...`, and `mock://asset/...` playback URIs.
- `apps/web/src/lib/asmr/audio-analysis.ts` derives real peak bars and technical metrics from decoded PCM WAVs.
- `apps/web/src/lib/asmr/product-quality.ts` combines durable project readiness and optional WAV analysis into user-facing pass/warn/block checks.
- `apps/web/src/app/api/assets/analysis/route.ts` safely analyzes local durable clip/mix WAV assets.

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/project-library.test.ts`
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
- `apps/web/src/lib/asmr/project-mix-state.test.ts`
- `apps/web/src/lib/asmr/project-mix-renderer.test.ts`
- `apps/web/src/lib/asmr/local-project-mix-generation.test.ts`
- `apps/web/src/lib/asmr/local-generation-bridge.test.ts`
- `apps/web/src/lib/asmr/playback-asset-resolver.test.ts`
- `apps/web/src/lib/asmr/audio-analysis.test.ts`
- `apps/web/src/lib/asmr/product-quality.test.ts`
- `apps/web/src/app/api/assets/analysis/route.test.ts`

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
- Successful local project mix generation commits only `exports[type="wav"] = { status: "exported", uri: "asset://mix/<assetId>" }`.
- Normal generation failure commits `asset_failed` and an error.
- Failed regeneration preserves a previous generated asset.
- Failed remix preserves a previous exported `asset://mix/...` when one exists; first mix failure writes a `wav` export with `status: "export_failed"` and `uri: null`.
- `mock://` URIs are resolved into data URLs only at runtime for playback.
- `asset://clip/...` URIs are resolved into local API playback URLs only at runtime for playback.
- `asset://mix/...` URIs are resolved into local API playback URLs only at runtime for full-project preview and WAV download.
- Exported JSON must not contain browser `blob:` URLs, `data:audio` URLs, runtime progress, or runtime job state.

localStorage key:

- Current: `ai-asmr-studio:v1:project-library`.
- Legacy migration source: `ai-asmr-studio:v0:project`; it is removed after successful migration.
- The library envelope is not Project JSON. Exported JSON remains one plain `AsmrProject`.

## Current Verification

Use these commands from repo root:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Pre-Planner baseline verification (historical):

- `npm.cmd run test --prefix apps/web`: 29 test files passed, 184 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed with 0 warnings.
- `npm.cmd run build --prefix apps/web -- --webpack`: passed. The default Turbopack build is not the verification command on this Windows environment because Turbopack reports an unsupported native binding and asks to use Webpack. The known SWC native binding warning can appear while Webpack/WASM still completes with exit code 0.
- Local dev server verification at `http://localhost:3000/`: page returned HTTP 200 with rendered app HTML.
- Step 9 API verification used a minimal schema-valid project with one generated local clip asset and called `POST /api/generation/mix`. It generated `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`; `GET /api/assets/mix/step9_verify_project_wav_20260711T203915972Z_697118df` returned `audio/wav`, `128,044` bytes, WAV header `RIFF`.
- Step 9 user-facing showcase generated a 32 second mix through `POST /api/generation/mix`, reusing existing local clip assets `voice_001_20260706T211523064Z_d3b95513`, `breath_001_20260706T213815920Z_b55ae7b8`, and `sfx_blanket_001_20260706T213816276Z_0089677d`. It produced `asset://mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de`; `GET /api/assets/mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de` returned `audio/wav`, `4,096,044` bytes, WAV header `RIFF`. The WAV lives under `D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app` and is not a checked-in repo asset.
- Earlier Step 7/8 browser verification remains valid for selected clip generation and playback: generated app assets include `asset://clip/voice_001_20260706T211523064Z_d3b95513`, `asset://clip/breath_001_20260706T213815920Z_b55ae7b8`, and `asset://clip/sfx_blanket_001_20260706T213816276Z_0089677d`.
- Step 10 browser acceptance at desktop and 390px width verified real project create/switch/duplicate, manual revision plus restore safety revision, independent/focus side-panel collapse, and zero horizontal overflow or console error/warning.
- Real waveform acceptance reused `asset://mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de`: the UI rendered 64 bars (19 non-zero for this sample), and analysis reported 32.0 kHz, 32.0 seconds, stereo, peak `-6.1 dBFS`, RMS `-35.2 dBFS`.
- After code review hardening, importing an exported mix without a persisted fingerprint still renders/analyzes its real waveform but marks the mix `需重混` instead of falsely passing freshness.

Run locally:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Open:

```text
http://localhost:3000/
```

## Recent Commit Trail

Planner milestone:

- `bd0d058 feat: add ASMR planner and simplify creative workspace` — recorded and pushed 2026-09-08.

Step 10 branch commits:

- `39f896b fix: preserve local workflow integrity`
- `96cbb5c feat: harden local product workflow`
- `1d21893 feat: add project quality report`
- `d0aaf7a feat: analyze real local wav assets`
- `b169196 feat: add local project library and revisions`
- `53154e5 docs: plan product workflow hardening`
- `da64a3a docs: design product workflow hardening`

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

Planner is accepted for this iteration. The user has resumed **Audio Quality V1**, starting with preparation for VoxCPM2 integration into the real generation workflow. Local Planner recovery and broader script-quality evaluation remain follow-ups and must not prevent this priority switch. Do not ask the user to re-approve the already approved audio direction.

Proceed within Audio Quality V1 in this order:

1. Retain the accepted semantic-group recipe as the implementation reference. If the user has listened to `longtext-clause16-opening-default-pauses-20260904`, record the 01/02 result separately; this optional comparison is not a prerequisite for the base integration.
2. Implement the completed bilingual `2026-09-08-voxcpm2-product-integration-design` through the existing Generation Bridge. Selectively adapt the old candidate/provider/48 kHz code, preserving the current Planner and restrained UI; finish explicit candidate/accept/undo and real remix/export acceptance.
3. Implement the selected soft-Chinese long-text route as an experimental option with multiple candidates, semantic grouping, safe extraction, adaptive/fallback pauses, and clear mode/reference controls. Keep GPT-SoVITS as a working fallback.
4. Productize the already accepted spatial recipes without implying that direction comes from dry-voice prompts.
5. Continue the unresolved real ASMR SFX library/local-generation work; retain procedural audio only as a labelled fallback.

The fixed roadmap still has no numbered Step 11. The audio work above belongs to Audio Quality V1; Planner V1 is separately approved. Before audio integration, compare experiment assumptions with current code and keep the docs synchronized.

## Initial Product Path

The canonical roadmap is `docs/ROADMAP.md`.

Do not treat this file as a competing roadmap. Current summary only:

- Completed: roadmap steps 1-10.
- Accepted for this iteration: `AI 创意策划 / LLM Planner V1`; external DeepSeek workflow and UI cleanup accepted by the user on 2026-09-08. Local recovery remains a follow-up.
- Current priority: `人声导演与真实 ASMR 音效质量 V1`; prepare VoxCPM2 voice/long-text product integration, followed by spatial and real SFX work within the same approved stage.
- No numbered Step 11 has been created. Any different new top-level direction still requires user approval.

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

Do not invent a new top-level roadmap after the completed canonical 10 steps without user approval:

- A new model-quality/audio-editing v2 roadmap presented as already approved.
- A new mock-only or bridge-only milestone presented as required product progress.
- Turning adapter / API / provider wrapper work into a new top-level roadmap gate without user approval.
- Full DAW drag/drop timeline, cloud sync, auth, payment, publishing, and collaboration require a new user-approved scope.

Real project-mix rendering/export is no longer "Do Not Do Yet"; it was completed as Roadmap Step 9. Future work should build on the real `asset://clip/...` and `asset://mix/...` contracts instead of replacing them with another mock gate.

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
