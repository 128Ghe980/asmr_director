# Development record — Audio Quality V1 semantic workspace and extraction

Date: 2026-10-01

Route: the existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** stage in [docs/ROADMAP.md](../ROADMAP.md). No new roadmap step or competing route file is created.

Status: **done for this implementation and handoff**; Audio Quality V1 as a whole remains **in progress**. The user explicitly requested recording, committing and pushing the accumulated changes for another conversation.

## Intent and completed work / 目标与完成内容

- Let users decide short text ranges for manual edits, insertion, deletion, splitting, AI rewriting and voice regeneration. Initial creative drafts use semantic short units shared with the editor; tools appear for the selected unit. Editing during generation cancels affected work and prevents late results replacing newer text.
- Keep the editor inside one viewport: aligned text/sound panels scroll internally, the timeline sits below them, and common voice controls appear before folded advanced controls. User waits follow actual adopted speech durations.
- Generate short targets using forward project context, preserving the selected long-generation/opening-extraction approach. The semantic window is bounded to 16 total target/context clauses plus the separate 500-character limit; this fixes the native failure caused by 69 clauses. Context participates in stale-candidate and cancellation checks.
- Preserve source/cropped ASR, word timestamps, diagnostics and checkpoints through success, failure, timeout and cancellation. Show a compact folded comparison in candidates and complete-original entries.
- Preserve the original 90% / at-most-two equal-length substitution path. Add a separate ending-anchor path for targets of at least ten normalized characters, 85% similarity and at most two edits. Whole-prefix content, immediate continuation, whole-word timestamps and independent recognition on both sides of real quiet jointly determine a cut. Reordering, extra repetition and ambiguous internal mappings do not pass.
- Reuse the configured external text API only after eligible local alignment failure. It selects one existing candidate word index or declines, has a 15-second deadline, and cannot invent a timestamp or bypass local reanalysis. Record selected/declined/unavailable status. Fix the real HTTP 400 by explicitly requesting JSON; model, credentials and existing thinking configuration are unchanged.
- Retain complete originals and explicit user adoption. No quality-triggered TTS retry; accepted original-D spatial processing is unchanged.

## Changed areas / 代码位置

- Editing and layout: `apps/web/src/components/studio/`, `apps/web/src/app/globals.css`.
- Semantic text and generation context: `apps/web/src/lib/asmr/planner*.ts`, `voice-segments.ts`, `voice-generation-context.ts`, generation/acceptance fingerprints and project-state helpers.
- Generation and verification: `voxcpm2-provider.ts`, `voice-longtext-*.ts`, `voice-group-analysis.ts`, `voice-analysis-worker.ts`, `voice-boundary-api.ts`, `voice-recognition.ts`, recording contracts and their tests.
- Local recognition and boundary checks: `apps/web/scripts/analyze-voice-group.py` and `test-analyze-voice-group.py`.
- Build-output ignores: `.gitignore`, `apps/web/eslint.config.mjs`.
- Bilingual specs: `2026-09-20-user-controlled-script-ranges`, `2026-09-20-semantic-script-workspace`, `2026-09-21-voice-recognition-inspection`, `2026-09-23-tolerant-voice-extraction`, `2026-09-24-ending-anchor-extraction` under `docs/superpowers/specs/`.

## Verification / 验证证据

Latest implementation verification, already completed before this documentation-only handoff:

| Check | Result |
| --- | --- |
| Vitest, 4 workers / 15-second test timeout | 67 files, 734 tests passed; one existing opt-in test/file skipped |
| Local Python analysis tests | 74 passed; no model download or TTS |
| Full ESLint and TypeScript | Passed |
| Next production Webpack build | Passed; existing Windows SWC/WASM fallback unchanged |
| Exact user “暖胃” recording | 22.56-second original → 0–7.11-second crop; 88.8889%; 啦→了 and omitted 儿 |
| Boundary proof | Independent two-sided recognition; quiet 7.00–7.55 s; retained tail 110 ms |
| Real configured external API | HTTP 200, index 13, 644 ms; text only, no audio or timestamps sent |
| Production browser | All 15 unit texts preserved on reload; difference display correct; original-D spatial playback completed at 7.76 s without media errors |
| Layout / console | 1768×1252 fits viewport; upper panels aligned; no new console warnings/errors |

Local evidence is outside Git: `I:/AI/asmr-director-ending-anchor/2026-09-24` and `I:/AI/asmr-director-ending-anchor/2026-10-01`, including `verification.json`, `tests-final.log`, `python-tests.log`, `build.log`, `api-check-after.json`, `candidate-persistence.json`, `browser-proof.jpg` and the candidate-manifest backup. Earlier specs link their corresponding evidence directories.

Documentation closeout rechecks Git scope, whitespace, local links, evidence availability, HTTP 200 and remote branch identity. No new implementation, generation or listening acceptance is claimed by this handoff.

## Current state and remaining work / 当前状态与未完成事项

- Branch: `codex/voxcpm2-product-generation`; remote: `origin`. The implementation and this record are published through the requested normal commit/push, without rewriting history.
- Local workbench: `http://127.0.0.1:3001/`, verified production PID 19500 at handoff, using `.next-semantic-build`. Recheck the listener before acting; PIDs are snapshots. The native generation lock is absent at handoff.
- Current project has 15 text units. Unit 11's new derived candidate `vox_8ea1c310dc5641f0ae1cee3b70824b8e` contains the successful 7.11-second crop. Original candidate `vox_d4766c98916e47b4ba1e1f9dc327f862` and original audio are unchanged.
- The user edited subsequent text after generating that source. The derived candidate intentionally retains its old context fingerprint and is previewable but stale for adoption. Do not rewrite provenance to remove the warning or restore old user text. New generation uses the current text/context and the new extraction rules.
- No candidate was adopted and no new TTS was performed for the ending-anchor reanalysis. This successful sample does not prove every ASR case or broader listening quality; unsupported/uncertain cases continue to deliver full original audio with a warning.
- Broader Audio Quality V1 remains in progress: real SFX, vertical motion and general softer expression. Fixed numbered roadmap steps and the accepted original-D result are not reopened.
- Models, credentials, user browser projects, generated WAVs and runtime assets are local and not committed. A different machine needs its own runtime/configuration; another conversation on this machine should preserve current storage.
- D: had about 35 MiB free at handoff. Put new scratch, logs and caches on `I:/AI`; do not silently delete/move old assets or models. `.next-semantic-build/cache` already points to I:.

## Resume / 下一会话入口

Read `AGENT.md`, `docs/PROJECT_MANAGEMENT.md`, `docs/ROADMAP.md`, then the top of `docs/AI_HANDOFF.md`; inspect Git status and current runtime before changes. Start with the user's next test feedback or the remaining accepted Audio Quality V1 work, rather than inventing a new route.

If port 3001 is stopped, run the existing verified build from `apps/web` (no rebuild/install needed merely to resume):

```powershell
$env:ASMR_NEXT_DIST_DIR = '.next-semantic-build'
$env:TEMP = 'I:/AI/asmr-director-ending-anchor/2026-10-01/tmp'
$env:TMP = $env:TEMP
$env:NODE_COMPILE_CACHE = 'I:/AI/asmr-director-ending-anchor/2026-10-01/node-compile-cache'
$env:CUDA_CACHE_PATH = 'I:/AI/asmr-director-spatial-integration/cuda-cache'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```

The explicit dist-directory override is necessary because `.env.local` still names an older output. Use a managed terminal session, or `Start-Process -WindowStyle Hidden` where background launch is supported. Do not clear a generation lock while its owner or child is alive.

## Record-system sync / 文档同步

This repository already has a user-approved fixed route and documentation system. The recorder workflow is applied through the existing `docs/ROADMAP.md`, `docs/AI_HANDOFF.md`, `docs/project-archive.md` and this record; it does not introduce a second `CURRENT_ROADMAP.md`, fabricate R-numbered stages or migrate project governance during a handoff. Current implementation is recorded as complete; the parent Audio Quality V1 stage remains in progress.
