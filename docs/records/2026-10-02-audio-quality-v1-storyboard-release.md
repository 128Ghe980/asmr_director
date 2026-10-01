# Development record — Batch audio and audio-bound storyboard milestone

Date: 2026-10-02

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). The broader route remains in progress; this release introduces no top-level stage.

Status: **implementation and verification complete; recording, commit and push explicitly authorized by the user** with “记录一下推一版”. The local release contents are prepared. Actual Git delivery is established by the branch log, upstream comparison and external receipt described below; this pre-publication record does not assert a completed push.

## Release scope / 发布范围

This milestone gathers the completed work since `6c43758`:

- Adopted-audio batch ZIP download, one project folder containing paired raw/processed WAV folders and a manifest. Raw bytes remain unchanged; applicable processing preserves full source duration and the original D tail. The compact green download control includes progress, cancellation and error recovery. [中文说明](../superpowers/specs/2026-10-01-batch-adopted-audio-download.zh.md) / [English spec](../superpowers/specs/2026-10-01-batch-adopted-audio-download.md).
- Planner text/storyboard persistence and compatibility, followed by the current **文案 / 场景** first step and project voice clips' **声音 / 分镜** inspector. Clip storyboards bind the current adopted local WAV, exact engineering dialogue and measured duration. Optional adjacent-voice continuity defaults off; stale sources disable prompt use while preserving edits. Audio adoption undo preserves current video metadata. [中文说明](../superpowers/specs/2026-10-01-adopted-clip-video-storyboards.zh.md) / [English spec](../superpowers/specs/2026-10-01-adopted-clip-video-storyboards.md).
- Short Chinese story backgrounds and a shared concise H3 renderer. Background and predecessor text guide the text model without being pasted wholesale into exports. Existing metadata remains editable; background changes can make old shots stale without rewriting them. The compact template is a product adaptation of the official guidance. [中文说明](../superpowers/specs/2026-10-02-concise-h3-story-backgrounds.zh.md) / [English spec](../superpowers/specs/2026-10-02-concise-h3-story-backgrounds.md).

此前各功能记录中的“未要求提交 / 未提交推送”是功能验收时的历史快照。本次用户已授权累计记录、提交与推送；保留历史说明，不据此回退已完成实现。项目继续使用既有唯一 `docs/ROADMAP.md`，本次不新增初始化框架或另一套路线。

## Verification and recovery / 验证与恢复

The latest cumulative evidence is `I:/AI/asmr-director-concise-h3/2026-10-02`: **86 test files / 956 tests pass**, one existing opt-in file/test skipped; full TypeScript, ESLint and production Webpack build pass. Documentation and workspace `git diff --check` pass. This recording turn reuses those completed checks and makes no new model calls or service changes.

`browser-verification.json` proves the final first-shot prompt is **907 characters** (2,921 originally; 1,569 after renderer-only changes), exactly matching the clipboard and refresh result. The adopted asset, exact dialogue and measured **3.210 seconds** remain bound. Seven Planner paragraphs, 22 engineering voice clips, timeline/adoption states and **all 76 WAV SHA-256 values** are unchanged. Two browser external text-generation requests succeeded; upstream repair calls/token costs were not collected. No TTS or H3-video calls, rendered-video acceptance or new listening acceptance are claimed. TXT bytes are tested; the actual browser download was not reopened. Screenshots were inspected in the tool, not saved.

Production remains **3001 / PID20660 / `.next-concise-h3-production` / HTTP200**, native D: output with cache-only junction to the evidence root's `next-cache`; preview 3002 is stopped. The latest explicit restart command and remaining Audio Quality V1 work are in [AI_HANDOFF](../AI_HANDOFF.md). Earlier evidence roots and contracts remain in the [feature record](2026-10-02-audio-quality-v1-concise-h3.md) and [archive](../project-archive.md).

## Git identity and delivery evidence / 提交身份与发布证据

- Branch: `codex/voxcpm2-product-generation`.
- Remote: `origin`, [128Ghe980/asmr_director](https://github.com/128Ghe980/asmr_director).
- Commit subject: `feat: add batch audio downloads and audio-bound H3 storyboards`.
- Publication receipt: `I:/AI/asmr-director-concise-h3/2026-10-02/release-verification.json`, written by the publishing task after the Git commands, with the actual commit SHA and remote comparison result.

Use `git log` on this branch and compare `HEAD` with `origin/codex/voxcpm2-product-generation` to resolve the published revision. The receipt and final publishing output provide the exact SHA outside this commit, avoiding a self-referencing hash or an extra commit made only to insert that hash. No credential, generated media, cache or runtime build artifact is part of this documentation record.
