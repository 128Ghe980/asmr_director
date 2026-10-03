# Development record — Batch workflow release and conversation handoff

Date: 2026-10-03

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). The parent stage remains **in progress**. This publication checkpoint introduces no top-level stage or new documentation framework.

Status: implementation and verification complete; the user explicitly authorized recording, commit, push and handoff with **“记录一下，推一版，我要交接给其他会话”**. The cumulative release since `8f22021` is prepared. Actual commit SHA, push result and remote equality are resolved through Git and the external receipt below; this record does not claim publication before the publishing commands finish.

## Release scope / 发布范围

- Engineering editor batch actions: generate missing audio, regenerate all audio, generate missing storyboards and regenerate all storyboards. The queue is serial, cancelable and guarded against source changes and late responses. Ordinary item failures continue; VoxCPM2 produces candidates requiring manual adoption, while GPT-SoVITS retains its direct commit behavior. Missing audio skips adopted assets; missing storyboards preserve any saved shot, including stale hand edits. [English spec](../superpowers/specs/2026-10-02-project-batch-generation.md) / [中文说明](../superpowers/specs/2026-10-02-project-batch-generation.zh.md), [development record](2026-10-02-audio-quality-v1-batch-generation.md).
- Storage-failure recovery: atomic asset publication, owned generation-lock protection and `507 / INSUFFICIENT_STORAGE` propagation stop the queue on exhausted storage while preserving completed work. The existing assets/tmp runtime paths are junctions to I:; original files, incomplete recordings and full sources remain recoverable. [Storage record](2026-10-02-audio-quality-v1-storage-recovery.md).
- Audio overview and paragraph colors share the same adopted/pending/generated-unadopted classification. Loading or failed candidate reads do not report false zero. Audio-generation targets remain based on adoption rather than merely having a candidate. Details and validation are in the [batch-generation record](2026-10-02-audio-quality-v1-batch-generation.md).
- Batch download transport: small JSON preparation metadata followed by a same-origin native token GET fixes the embedded browser's binary-fetch failure. Legacy binary audio POST remains compatible. Packages are single-use, expire, have bounded capacity and clean up on completion/cancellation/failure. [Recovery record](2026-10-02-audio-quality-v1-batch-download-recovery.md).
- Per-paragraph **连续镜头 / 新镜头** preferences and the adjacent 32px icon toggle persist and synchronize with the inspector. Continuous requires the usable adjacent previous storyboard; new shot prioritizes background/current dialogue and can work without one. Serial batches use the newly saved predecessor and recheck sources before accepting results. [English spec](../superpowers/specs/2026-10-02-storyboard-reference-modes.md) / [中文说明](../superpowers/specs/2026-10-02-storyboard-reference-modes.zh.md), [record](2026-10-02-audio-quality-v1-storyboard-reference-modes.md).
- Right-side storyboard status colors and batch TXT export: green ready, gray pending, amber needs update. The top download popover has **音频 / 分镜** tabs. Storyboard ZIP includes one exact existing UTF-8 H3 prompt per usable paragraph, retains original paragraph numbers and skips missing/stale/incomplete prompts without generation. [English spec](../superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.md) / [中文说明](../superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.zh.md), [record](2026-10-03-audio-quality-v1-storyboard-status-export.md).

此前记录中“未提交 / 未要求推送 / 没有新授权”是各功能验收时的历史快照。当前用户已明确授权累计发布与交接；保留旧证据，不把这些旧句子当作本轮禁止提交的指令。

## Verification boundaries / 验证与边界

Latest verified code state: **12 unique targeted test files / 211 tests**, **16 related source/test files ESLint**, separate full TypeScript and production Webpack build pass. Old audio-download and manual-storyboard regressions are included. Existing Windows SWC warning falls back successfully to WASM; build-only `tsconfig.json` changes were restored. Evidence root: `I:/AI/asmr-director-storyboard-export/2026-10-03`.

The prior storage-recovery **90 files / 1,028 tests** full suite and reference-mode **9 files / 181 tests** are their own historical checkpoints. They were not rerun as part of the latest 211-test verification or this recording task. Do not add overlapping snapshots or claim a fresh full suite without its log.

Actual project **深夜回家，小安陪你吃碗热汤面**, at the latest browser checkpoint: **22 voice paragraphs, storyboards 8 ready / 13 pending / 1 needs update**. The actual downloaded ZIP has **8 TXT / 10,645 bytes**; all CRC, exact UTF-8 prompt bytes, dialogue/`fully_copy` occurrence checks and original numbers `001/002/003/005…009` pass. Desktop/390px/320px have no horizontal overflow; viewport reset and console clean. All **29 visible Planner/project dialogue values, title, timeline DOM groups and 138 asset hashes including manifest** are unchanged. See `browser-verification.json`, `browser-zip-verification.json`, `final-runtime-assets-verification.json` and `storyboard-status-export.jpg` in that evidence root. These are verification-time values; read current project/candidates before treating counts as current user state.

This publication/handoff work does not create model jobs, adopt/discard candidates or alter user dialogue. Existing real generation evidence is preserved: the earlier storyboard batch accepted five external text results before cancellation; storage recovery generated one ready VoxCPM2 candidate before canceling the next task. Those snapshots are not claims of all-target completion or listening acceptance. No H3 rendered-video acceptance or new audio-quality acceptance is established by this release.

## Runtime and next conversation / 运行与接续

Latest feature verification: **127.0.0.1:3001 / PID14196 / `.next-batch-generation-production` / HTTP200**, no generation lock and empty package-temp directory. A PID is a checkpoint, not a permanent service identity; reconfirm listeners/process identity before restarting. The publication receipt records the publishing task's fresh runtime check. [AI_HANDOFF](../AI_HANDOFF.md) carries the current restart command.

Fresh publication check at **2026-10-03 23:29 +08:00** reconfirmed the same Node/Next process, HTTP200, no generation lock and an empty download temp directory. D: has about 360 MiB free; continue using I: for artifacts. See `release-runtime-verification.json` in the evidence root. Fetching origin found the prepared base equal to upstream before committing.

- `ASMR_VOICE_WORK_ROOT=I:/AI/asmr-director-voice-work`.
- `ASMR_BATCH_DOWNLOAD_TEMP_ROOT=I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads`.
- `D:/CodexWorkplace/asmr_director_runtime/{assets,tmp}` are junctions to `I:/AI/asmr-director-runtime-storage/{assets,tmp}`. Preserve both the junctions and recoverable original-directory backups; use I: for logs and scratch because D: remains constrained.

下一会话先读 `AGENT.md` → `docs/ROADMAP.md` → `docs/PROJECT_MANAGEMENT.md` → `docs/AI_HANDOFF.md`，再看 Git 状态与本发布记录。保留当前浏览器工程、已采用音频、全部候选及分镜手改，不用旧测试工程覆盖用户状态，也不重复已验收的批量生成、颜色、连续模式和下载功能。下一步仍以唯一 ROADMAP 为准：**真实 ASMR SFX、垂直运动与通用“更柔”表达尚未完成**；只有用户新指令才改变方向。

## Git identity and delivery evidence / 提交身份与发布证据

- Branch: `codex/voxcpm2-product-generation`.
- Remote: `origin`, [128Ghe980/asmr_director](https://github.com/128Ghe980/asmr_director).
- Prepared base: `8f22021` (`feat: add batch audio downloads and audio-bound H3 storyboards`).
- Commit subject: `feat: complete batch generation and storyboard export workflow`.
- Publication receipt: `I:/AI/asmr-director-storyboard-export/2026-10-03/release-verification.json`, written by the publishing task with actual commit SHA, push result, `HEAD`/upstream comparison, runtime and documentation checks.

Use this branch's `git log` and compare `HEAD` to `origin/codex/voxcpm2-product-generation` to identify delivery. Exact SHA belongs in that external receipt and the final publishing response, avoiding a self-referencing hash or recursive documentation commits. Generated media, user project JSON, runtime builds, caches, credentials and machine-local evidence are not release source files.
