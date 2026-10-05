# 2026-10-04 — Generated personal-care SFX test stopped / 模型护理音效测试收住

## Superseding status — 2026-10-05 / 最新状态

用户反馈 **“相当烂，没法用，先这样吧，记录一下推一版”**。三条远端 AudioLDM2
8 秒刷耳输出全部被拒绝，判定不可用；实际计数仍为**本机 0 / 远端 3**，没有采用。
后续模型测试暂停，5070 Ti 主机问题不再作为下一步待答事项。Stable Audio Open
适配器与监督器已准备，但从未执行真实模型推理。独立的 **13 条 CC0 录音试听库
仍待听感确认**，不受此次模型输出拒绝结论替代。已授权记录与推送；实际提交和推送
结果见 [本次发布记录](2026-10-05-audio-quality-v1-sfx-rejection-release.md)，本条不提前宣称完成。

All three remote brush outputs were rejected as unusable, superseding their
initial pending listening status. Future model testing is paused; preparation
checks are not model inference. The attempt and research evidence below are
historical 2026-10-04 checkpoints.

## Historical steering — 2026-10-04 / 历史指令

用户要求独立生成掏耳、刷耳、按摩、喷雾，避免一条摩擦反复使用；随后报告
约五小时且难以中断，明确要求内存不足时先调研其他方案。当前生成已停止，
仅完成只读调研，没有恢复任务、安装或调用付费接口。音质 V1 仍在进行中。

The user requested independent generated care effects, then stopped the long
attempt and requested alternatives research. Generation is stopped; no new
installation, download or paid call was made during this research-only closure.

## Historical actual results / 历史实际结果

- **Local 0**: first model loading crashed in `torch_cpu.dll` (Windows access
  violation); two subsequent attempts recorded CUDA memory failures, including
  `AcceleratorError` and `OutOfMemoryError`. No local audio was delivered. Logs
  also contain host `MemoryError`; root cause is not established as hardware
  capacity alone. Thread limits and lazy CUDA loading did not produce output.
- **Remote 3**: independently seeded brush candidates, 8 seconds / 16 kHz mono
  PCM16 each. Successful job/SSE receipts and raw hashes are saved. Next massage
  job failed because ZeroGPU quota was exhausted, stopping the queue. Remote
  timing includes queue/network/download, not local CUDA inference.
- Intended local 18 / remote 16 take matrices were **not completed**. The three
  generated outputs initially awaited listening and were all rejected on
  2026-10-05; no longer care take exists.
- Official AudioLDM2 download completed: revision
  `c8e7e189d324425c05c4c2f81214041ef4107983`, 26 files /
  4,480,952,551 bytes, all official hashes verified. Weights and parts remain on
  I:, outside Git. Reused runtime packages were not changed. CC-BY-NC-SA-4.0
  applies; these are isolated noncommercial candidates.

## Historical evidence and boundaries / 历史证据与边界

Evidence root: `I:/AI/asmr-director-sfx-model-test/2026-10-04`.

- `audioldm2-download-receipt.json`: completed download and source/hash checks.
- `local/generation-manifest.json`, `local/smoke-run.log`,
  `local/smoke-retry-threads1.log`, `local/smoke-retry-lazy.log`: failed local
  attempts, native/CUDA errors and measured memory fields.
- `remote/generation-manifest.json`, `remote/receipts/`,
  `remote/partial-batch-verification.json`: three actual outputs plus quota
  failure; original/source receipt hashes, finite nonzero audio, unique files.
- `remote/browser-verification.json`: six raw/audition WAVs decode; three native
  players, single-player/stop/filter and 1280/390/320px checks pass. Preview was
  `http://127.0.0.1:8769/`; runtime availability is a historical checkpoint.
- `stopped-and-preservation.json`: at 08:30:03 +08:00, owned generation processes
  0, local 0 / remote 3, protected files 151 / changed 0. A subsequent read-only
  CIM process check also found no `generate.py` / `generate_remote.py` Python.

Raw files stay unchanged; listening copies adjust gain only. No ASMR acceptance,
production adoption, new app build, commit or push is claimed. Repetition checks
are screening aids, not listening certification. The later full-wave FFT detector
was verified with synthetic fixtures, but not rerun on these actual remote takes;
the existing browser receipt applies to its earlier page/report. At this
checkpoint no timeout supervisor or Codex conversation cancellation fix was
implemented. The later Open [preparation record](2026-10-04-audio-quality-v1-stable-open-resume.md)
records the implemented supervisor's synthetic checks, without model inference
or a Codex conversation cancellation fix. Model tests are now paused.

本机成功 0 条、远端成功 3 条是两类事实，不能把远端试听页当作本机验收。
下载成功也不代表推理支持。保护记录中的 151 份文件均未变；本轮只读收尾未
重新计算全部保护文件哈希。没有采用素材、修改用户候选或声称听感通过。

See [test protocol](../audio-quality/MODEL_SFX_TEST.md) /
[中文](../audio-quality/MODEL_SFX_TEST.zh.md), and the completed
[alternatives research](../audio-quality/MODEL_SFX_ALTERNATIVES.md) /
[中文](../audio-quality/MODEL_SFX_ALTERNATIVES.zh.md). The historical research
recommended a bounded local Stable Audio 3 LiteRT CPU trial if testing were
later explicitly resumed; paid cloud routes
remain deferred. Optimized assets are separately ungated, unlike the original
Small-SFX checkpoint, and still carry model/encoder terms.
