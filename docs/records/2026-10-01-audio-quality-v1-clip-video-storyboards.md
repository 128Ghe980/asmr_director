# Development record — Shared scene and adopted-clip video storyboards

Date: 2026-10-01

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). No new top-level route or parallel roadmap is created.

Status: **done for this implementation and verification**. Automated checks, three real text-provider requests and production-browser verification pass. The parent Audio Quality V1 stage remains in progress; no rendered H3 video or listening acceptance is claimed. No commit or push was requested.

## Intent and implementation / 目标与实现

The user moved storyboard planning to the point where each voice has generated and adopted audio. Planner now prepares the script and one shared English base scene. Scene generation, regeneration, editing, local persistence, undo and adoption use the actual draft and existing provider. Earlier Planner storyboard data remains compatible, but is not automatically converted into audio-bound shots.

工程逐条人声旁可进入「声音 / 分镜」面板。每条视频分镜绑定当前采用的本地 WAV，服务端解码得到完整实测时长，模型仅返回标题与英文画面 / 动作 / 镜头。确定性 H3 prompt 使用原工程台词、独立 `[Shot 1]`、参考图外貌优先及当前 `<Audio 1>` `fully_copy`，不新增声音或编造时长。默认独立，可选只参考相邻前一条有效完整分镜。

Optional `project.videoPlan` survives Project JSON, duplication and revisions; damaged metadata is discarded independently. Exact text, asset, project scene/character and effective shared scene determine validity. Referenced predecessor edits/source changes propagate staleness iteratively. Empty/stale notes remain editable while copy/export is disabled. Video edits preserve audio jobs and audio fingerprints; audio-adoption undo restores the prior take while retaining current video metadata.

## Changed areas / 改动范围

- Planner: `planner-scene.tsx`, `planner-panel.tsx`, working persistence, source schema and draft adoption.
- Project UI: `clip-storyboard-editor.tsx`, per-line entry, voice inspector tabs and latest-project metadata merge in `studio-app.tsx`.
- Server: scene-description and clip-storyboard services/routes, bounded JSON input, cancellation, real WAV path/PCM validation and existing provider integration.
- Data: `video-plan.ts`, optional Project schema metadata, project storage/library and video-independent candidate undo.
- Automated checks: new scene/clip services and UI tests, video-plan pure tests and expanded persistence/library/candidate tests.

## Verification / 验证

Evidence root: `I:/AI/asmr-director-clip-video/2026-10-01`.

Verified data/helper baseline: **4 files / 116 tests** in `data-tests-final.log`. New `video-plan.test.ts` has **39 tests**; persistence/library/candidate files together have **77 tests**. Full `tsc --noEmit --incremental false`, owned production/test ESLint and `git diff --check` passed during data integration. This is scoped evidence rather than the final feature acceptance.

Final full Vitest: **86 files / 953 tests pass**, one existing opt-in file/test skipped (`full-tests-final.log`). Full TypeScript, ESLint, diff check and production Webpack build pass (`typecheck-final.log`, `eslint-final.log`, `diff-check-final.log`, `build-final.log`), including the existing successful Win32 SWC fallback. Interim `full-tests.log` retains the earlier 83/920 run before the final UI/integration additions. Production is **3001 / PID 25824 / `.next-clip-storyboard-production` / HTTP 200**; temporary 3002 is stopped. Native build output stays on D:, cache-only junction to this evidence root's `next-cache`. Earlier PID12896 is superseded.

`browser-verification.json` records **three successful DeepSeek-v4-pro requests**: base scene, third clip independently and fourth clip with third-clip reference. Measured durations are **3.24 / 8.59 seconds**. Clipboard readback uses exact current engineering dialogue, not the initial draft or previous clip; current full audio is `fully_copy` with `N/A` music. Fourth-clip continuity contains preceding visual/action/camera without preceding dialogue, and a new fifth clip defaults to independent. Second clip without adopted audio cannot generate. Editing the preceding camera invalidates the linked shot, preserves notes and disables copy; restoring it restores current availability. Empty global scene disables generation/copy. Reload preserves the shared scene, both shots, continuity and exact prompt. Planner's original seven texts remain exact, and its scene and enabled regenerate control also survive reload.

The current **22 voice clips / seven Planner sections**, engineering title, dialogue and timeline labels/timing remain unchanged. All **76 WAV SHA-256 values** match (`audio-hashes-before.json`, `audio-hashes-after.json`; raw record contents also match). Desktop **1768×1252** and mobile **390×844 / 320×740** have no document width/height overflow; inspector scroll dimensions are **397/1345** and **324/1527** at the mobile sizes. The per-line mobile button selects the matching storyboard panel and focus moves to its visible tab. Console errors: zero. Screenshots were inspected, not saved. TXT click was triggered; Blob contents/filename have automated proof, while no browser download path or reopened file is claimed.

## Recovery and limits / 恢复与边界

`.env.local` names an older build directory. Restart explicitly with the latest verified output and preserve the existing I-drive batch-download temp location:

```powershell
Set-Location 'D:/CodexWorkplace/asmr_director/apps/web'
$env:ASMR_NEXT_DIST_DIR = '.next-clip-storyboard-production'
$env:ASMR_BATCH_DOWNLOAD_TEMP_ROOT = 'I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```

There were **zero TTS / zero video-generation calls**, and no image upload is part of this implementation. The real text-provider checks above have their stated scope; do not claim a rendered H3 video, video quality or new headphone listening acceptance. Preserve the current user project and adopted source bytes; do not restore an older snapshot for future tests.

One-screen layout, unchanged scripts/audio, reload, independent/linked generation and stale/empty copy gating have real browser proof. Cancellation/late-response protections, clipboard failure fallback, TXT bytes/filename, old metadata/revisions and candidate undo have automated coverage. No further paid call or video render is required to reproduce these scoped checks. Audio Quality V1's existing unfinished sound-quality work remains on the established roadmap.

## Documentation sync / 文档同步

Added [English spec](../superpowers/specs/2026-10-01-adopted-clip-video-storyboards.md) / [中文 spec](../superpowers/specs/2026-10-01-adopted-clip-video-storyboards.zh.md), this development record and current entries in ROADMAP, AI_HANDOFF and project archive. Earlier verified H3/text-storyboard/batch-download history remains intact. The repository's established documentation system takes precedence over introducing another initializer route system.
