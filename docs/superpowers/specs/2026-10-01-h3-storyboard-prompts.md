# H3 prompts from the Planner storyboard

Date: 2026-10-01. This extends the existing planning feature within Audio Quality V1, without adding a roadmap stage. [中文版](2026-10-01-h3-storyboard-prompts.zh.md).

## Basis and scope

The user approved applying the official H3 guidance already reviewed in this conversation: section four of the [H3 guide](https://vrfi1sk8a0.feishu.cn/wiki/FIWjwgL33ipnkekzk30crmKUnIh) and its [reference-format guide](https://vrfi1sk8a0.feishu.cn/wiki/Vztzwstuqi3MQKkxs8QcGmxinxe). The rules below adapt those references to the user's workflow: a character reference image and the corresponding existing TTS audio for each shot.

This iteration generates reusable text prompts for the user to pair with their materials. It does not upload character images, synthesize or attach TTS, bind an actual audio file or measured duration, call an H3 video API, or produce video. The accepted audio processing, audio assets and batch download continue unchanged. Actual audio-duration binding remains future work.

## Prompt rules

New storyboard generation writes visual description, character action and camera direction in English. Original Chinese dialogue is taken directly from the associated sections of the validated draft in source order; the text model does not rewrite, translate, add or return replacement dialogue.

Use the same `Subject1 (S1)` identity across shots. The exported reference labels use the spaced forms `<Subject 1>`, `<Picture 1>` and `<Audio 1>`, with a `[Shot 1]` task section. `Picture1` specifies the subject's appearance and clothing. It is a character reference rather than a required first frame; do not force every shot to reproduce its composition, pose or background as the opening frame.

`Audio1` uses `fully_copy`: the supplied recording is the complete final soundtrack, at its original speed and with its original pauses. The prompt must not add dialogue, ambience, effects or background music, and must specify `non_diegetic_music: N/A`. The official alternate mode is spelled `partially_copy`; this iteration does not implement that mode and must not substitute `partial_copy`.

When the mouth is visible, its movement follows the supplied audio's timing. Pauses follow the existing recording, with the mouth closed during silence and after speech finishes. Do not estimate audio duration from characters, invent numeric seconds, extend a line or add a separate generated voice. Each shot should describe a simple continuous action with restrained camera movement rather than a sequence of cuts or competing actions.

Keep these rules in the dedicated storyboard-generation prompt and deterministic export formatter. A user preference may guide the visuals but cannot cause dialogue replacement or override full-audio preservation. The exported prompt explains how to use the corresponding `Picture1` and `Audio1`; it does not claim those references are already uploaded or connected.

The model must not invent appearance, hair or clothing from script settings. After the editable visual/action/camera directions, the formatter explicitly gives the character reference priority over invented gender, age, face, hair or outfit details. Its six sections are `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape` and `non_diegetic_music`.

## Data and interface

`POST /api/storyboard` retains its existing input and source-partition validation. New generated results add `promptFormat: 'minimax-h3'` to the version-1 storyboard. Existing records without this marker remain compatible and editable; loading them must not silently label their Chinese planning notes as H3-ready English prompts.

The existing source fingerprint and complete ordered section references continue to define whether the storyboard matches its script. `PlannerSource` and working-state persistence retain the optional format marker through saving, adopting, duplicating, revising and restoring, without adding prompt metadata to audio Project JSON.

Each compatible shot has a compact expandable H3 prompt area and a copy action. The storyboard toolbar offers a combined H3 prompt TXT download. Each task includes `Source lines` with its original draft section numbers (for example, sections N–M), making the corresponding TTS material identifiable without inventing timings. The formatter uses the editable English visual/action/camera fields and original draft dialogue; it does not ask a model to rewrite dialogue during copy or export.

Legacy Chinese storyboards remain unchanged and display an invitation to regenerate to obtain the new English H3 format. When source text or section mapping is stale, H3 copy/export is disabled until regeneration or undo restores a valid association. Ordinary storyboard Markdown remains available with its established stale-source indication. Keep the existing one-screen layout, bounded internal scroll, mobile sizing, save/undo and cancellation behavior.

## Verification status

Implementation and verification are complete for prompt planning/export. Evidence/log root: `I:/AI/asmr-director-h3-storyboard/2026-10-01`. Final full Vitest with `--maxWorkers=4`: **77 files / 829 tests passed**, one existing opt-in file/test skipped. Full TypeScript, ESLint and production Webpack build pass (`types.log`, `lint.log`, `build.log`). The first run overlapped the build and an existing 205-run recording-pagination test exceeded its five-second limit; `tests-build-concurrent-first.log` retains that failure. The full rerun passed after the build without changing that test or its production code.

Browser evidence is in `browser-verification.json`. One real DeepSeek-v4-pro request generated seven English shots; all seven original script texts and the current 22-item audio timeline labels/titles remained exact. The real response still inferred appearance and complex turns, so those demo fields were edited through the UI, the reference-priority rules were strengthened and the app rebuilt. No second paid request was made: the strengthened model instructions are verified by request-contract tests, while the final deterministic priority sentence is verified by browser clipboard readback. Exact dialogue, `fully_copy`, reference labels, no added soundtrack, stale copy/TXT gating, undo and reload persistence pass. TXT contents, clipboard failure/select fallback, invalid drafts/mappings and legacy compatibility are covered by automated tests.

Desktop, 390×844 and 320×740 layouts were inspected; both narrow widths have no document overflow and retain internal Planner scrolling. The viewport override was reset. Screenshots were viewed in the tool but not saved as files. Production is **3001 / PID 17600 / HTTP 200**, native `.next-h3-storyboard-production` with cache junction `I:/AI/asmr-director-h3-storyboard/2026-10-01/next-cache`; temporary 3002 is stopped. The existing native SWC warning uses the successful WASM fallback. Build-generated `tsconfig.json` changes were restored. No TTS, audio-project adoption, image upload or H3 video generation occurred. No commit/push was requested.
