# VoxCPM2 Product Generation Integration

Date: 2026-09-08. Status: the first single-clip product slice is implemented and technically verified. User listening acceptance for this iteration's samples remains pending; long-text grouping/adaptive pauses, V2/HRTF and real SFX expansion are not implemented on the current product branch.

Chinese companion: `2026-09-08-voxcpm2-product-integration-design.zh.md`.

## Goal and scope

The user accepted this Planner iteration and requested a recorded/pushed milestone followed by VoxCPM2 integration preparation. This design refines the approved Audio Quality V1 stage; it creates no new top-level stage. `docs/ROADMAP.md` remains canonical. Preserve the listening conclusions in the 2026-07-13 audio design and 2026-07-26 VoxCPM2 evaluation.

The first accepted product slice must let a user select VoxCPM2, a normal/soft reference and reference mode in the current project, generate a voice candidate, compare it with the original, explicitly adopt it, undo adoption, then remix and export WAV. One successful CLI output is insufficient, and this slice does not complete the whole audio-quality stage.

Retain GPT-SoVITS and existing non-voice generation. VoxCPM2 is optional; do not silently change defaults or switch models after failure. Start with real selected-clip generation and safe adoption, then add the selected long-text approach as a mode of the same provider.

## Pre-implementation baseline and reusable work (2026-09-08)

Planner milestone `bd0d058` was pushed to `origin/codex/step10-product-workflow`. Before this integration, the primary workspace called GPT-SoVITS directly for voice, without a product candidate store or adopt/undo flow. Its mixer defaulted to 32 kHz, rejected mismatched sample rates, and downmixed stereo inputs to mono. These were the compatibility gaps addressed by the single-clip implementation below, not the current product state.

The old worktree at `D:\CodexWorkplace\asmr_director\.worktrees\audio-quality-v1-round1` is on `codex/audio-quality-v1-round1`, HEAD `46d26d7` when inspected. It contains candidate, spatial and 48 kHz infrastructure, but also many uncommitted changes; VoxCPM2 provider/profile files and tests are untracked. Recheck its status before selectively porting code. Do not merge the entire tree, reset it or overwrite its work.

| Old-worktree module | Adaptation required |
| --- | --- |
| `audio-candidate.ts`, `local-candidate-store.ts` | Candidate schema, manifest/WAV separation and limits; add request fingerprints and current project ownership |
| `api/audio-candidates/...`, candidate playback API | Reuse service logic; route generation through the existing Generation Bridge instead of duplicating job state |
| `candidate-acceptance.ts` | Safety versions; preserve Planner source, actual durations and timeline shifts |
| `audio-candidate-panel.tsx`, old `studio-app.tsx` | Preview/adopt/discard interactions; replace memory-only undo with persistent, edit-safe recovery |
| `pcm-audio.ts`, `project-mix-renderer.ts` | 48 kHz normalization, resampling and spatial entry points; preserve stereo |
| `voxcpm2-provider.ts`, `voxcpm2-profile.ts` | Reuse process/WAV validation skeleton, correcting parameters and transcript handling |

`D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\integration-result.json` records real prototype generation (201), adoption (200), and dry/spatial output comparisons on 2026-07-29. This is historical prototype evidence, not proof of current-branch integration.

## Local runtime configuration

The initial read-only inspection on 2026-09-08 confirmed the following material without starting services or generating audio. Subsequent real product verification is recorded at the end of this document:

- CLI: `I:\AI\voxcpm2-evaluation\src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`; SHA256 `ECB34B72A15D489BA333718082C784F9F8B0CC05161BB6525F15451D4F821C44`, matching the accepted sample's recorded executable.
- Models under the experiment root: `models\VoxCPM2-BaseLM-Q8_0.gguf` and `models\VoxCPM2-Acoustic-F16.gguf`.
- References: `references\soft-16k-s16.wav`, `normal-16k-s16.wav`. The soft reference header is mono/16 kHz/PCM16; accepted output is mono/48 kHz/PCM16.
- Profile: `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json` registers the executable, models, `soft_zh`/`normal_zh` references and authorization records.
- Experimental wrapper: `I:\AI\voxcpm2-evaluation\tools\run-voxcpm2-monitored.ps1` provides parameter/evidence references. The product service should invoke the native CLI with an argument array, `shell: false`, hidden windows, isolated run directories, bounded logs and a timeout.

The server reads configuration and exposes an availability/reference catalog. Clients submit IDs and supported modes, never executable paths, arbitrary audio paths or endpoints. Private CFG, timesteps and memory settings remain server-side; actual parameters belong in candidate provenance, not Timeline DSL or the main UI. Missing configuration produces a concise actionable error.

Provide Reference-only and Reference audio + transcript. The latter uses Combined for the selected recipe: pass the same reference through both `-r` and `--prompt-wav/--prompt-text`. Replace accurate transcript punctuation with spaces and preserve one trailing ASCII space; no later `.trim()`. Reference-only does not require transcript text. Normal and soft references each need their own matching transcript.

Correct the old provider's 60-step default/truncation risk, missing `--low-vram`, missing `-r` in transcript mode, trimmed trailing space, rejection of audio longer than the clip, timeout-only cancellation, module-local locking and raw-log user errors. Validate step limits per generation mode. A capped or apparently incomplete result must not be silently adopted.

Accepted source material used `gpu_layers=0`, low-VRAM, CFG 2, timesteps 10 and temperature 1. It still uses the GPU; it is not CPU-only. The ending sample peaked at approximately 3626 MiB GPU memory and 3295.5 MiB process working set. Generate one candidate at a time, with exclusion covering requests and worker processes. Cancel/timeout must release the process and lock. Do not default to three parallel candidates or concurrent ASR/Ollama contention.

## Requests, candidates and project state

Extend existing `GenerateClipRequest` with server-validated `voiceOptions`: provider, voicePackId, referenceMode and generationMode. `generation-bridge.ts`, the local bridge, clip API and `local-clip-generation.ts` share this request and discriminated results. Preserve legacy GPT and non-voice calls. Vox success returns a candidate instead of immediately replacing the asset through the current success callback.

Persist candidate manifests outside Git in runtime storage. Record project/clip identity, target text and request fingerprints, stable asset URI, WAV format/actual duration, engine/model/weight identity, actual seed/parameters, reference/mode, quality checks and creation time. Reuse `asset://clip/...` and playback. Project JSON contains adopted audio and necessary truthful generation metadata; full candidate provenance, adoption records and project revisions remain in their own metadata layers. Existing DSL seed/model fields are not evidence of actual runtime parameters.

Generate one candidate per action and accumulate alternatives through Regenerate. Retain the old limit of 12 unadopted candidates per clip, asking for a discard when full. Do not automatically delete WAVs in the first slice; projects and safety versions may still reference them. Changing reference selection leaves prior candidates comparable. Changed text prevents silently applying candidates generated for different content.

The old candidate schema/store requires `asset://candidate/...`. Unifying with clip assets requires coordinated schema, storage validation and playback mapping changes. Handle old manifests through explicit version detection and compatible reads; do not load them as the new format or rewrite the prototype runtime directory.

Adoption is one consistent state operation: validate project/clip/content identity, create a safety revision, record the original asset and timeline delta for undo, apply the new asset/actual duration/truthful engine information, then mark the mix stale. Do not report success after a persistence failure. Extend underestimated voice clips and shift following timing and associated emotion points. Reuse current Planner timing logic and cover non-Planner voice without clipping speech. Keep the planned window for shorter audio in the first slice so user-authored silence is not automatically compressed.

Undo restores asset, duration and timeline changes caused by adoption, respecting Planner-source boundaries. Persist recovery records with the project library so refresh does not lose recovery. If later edits invalidate quick undo, do not overwrite them with an old snapshot: disable that shortcut and expose the existing version recovery path. Persisted project state determines adoption status; a separate manifest flag cannot alone prove adoption.

Cancellation, failure, stale requests, text edits during generation and project switching must leave the original audio and mix freshness unchanged. Connect request AbortSignal to process termination while retaining independent client protection against late results. A generated but unadopted file is not a project content change.

## Mixing and UI

Normalize internal mixing to 48 kHz, accepting legacy 32 kHz, 44.1 kHz and Vox 48 kHz inputs without duration/timeline drift. Preserve stereo channels. Mono dry voice may enter spatial processing; already spatialized stereo must neither be averaged to mono nor spatialized twice. Retain dry originals. The current slice keeps existing mono pan/distance/movement; V2/HRTF processing and caching during remix remain subsequent integration work.

Default UI shows engine, reference, reference mode, generate/cancel and preview/adopt controls for existing candidates. Show necessary duration/state information; technical parameters and provenance stay expandable. Keep original preview before adoption and undo afterward. Real errors, save failures and stale-mix status remain visible. Do not restore development reminders, long explanations or duplicate counters removed in the accepted UI cleanup.

## Subsequent long-text mode

Follow the selected recipe in `docs/AI_HANDOFF.md`: each non-final semantic group begins the remaining long text; generate the full continuation and safely extract that opening group. Generate the last group as a true ending. Retiming affects semantic-group joins only, preserving natural internal pauses. Optional DeepSeek analysis supplies short/medium/long classes; milliseconds come from equally weighted neighboring group means, then valid same-class samples, then 180/350/600 ms defaults. Preserve free local grouping and default-pause fallbacks. Adjust overall loudness once after group selection.

The accepted sample's manual group-5 replacement, cut overrides, specific seeds/step caps and fixed continuation padding cannot become a generic service unchanged. Validate safe extraction, text coverage, intact word edges, breath/noise and voice identity across different texts. When a safe cut cannot be found, retain the candidate and request regeneration instead of silently clipping speech. The pending full-clause 01/02 pause comparison is not accepted, does not block base integration, and does not replace the selected group-join strategy.

Recheck Python/ASR dependencies for long-text tooling. The spatial environment `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\.venv\Scripts\python.exe` exists, but the old helper's `...\gpt-sovits\env-comfyui-clone\Scripts\python.exe` does not. ASR weights exist under the GPT-SoVITS runtime's `tools\asr\models\faster-whisper-large-v3`; weights alone do not prove a working environment. Native CLI integration does not depend on repairing that helper.

## Implementation sequence and acceptance

These are internal Audio Quality V1 implementation slices, not new roadmap gates:

1. Implemented: selectively port provider/profile and candidate schema/store. Correct reference modes, actual parameters, cancellation, serialization and WAV validation.
2. Implemented: integrate the Generation Bridge, candidate preview and explicit adopt/undo. Preserve Planner metadata, reload recovery and actual durations.
3. Implemented and technically verified: 48 kHz mixing compatibility, restrained UI and the real candidate-to-remix/export workflow.
4. Pending: productize selected long-text generation, safe extraction and pauses, then continue approved spatial actions and real SFX expansion.

Automated acceptance covers GPT/non-voice regression, both reference modes, empty/malformed WAVs, mixed 32/44.1/48 kHz inputs and stereo preservation, long-audio adopt/undo, cancel/failure/late responses, edits/project changes during generation, candidate/undo reload recovery, stale mixes after adoption and playable exports. Follow existing TDD rules for behavior changes, then complete full tests, lint and TypeScript/production build.

Use a separate browser acceptance project for real Vox generation, at least two candidates, preview/compare/adopt/undo, and remix/download. Check desktop and 390px layouts. Record actual runtime settings, WAV metadata and action results while preserving existing user drafts/projects. The user still confirms subjective quality by headphone listening. Keep `apps/web/README.md`, `.env.example`, `docs/THIRD_PARTY_RUNTIMES.md`, roadmap, handoff and archive synchronized with implementation evidence.

## Single-clip implementation and verification (2026-09-08)

The current product supports optional VoxCPM2 generation with normal/soft references and both reference modes. Candidates persist outside Project JSON and support preview, explicit adoption, discard and reload-safe undo. Adoption extends underestimated voice timing and marks the mix stale. Native process cancellation, 48 kHz mixing and stereo preservation are wired into the existing workflow.

- Automated verification: all 46 test files / 340 tests, ESLint and the webpack production build passed. The existing native SWC binding warning remains; the build completed through the WASM fallback.
- Real browser verification: both reference modes produced real candidates (5.6 and 6.4 seconds). Playback actually started; adoption extended the timeline, undo remained available after refresh, and remix/download produced an 8.6-second 48 kHz stereo WAV. Desktop and 390px checks recorded `errors: []`.
- Real CLI cancellation: the child process exited, the generation lock was released and the candidate count stayed unchanged.
- Evidence: `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08\browser-result.json` and `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08\real-cancel-result.json`.

This establishes the technical single-clip workflow. It does not establish ASR-verified text completeness, generally reliable softness control, or user listening acceptance for these samples. Long-text grouping/adaptive pauses, V2/HRTF and real SFX expansion remain unimplemented on the current product branch, and Audio Quality V1 remains unfinished.
