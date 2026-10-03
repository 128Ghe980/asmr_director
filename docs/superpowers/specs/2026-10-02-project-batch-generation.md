# Project batch audio and storyboard generation

Date: 2026-10-02

Latest storyboard behavior: batches now honor each paragraph's **Continuous shot / New shot** preference, use newly accepted adjacent shots in serial order and preserve preferences when saving results. See the [reference-mode spec](2026-10-02-storyboard-reference-modes.md) and [acceptance record](../../records/2026-10-02-audio-quality-v1-storyboard-reference-modes.md); earlier runtime evidence below is historical.

Status: **batch controls and the later audio overview addition verified**. It belongs to the existing Audio Quality V1 route in [ROADMAP](../../ROADMAP.md), whose broader work remains in progress, with no new top-level stage. This new work is not committed or pushed.

## Intent and controls

Add two compact groups, Audio and Storyboard, to the engineering script-editing area, each with “全部生成” and “全部重生成” plus target counts. Keep the current one-screen workspace and distinguish filling gaps from regenerating everything through the groups' descriptions.

| Mode | Targets and retained data |
| --- | --- |
| `audio_missing` | Nonempty voice clips without generated/adopted audio. Skip a clip only when its status is `asset_generated` and its asset ID and URI are nonempty. |
| `audio_all` | Regenerate all eligible nonempty voice clips using the current engine/settings. VoxCPM2 produces new candidates and keeps existing adopted audio until manual adoption; GPT-SoVITS retains its existing direct asset-commit behavior. |
| `storyboard_missing` | Eligible voice clips with adopted local audio and no saved shot. Skip any existing shot, including stale or incomplete notes. |
| `storyboard_all` | Regenerate every eligible voice clip with adopted local audio. Replace each saved shot only after that item's valid result is accepted; retain old notes on failure or cancellation. |

Audio batches preserve each engine's existing generation flow and selected voice settings. The candidate/manual-adoption guarantee applies to VoxCPM2; GPT-SoVITS's `succeeded` update directly commits the generated asset as before. A batch does not generate a project mix. Storyboard batches require a generated local asset whose URI exactly matches `asset://clip/<assetId>` and use the existing clip-storyboard service, current engineering dialogue, actual adopted WAV and measured duration; they generate text prompts rather than H3 video or new audio.

## Audio overview addition — verified

Paragraph color markers are also verified: a small green/adopted, gray/pending or amber/generated-unadopted dot above each voice paragraph number uses the same `getStudioAudioProgress` classification as the overview. The selected paragraph displays the corresponding text badge, retaining generating/failed badge priority. Candidate-dependent loading/error states use an outline dot and accessible status text. Marker evidence: `I:/AI/asmr-director-audio-markers/2026-10-02/marker-verification.json` (45 targeted tests, TypeScript/lint/build pass, 10/10/2 live dots, desktop/390px/320px checked). Latest runtime is in [AI_HANDOFF](../../AI_HANDOFF.md); the overview acceptance below is historical.

Show mutually exclusive paragraph counts in the order **已采用 / 待生成 / 已生成未采用**. Count only nonempty voice clips. Adopted audio has priority; otherwise, a clip with at least one current ready candidate counts once as generated/unadopted, and one with no such candidate counts as pending. Multiple candidates for one clip never inflate the paragraph count. Ignore discarded, other-project, removed-clip and stale-source candidates, including stale long-text context. Changing current voice options does not invalidate an already generated candidate for this overview.

Read ready candidates once at project scope through `GET /api/audio-candidates?projectId=...`. The selected inspector filters that shared list by clip; changing selection does not issue a request per clip. Generation/discard refresh the project list; adoption/undo/source edits update derived counts. While candidates are loading or failed to load, candidate-dependent counts display **—**, rather than presenting a false zero; adopted counts can still derive from the project. This overview does not redefine the existing batch target rules.

Evidence root: `I:/AI/asmr-director-audio-overview/2026-10-02`. **Seven unique targeted files / 66 tests pass** (UI 35, domain 12, candidate API 19), full TypeScript exit zero, changed-file ESLint pass and production Webpack build exit zero with the existing SWC/WASM warning. The earlier 1,028-test suite was not repeated for this addition. Adoption/undo/discard and refresh behavior are tested through the real App with simulated HTTP; no user candidate was adopted or discarded during browser verification.

`overview-verification.json` records **10 adopted / 10 pending / 2 generated-unadopted paragraphs = 22**, not candidate counts. Selecting paragraph 11 retains its eight inspector candidates and the 9.6-second display without changing the overview. `audio_missing` still targets **12 unadopted paragraphs**, including the two with candidates; its existing target rule is unchanged. Dialogue, all 22 timeline/adoption entries and **all 114 asset files, including the manifest**, remain byte-identical with no added/deleted files (`assets-before-overview.json`). Desktop **1182×892 / 390×844 / 320×740** have no page horizontal overflow and all four buttons fit; viewport reset, console errors/warnings empty. Screenshots inspected only, not saved. **Zero actual TTS / text-model / H3 calls** in this addition.

Current production: **3001 / PID6176 / `.next-batch-generation-production` / HTTP200**; previous PID2212 was identity-checked and stopped with no active generation. Prior acceptance evidence below is historical. Continue from the [development record](../../records/2026-10-02-audio-quality-v1-batch-generation.md) and [AI_HANDOFF](../../AI_HANDOFF.md) for the latest runtime/restart.

## Queue and write protection

Capture the target list when the user starts an action. Process one item at a time, waiting for a terminal result before starting another. Read the latest project and revalidate each target's eligibility/source before dispatch and before accepting its result. The starting list does not expand when clips are added during the run.

Show the active operation and processed/total progress with success, skipped and failed counts. A partial failure is recorded and the queue continues; successful earlier work remains available. Zero-target actions show a zero count and remain disabled, starting no generation requests. Cancel aborts the current request, stops scheduling further items and preserves completed results.

Storage-fatal errors are an exception: HTTP 507 / `INSUFFICIENT_STORAGE` stops the queue, preserves completed results and reports the fatal reason plus remaining items. Atomic WAV publication and runtime-storage recovery are recorded in the [storage bug record](../../records/2026-10-02-audio-quality-v1-storage-recovery.md); its latest runtime checkpoint supersedes the earlier acceptance snapshot below.

A queue identity and project identity guard every write. Project switch, unmount or relevant source changes invalidate old work; a late response cannot update a different project or a changed clip. Voice source validation includes the existing generation context where applicable. Storyboard validation retains the current scene/text/asset, saved-shot edit identity, chosen reference mode and predecessor dependencies. Both fill and regenerate use each paragraph's saved next-generation mode. Continuous mode requires a usable adjacent predecessor and otherwise fails without changing saved notes; new mode uses one when available and permits background-only generation. Batch storyboard requests and manual per-clip generation are mutually exclusive, and shot/background/preference edits are locked during a batch.

The generation bridge's start promise is not a portable completion signal: candidate/succeeded/failed/canceled updates settle the queued item. Disabled starts, transport failures and cancellation must also settle it so the queue cannot remain stuck.

## Compatibility and verification

Keep existing project/video metadata, stale editing/copy restrictions, candidate history, audio-undo protection and the compact H3 renderer. Filling missing storyboards deliberately preserves stale saved notes; the user chooses the all-regenerate action to replace them. The broader Audio Quality V1 remains in progress. No Git publication is requested for this new work.

Evidence root: `I:/AI/asmr-director-batch-generation/2026-10-02`. **89 files / 990 tests pass**, one existing opt-in file/test skipped (`full-tests.log`); full ESLint, TypeScript and production Webpack build pass (`eslint.log`, `typecheck.log`, `build.log`). The existing Windows SWC warning falls back to WASM successfully. Tests cover selection/queue/terminal waiting, partial failure, cancellation/late responses, UI locking and the engine-specific audio behavior; no real audio batch was run.

`browser-verification.json` records a real missing-storyboard batch starting with six targets. Five results, voice paragraphs **5–9**, were saved before cancellation; paragraph **10** was not saved. These new shots remain in the user's current project, increasing saved shots from **3 to 8**. Action counts **13 / 22 / 6 / 9 → 13 / 22 / 1 / 9** persist after reload. All four actions and single-shot editing lock during the run and recover after cancel. The first saved shot's fields/prompt, all 22 voice texts/timeline/adopted labels and all **76 WAV SHA-256 values** remain unchanged. Shot 5's prompt is **881 characters**, contains exact current dialogue and **3.32-second measured audio**, and has no summary.

Five external text results were accepted and the sixth item was canceled; upstream request/repair counts and token costs were not collected. **Zero TTS / zero H3-video calls**; no rendered-video quality or new listening acceptance is claimed. Desktop **1182×892** has two groups in one row; **390×844 / 320×740** use two rows without horizontal page overflow or clipped buttons. Console errors zero; viewport reset. Screenshots were inspected in the tool, not saved.

Current production is **3001 / PID28252 / `.next-batch-generation-production` / HTTP200**, native D: output with cache-only junction to the evidence root's `next-cache`. Old 3001/PID20660 and preview 3002/PID624 were identity-checked and stopped. See the [development record](../../records/2026-10-02-audio-quality-v1-batch-generation.md), [AI_HANDOFF](../../AI_HANDOFF.md) and [中文说明](2026-10-02-project-batch-generation.zh.md) for recovery.
