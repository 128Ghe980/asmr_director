# Development record — Concise H3 prompts and Chinese story background

Date: 2026-10-02

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). No new top-level stage.

Status: **done for this implementation and verification**; automated checks, two browser requests for external text generation and production-browser verification pass. Audio Quality V1 remains in progress as a whole. No commit or push requested.

## Intent and implementation / 目标与实现

用户希望剧情背景是人看的简短中文说明，逐段模型据此派生具体画面；导出不重复背景全文、前镜全文或多处声音规则。当前设计使用共用 H3 renderer 服务 Planner / 工程两种 helper，省略 summary 与完整六段包装，保留当前英文画面 / 动作 / 镜头、原台词、参考外貌与完整音轨规则。

Official Ref documentation includes `summary` in its complete rewrite structure. The chosen compact product template is a deliberate adaptation, not a claim that the official complete format omits it. [Primary source](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)

背景及前镜只作为文字模型生成上下文；前镜的可选相邻 voice 限制与 stale dependency 保留。旧背景 / clip metadata / 手改内容不自动重写。现有真实已采用音频、实测时长、原文、保存 / 复制 / 版本 / 声音撤回保护与一屏布局沿用此前合同。

Changed areas: shared `h3-prompt.ts`, both H3 helper callers, scene and clip generation instructions, Planner/project background copy and relevant tests. Generated backgrounds are capped at 160 characters; storage/editing retains the 4,000-character legacy limit.

## Evidence and recovery / 证据与恢复

Evidence root: `I:/AI/asmr-director-concise-h3/2026-10-02`.

- Official research: first-party MiniMaxAI Ref guide read through the web; the user's Feishu handbook section four inspected in the browser. High-level input guidance and expanded rewrite output have distinct purposes.
- Full tests: **86 files / 956 tests pass**, one existing opt-in file/test skipped (`full-tests.log`); full TypeScript / ESLint / production Webpack build pass (`typecheck.log`, `eslint.log`, `build.log`).
- Runtime: **3001 / PID20660 / `.next-concise-h3-production` / HTTP200**; native D: output, cache-only junction to this evidence root's `next-cache`. Preview **3002 / PID23072** identity-checked and stopped.

`browser-verification.json` records **two successful browser requests for external DeepSeek text generation**, one 47-character Chinese Planner background and one first-clip regeneration. Both succeeded in the UI; upstream internal repair calls and token costs were not collected. Project background was explicitly edited to **48 characters**, retaining the apartment/late-night food/sleep story. Output length is **2,921 old → 1,569 renderer-only → 907 regenerated characters**; the final reduction is about **69%**. Renderer-only output preserves the original three fields; new visual/action/camera lengths are **193 / 59 / 42**. The current adopted asset, exact engineering dialogue and **3.210-second measured audio** remain linked. No summary, whole background or repeated preceding-shot text appears, and clipboard equals the entire 907-character preview.

Reload preserves both backgrounds and the prompt exactly. **Seven Planner paragraphs / 22 engineering voice clips**, timeline/adopted states and **all 76 WAV SHA-256 values** remain unchanged (`audio-hashes-before.json`, `audio-hashes-after.json`). Background changes make other old shots, including third/fourth, stale without deleting their fields; regeneration is user-controlled. No new project was created. Desktop **1182×892**, **390×844** and **320×740** have no page horizontal overflow; console errors zero, viewport restored. Screenshots inspected only, not saved. TXT bytes have passing automated proof; no reopened actual download is claimed.

`.env.local` names an older build. Restart explicitly and preserve the existing I-drive batch-download temp root:

```powershell
Set-Location 'D:/CodexWorkplace/asmr_director/apps/web'
$env:ASMR_NEXT_DIST_DIR = '.next-concise-h3-production'
$env:ASMR_BATCH_DOWNLOAD_TEMP_ROOT = 'I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```

**Zero TTS / zero H3-video calls**. No rendered-video quality, new listening acceptance or automatic rewriting of old metadata is claimed. The data and audio protections established in the previous clip-storyboard feature remain in place. Local Markdown links, documentation diff and the restart-command syntax are checked at closeout; no service is restarted by this documentation work.

## Sync / 同步

Added [English spec](../superpowers/specs/2026-10-02-concise-h3-story-backgrounds.md) / [中文说明](../superpowers/specs/2026-10-02-concise-h3-story-backgrounds.zh.md), this record and latest ROADMAP/HANDOFF/archive entries. Prior specs are preserved as historical contracts, rather than rewritten to describe new behavior. Final verification and runtime recovery are synchronized; older specs retain their historical scope.
