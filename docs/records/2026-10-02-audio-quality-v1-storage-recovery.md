# Bug record — Full-disk batch generation and runtime storage recovery

Date: 2026-10-02

Route: existing **人声导演与真实 ASMR 音效质量 V1 / Audio Quality V1** in [ROADMAP](../ROADMAP.md). No new stage or documentation framework.

Status: **fault recovery, automated checks, production build and real-candidate smoke verified**. Audio Quality V1 remains in progress as a whole. No commit/push requested or performed for this new work.

## Cause and preserved evidence / 原因与保留证据

本次批量音频故障根因是D盘可用空间降至零，导致公开素材直接写入失败及运行锁写入中断。不是候选容量耗尽：故障时manifest有效JSON含36个候选，单片段最多7个；此前两个成功新候选完好。失败留下**9个零字节WAV及1个截断WAV**，均未被候选manifest引用，全部保留为取证，不把它们当成可采用音频。`incomplete-assets-evidence.json`记录截断文件524,288字节而RIFF声明2,150,444字节。

Evidence root: `I:/AI/asmr-director-batch-generation-recovery/2026-10-02`. The complete original source recordings remain under the existing **`ASMR_VOICE_WORK_ROOT=I:/AI/asmr-director-voice-work`**. Recovery did not regenerate those failed original recordings or delete their evidence.

One zero-byte `locks/voxcpm2-generation.lock`, created at 15:24:09, was moved to the evidence root's `abandoned-voxcpm2-generation.lock` only after Next was stopped and no audio child processes remained. This was an identified abandoned lock recovery, not blanket deletion of malformed or foreign locks.

## Storage relocation / 存储迁移

先复制并逐文件SHA校验：runtime **assets 112文件 / 84,795,530字节**、**tmp 1,146文件 / 362,246,998字节**迁移到 **`I:/AI/asmr-director-runtime-storage/{assets,tmp}`**。原D目录随后可恢复移到本轮证据根 **`original-runtime-directories/{assets,tmp}`**，原D路径改为指向新目标的junction，公开素材URL及调用配置不变。快照为`assets-before-relocation.json`、`tmp-before-relocation.json`。此检查点D剩余449,232,896字节（约428MiB），I约78GB；后续日志/临时检查继续放I。

## Fixes / 修复

- Clip and mix asset saves share a same-directory exclusive temporary write followed by rename. Failed partial writes/publishes clean only their owned temporary; existing public audio and unrelated temporaries remain intact. Original filesystem errno propagates. Ten targeted asset-store tests and ESLint pass (`asset-store-tests.log`, `asset-store-lint.log`).
- Native runtime-session cleanup verifies its own inode and attempted initial prefix; existing-child ownership and late-result guards remain. Other owners' locks are not removed.
- Shared storage errors map ENOSPC/quota/native disk-full failures to **HTTP 507 / `INSUFFICIENT_STORAGE`** across provider, JSON/NDJSON API and generation bridge. An unpublished original provider temporary is retained for recovery.
- The queue **stops** on storage-fatal errors, preserves completed candidates and does not dispatch remaining items. Ordinary per-item failures still continue. App clears a stale voice error at audio-batch start and reports the last fatal error plus the unprocessed count when stopped.

## Final verification and recovery / 最终验证与恢复

**90 files / 1,028 tests pass**, one existing opt-in file/test skipped (`full-tests.log`); whole ESLint / TypeScript and production Webpack build exit zero (`eslint.log`, `typecheck.log`, `build.log`). Storage errno propagation, atomic partial-write failure, lock ownership/recovery, terminal bridge updates and fatal-stop versus ordinary-failure behavior have automated coverage. No repeated full checks are run by the documentation work.

`recovery-verification.json`, produced by `verify_recovery.py`, records the real UI **audio_missing / 音频全部生成** smoke with **12 targets**. The first item, voice paragraph **11**, completed and published one ready candidate **`vox_719209e4b91645eda32c7125b90b8932`**. The second native job had started when canceled: final **success 1 / failure 0**, with no claim that all twelve completed. Candidate count for paragraph 11 is **7→8**, retained after reload and available for manual adoption; **no automatic adoption** occurred. All four actions recover with counts **12/22/2/10**. The candidate carries the honest **88.9% text-similarity warning requiring listening**; technical recovery is not a claim that its listening quality passed.

The candidate WAV is **9.56 seconds / 917,804 bytes**, and its full original is **26.24 seconds / 2,519,084 bytes**. Both are complete by RIFF size and decoded-frame validation, stored on I: under runtime assets and voice-work respectively. This smoke creates one real VoxCPM2 candidate plus speech analysis and cancels the next native generation; it does not regenerate the earlier failed source recordings.

**111 immutable asset SHA-256 values match** after smoke (`existing-assets-preservation.json`); all **36 previous candidate records are deeply unchanged**. Browser project dialogue and all **22 timeline entries/adopted states** remain unchanged. Console errors/warnings empty and no horizontal page overflow. Screenshots were inspected through the browser only, with no saved local image artifacts.

Current production: **3001 / PID2212 / `.next-batch-generation-production` / HTTP200**. Old PID28252 is stopped. After cancellation the generation lock is absent and no audio child processes remain. Restart explicitly with the established I-drive work/temp roots:

```powershell
Set-Location 'D:/CodexWorkplace/asmr_director/apps/web'
$env:ASMR_NEXT_DIST_DIR = '.next-batch-generation-production'
$env:ASMR_VOICE_WORK_ROOT = 'I:/AI/asmr-director-voice-work'
$env:ASMR_BATCH_DOWNLOAD_TEMP_ROOT = 'I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```

See [AI_HANDOFF](../AI_HANDOFF.md) for the latest recovery entry. Local documentation links, whitespace, restart syntax and diff are checked at closeout; no restart or extra generation is performed by this documentation work.
