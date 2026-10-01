# Concise H3 prompts and human-readable story backgrounds

Date: 2026-10-02

Status: **implementation, automated checks, real text-provider and production-browser verification complete**. This is a refinement of the existing Audio Quality V1 clip-storyboard workflow, without a new roadmap stage. [中文说明](2026-10-02-concise-h3-story-backgrounds.zh.md)

## Decision and official scope

The user found repeated background, continuity and sound instructions too long. A story background such as “inside a wooden cabin in the snow” is a short Chinese note for the creator. The model should derive the current shot's specific fireplace, window or snow view from that context, rather than paste the whole background into every exported prompt.

`summary` is documented in the official complete Ref rewrite format; its role is a short task/reference overview. This does not establish technical field validation at every product entry point. This iteration deliberately uses a concise custom product template, rather than claiming to reproduce the complete official rewrite. [MiniMaxAI official Ref guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)

The user's official handbook describes high-level prompt inputs through reference roles, creative intent and visible progression. That input guidance serves a different purpose from the expanded Ref rewrite-output structure; it informs the concise template without claiming that the two formats are identical. [H3 handbook, section four](https://vrfi1sk8a0.feishu.cn/wiki/FIWjwgL33ipnkekzk30crmKUnIh)

## Behavior

- Planner and the project inspector call the existing `sceneDescription` field **剧情背景**. New model output is short Chinese background text for people to read and edit, with place and atmosphere, capped at 160 characters. Existing storage/manual editing still accepts 4,000 characters. It does not preplan each shot or specify a reference character's appearance. English visual/action/camera remain per-clip generation outputs.
- Background and optional previous-shot context go to the text model for deriving the current clip's directions. They are not formatter arguments and are not mechanically appended to the exported prompt as `Shared setting` or previous visual/action/camera blocks.
- A shared renderer serves both legacy Planner H3 helper output and the adopted-clip helper. The export contains short subject/reference and retention instructions, one `[Shot 1]`, current visual/action/camera, one exact dialogue/mouth instruction and `non_diegetic_music: N/A`. It removes `summary` and the complete six-section wrapper, repeated setting/continuity text and duplicated sound paragraphs.
- Character appearance still follows `<Picture 1>` rather than invented details. `<Audio 1>` remains the complete unchanged final track with `fully_copy`; no additional sound or music. Current engineering dialogue is injected verbatim, and clip prompts retain real measured audio duration.

The existing request/data relationship is retained: new shots default to independent generation; optional continuity uses the adjacent preceding voice's current complete storyboard. The text model still receives that reference, and predecessor content remains bound for staleness checking. Removing previous text from the final export does not remove its generation influence or dependency.

Old English backgrounds, existing edited shots, audio IDs/durations and predecessor metadata are preserved. They are not translated, overwritten or regenerated on refresh. The optional Project JSON schema, current-source checks, editable stale/incomplete notes, copy/download gating, cancellation, audio undo and video-independent audio fingerprints retain their established behavior. Generation prompts express the language/creative constraints; schema validation does not prove the output's artistic quality.

## Verification and limits

Evidence root: `I:/AI/asmr-director-concise-h3/2026-10-02`. Full Vitest passes **86 files / 956 tests**, one existing opt-in file/test skipped (`full-tests.log`). Full ESLint, TypeScript and production Webpack build pass (`eslint.log`, `typecheck.log`, `build.log`); documentation links and diff are checked at closeout. Current production is **3001 / PID20660 / `.next-concise-h3-production` / HTTP200**, native D: output with cache-only junction to this evidence root's `next-cache`. Preview **3002 / PID23072** was identity-checked and stopped. See [AI_HANDOFF](../../AI_HANDOFF.md) for the explicit restart command.

`browser-verification.json` records **two successful browser requests for external DeepSeek text generation**: a 47-character Chinese Planner background and a regenerated first-clip storyboard. Both requests succeeded in the UI; upstream internal repair calls and token costs were not collected. The current project's background was explicitly edited to 48 Chinese characters preserving its apartment/late-night food/sleep story. Existing first-shot output shrank **2,921 → 1,569 characters** through the renderer alone, without changing visual/action/camera; the regenerated result is **907 characters**, about **69% shorter** than the original. New visual/action/camera lengths are **193 / 59 / 42 characters**. The current adopted asset, exact dialogue and **3.210-second measured audio** remain bound. Export has no summary, full background or repeated previous-shot text; clipboard exactly matches the 907-character preview.

Reload preserves the 47/48-character backgrounds and exact 907-character prompt. Planner's **seven paragraphs**, engineering **22 voice clips**, timeline and adopted states remain unchanged; all **76 WAV SHA-256 values match** (`audio-hashes-before.json`, `audio-hashes-after.json`). Other saved shots, including third/fourth, retain their fields and become stale after the explicit background change; regenerate them only at the user's choice. Desktop **1182×892**, **390×844** and **320×740** have no page horizontal overflow. Console errors: zero; viewport restored. Screenshots were visually inspected in tool output, not saved. TXT bytes are covered by passing tests; the actual downloaded file was not reopened.

There were **zero TTS / zero H3-video calls**, no new project and no image upload. The text/model and prompt checks do not prove rendered-video quality or new listening acceptance. No commit or push was requested. Prior specs remain historical; [the development record](../../records/2026-10-02-audio-quality-v1-concise-h3.md) records this iteration's evidence.
