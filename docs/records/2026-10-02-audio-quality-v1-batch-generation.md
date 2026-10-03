# Development record — Project batch generation

Date: 2026-10-02

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). No new roadmap stage or documentation framework.

Status: **implementation and verification complete**. Audio Quality V1 remains in progress as a whole. This new work is not committed or pushed and has no publication request; the previous milestone's authorization does not extend to these changes.

## Later paragraph audio colors / 后续分段音频颜色标识

Status: implementation and verification complete; parent Audio Quality V1 remains in progress, no commit/push. Each voice paragraph has a green/adopted, gray/pending or amber/generated-unadopted dot above its number, with a matching selected text badge. Generating/failed badges keep their existing priority; unknown candidate-dependent states use an outline dot and accessible text. Shared `getStudioAudioProgress` returns counts and per-clip states from the same classification, preserving overview validity and batch target rules.

Evidence root: `I:/AI/asmr-director-audio-markers/2026-10-02`. **Five targeted files / 45 tests pass** (UI33, domain12), full TypeScript (`domain-types.log`), changed-file ESLint (`ui-eslint.log`, `domain-eslint.log`), production Webpack build (`build.log`) pass; existing SWC/WASM fallback warning remains. `marker-verification.json` records 22 paragraph dots **10/10/2**, selected amber/pending text statuses, no page overflow at 1182×892/390×844/320×740, viewport reset and empty console error/warn logs. Dialogue and timeline match the pre-change browser snapshot; all **114 asset files and SHA-256 values** match the overview baseline (`asset-preservation.json`). No real TTS/text-model/H3 generation or user candidate adoption/discard occurred. Current production **3001/PID17804/`.next-batch-generation-production`/HTTP200**; old PID6176 stopped after identity/no-generation checks. I-drive roots and restart command below remain valid. Earlier runtime/test evidence is historical.

## Later audio overview addition / 后续音频总览新增项

Status: **this addition's implementation and verification complete**; existing Audio Quality V1 remains in progress. No commit/push requested or performed.

工程音频总览按「已采用 / 待生成 / 已生成未采用」统计互斥非空voice段落；采用优先，其余当前ready候选算已生成未采用，没有有效候选算待生成。同段多个候选只计1，discarded/其他工程/不存在clip/来源及long-text上下文过期忽略；声音options变化不失效。一次工程级API读取共享候选，检查面板只筛选所选clip，切换片段不逐段请求；生成/放弃刷新，采用/撤回/编辑重新派生。候选加载/错误时依赖数字显示—，不以虚假零混淆未加载与没有候选；原批量目标规则保持。

Evidence root: `I:/AI/asmr-director-audio-overview/2026-10-02`. **Seven unique targeted files / 66 tests pass**: UI35 (initial34 plus one adoption/undo/discard regression), domain12, candidate API19 (`ui-tests.log`, `candidate-actions-tests.log`, `domain-tests.log`, `candidate-api-tests.log`). Full TypeScript exit zero (`typecheck.log`), changed-file ESLint pass (UI/domain/API/action lint logs), production Webpack build exit zero (`build.log`), retaining the existing SWC/WASM warning. The prior 89/990 batch acceptance and 90/1,028 storage recovery remain historical; the 1,028-test full suite was not repeated for this addition.

`overview-verification.json` records **10/10/2 = adopted/pending/generated-unadopted**, totaling **22 nonempty voice paragraphs**. Paragraph 11's inspector retains **eight candidates / 9.6-second display** after selection; overview counts do not change. Existing `audio_missing` remains **12 unadopted targets**, including the two candidate-bearing paragraphs, rather than only the ten pending paragraphs. All dialogue, 22 timeline/adoption entries and **114 asset files including manifest SHA-256 values** are unchanged, with no additions/deletions (`assets-before-overview.json`). Desktop **1182×892**, **390×844** and **320×740** have no page horizontal overflow, all four buttons remain within the viewport, viewport reset and console errors/warnings empty. Screenshots inspected through the browser, not saved.

**Zero real TTS / text-model / H3 calls and zero user-project adoption/discard actions**. Adoption/undo/discard plus refresh are covered by the real App with simulated HTTP. Current production: **3001/PID6176/`.next-batch-generation-production`/HTTP200**; old PID2212 was identity-checked and stopped after confirming no generation. Restart environment remains the existing I-drive voice-work/batch-temp roots, as in the latest [AI_HANDOFF](../AI_HANDOFF.md). Documentation work makes no extra generation, restart, full-suite run or publication; existing [English spec](../superpowers/specs/2026-10-02-project-batch-generation.md) / [中文说明](../superpowers/specs/2026-10-02-project-batch-generation.zh.md) routes are retained.

## Scope / 范围

工程编辑区新增音频/分镜两个组，各有「全部生成」「全部重生成」。音频补缺跳过`asset_generated`且ID/URI均非空的采用素材；全部音频沿当前引擎重生：VoxCPM2保存新候选，原采用音频直到手动采用仍有效；GPT-SoVITS继续既有`succeeded`直接提交素材。分镜补缺跳过任何已有镜头，包括过期/不完整手改；全部分镜重生覆盖符合条件的已采用本地人声分镜，每项失败保留原稿。串行队列提供进度、取消和失败继续，启动目标固定，派发/接受前读取最新工程重新核对来源；换工程、卸载、相关来源变化及迟到结果不能造成错写。

See [English spec](../superpowers/specs/2026-10-02-project-batch-generation.md) / [中文说明](../superpowers/specs/2026-10-02-project-batch-generation.zh.md). StudioApp owns coordination, a shared helper owns target/source rules, and the engineering UI owns compact controls; documentation review makes no production edits or generation calls.

## Read-only bridge review / 只读桥接核对

`GenerationBridge.generateClip` returns a job-start promise; LocalGenerationBridge currently resolves after completion, while the mock bridge can resolve before its timers finish. `waitForStudioVoiceGeneration` waits for terminal updates and settles cancellation/rejection. App cleanup tracks the item job ID, removes runtime/fingerprint/window ownership and cancels a still-active job when startup rejects after a snapshot. Current refs guard ownership/source checks instead of relying on a stale render's busy value. Engine behavior is preserved: VoxCPM2 candidate/manual adoption, GPT-SoVITS direct asset commit.

ClipStoryboardEditor reports manual request busy/provider state through stable callbacks; the parent blocks batch start during a manual request and the child locks generation and edits during a batch. Saved-shot comparison protects hand edits. Missing shots generate independently; existing previous-clip references are preserved and revalidated when regenerated.

## Evidence and closeout / 证据与收口

Evidence root: `I:/AI/asmr-director-batch-generation/2026-10-02`. Keep logs/scratch on I: because D: free space is constrained.

Full Vitest: **89 files / 990 tests pass**, one existing opt-in file/test skipped (`full-tests.log`). Final full ESLint / TypeScript exit zero (`eslint.log`, `typecheck.log`); production Webpack build exit zero (`build.log`), with the existing SWC warning successfully falling back to WASM. Automatically changed tsconfig include/formatting was restored. Helper/App/child/UI tests cover targets, terminal waiting, startup rejection after a snapshot, partial failure, cancellation/late writes and manual/batch locking. Audio engine behavior is verified automatically; no real audio batch was run.

D: exhaustion interrupted a write; StudioApp and the helper test were restored and reconnected before the passing checks. Five unused old build `server` directories were moved recoverably to this evidence root's `unused-build-server-backups` (`.next-clip-storyboard-production`, `.next-batch-production`, `.next-semantic-build`, `.next-batch-build`, `.next-spatial-build`). The running concise build was left intact during recovery, then replaced at the verified production handoff. Current production is **3001 / PID28252 / `.next-batch-generation-production` / HTTP200**, native D: output with cache-only junction to this root's `next-cache`. Old 3001/PID20660 and preview 3002/PID624 were identity-checked and stopped.

`browser-verification.json` records the real **storyboard_missing** run with six initial targets: progress **0/6 → 5/6**, then cancel notice **“已取消批量生成：成功 5。”**. Voice paragraphs **5–9** were generated and saved; paragraph **10** was not saved. Saved shots **[1,3,4] → [1,3,4,5,6,7,8,9]** persist after reload, and the five new shots remain available in the user's current project. Mode counts **13/22/6/9 → 13/22/1/9** persist. All four actions and child editing lock during the run and recover after cancel; copying/TXT retain their existing availability under the automated child tests. The first shot's fields/prompt and all **22 voice texts/timeline/adopted labels** are unchanged. All **76 WAV SHA-256 values** match before/after. Shot 5, “温暖归家”, has an **881-character** prompt with exact dialogue, measured **3.32-second** audio and no summary.

Five external text results were accepted and the sixth item was canceled with no saved shot; upstream internal request/repair counts and token costs were not collected. **Zero TTS / zero H3-video calls**; do not call this a zero-LLM or zero-paid-call run. No rendered-video or new listening acceptance is claimed. Desktop **1182×892** places both groups in one row; **390×844 / 320×740** use two rows with no page horizontal overflow or clipped buttons. Console errors zero, viewport reset. Screenshots were inspected through the tool, not saved as local image artifacts.

Restart explicitly; `.env.local` may name the previous output:

```powershell
Set-Location 'D:/CodexWorkplace/asmr_director/apps/web'
$env:ASMR_NEXT_DIST_DIR = '.next-batch-generation-production'
$env:ASMR_BATCH_DOWNLOAD_TEMP_ROOT = 'I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```

Six-document status/link/whitespace and documentation diff checks are completed at closeout. This documentation work makes no generation calls, restart, staging, commit or push; it records the real results produced by the main verification task.
