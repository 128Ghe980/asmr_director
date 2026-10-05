# 2026-10-04 — Stable Audio Open test preparation / 恢复模型音效测试准备

## Superseding status — 2026-10-05 / 最新状态

用户反馈 **“相当烂，没法用，先这样吧，记录一下推一版”**。三条远端 AudioLDM2
8 秒刷耳输出全部被拒绝、不可用；实际计数仍为**本机 0 / 远端 3**，没有采用。
后续模型测试暂停；此前 5070 Ti 连接/主机选择问题不再作为下一步待答事项。
Stable Audio Open 只完成适配器、监督器和测试包准备，**从未执行真实模型推理**。
独立的 **13 条 CC0 录音试听库仍待听感确认**。已授权记录与推送；实际结果见
[本次发布记录](2026-10-05-audio-quality-v1-sfx-rejection-release.md)，本条不提前宣称完成。

The three remote brush outputs were rejected as unusable. Future model tests
are paused, superseding the earlier resumed-test plan and pending host question.
Stable Audio Open was prepared but never executed. The preparation and tool
checks below are historical evidence, not sound-quality acceptance.

## Historical preparation — 2026-10-04 / 历史准备

用户明确要求“开始测试模型生成音频吧”，覆盖此前仅调研的范围限制。
首轮目标为 Stable Audio Open 1.0 的单条刷耳，而非恢复未完成的 AudioLDM2
批量。生成成功、声音质量和多样性都必须以实际输出为证。

The user explicitly resumed model audio testing. The first target is one Stable
Audio Open 1.0 brush take; the earlier research-only instruction is historical.
Do not automatically resume the failed AudioLDM2 batch.

## Host requirement / 目标主机

Fresh `nvidia-smi` still identifies **RTX 3060 Laptop / 6144 MiB**, roughly
5161 MiB free at the check. This session has no saved SSH configuration for the
other **5070 Ti 16GB** desktop. The standalone experiment model cache contains
only the already verified AudioLDM2 snapshot. Stable Audio Open weights and a
usable 5070 Ti runtime have not been verified.

A clarification was sent asking whether to connect to that desktop (with its
connection details) or use the current computer's CPU small model. It did not
lead to model execution and is no longer a pending next action after the
2026-10-05 pause. Open weights require account-holder access to the
official gated model; do not bypass it or print tokens. The question is about
missing target information, not a repeated permission request.

当时仍连着 3060 笔记本，曾询问 5070 Ti 连接方式或当前电脑 CPU 小模型选择。
该问题已被 2026-10-05 暂停指令收住，不再等待回答后自动执行。独立外部超时监督
与离线 Open 适配器准备完成，不把脚本准备或生命周期验证当作真实模型音频成功。

## Historical first run contract / 历史首条执行约定

- One brush take, seed 104729, 24 seconds, 50 inference steps, batch 1.
- Offline fixed local weights/revision; 16GB host uses CUDA FP16. Save original
  stereo float32 WAV, raw SHA and host/runtime/time/GPU measurements.
- External 300-second deadline and cancel control; terminate only the created
  child tree, confirm exit, and stop on failure. No automatic retry or batch.
- Preserve earlier three remote samples and all product assets. No paid calls,
  production adoption, app changes or commit/push in this SFX slice.

Further seed/category expansion depends on an actual first success and listening
evaluation. The existing repetition analysis remains screening, not certification.
Tool checks and actual execution results will be recorded separately below.

## Historical preparation checks / 历史工具准备与检查

- `tools/sfx-model-test/run_bounded.py`: 300s default deadline, 0.2s polling,
  cancel file / Ctrl-C, direct log writes, hidden isolated Windows child, exact
  owned PID-tree cleanup and atomic exit receipts. Six synthetic lifecycle cases
  pass, including active root/descendant termination. Evidence:
  `I:/AI/asmr-director-sfx-model-test/2026-10-04/bounded-supervisor-checks/20261004-204610/checks.json`.
  A 1s timeout exited in 1.25s; cancel-file case exited in 0.438s. Unix cleanup
  is implemented but not exercised here.
- `generate_stable_open.py`: offline pinned FP16 CUDA, strict request/manifest
  preservation, mandatory ≤300s supervisor contract, serial independent seeds,
  stop at first error; stereo float32 WAV and provenance fields. Twenty-four
  stdlib/AST/preflight/negative/preservation checks pass on synthetic fixtures,
  with no Torch/Diffusers inference or downloaded model. Captured check output:
  `24 standard-library AST/preflight/preservation checks passed; no inference or audio generated`
  (tool chunk `65d4f2`, exit0); no standalone report was saved for these checks.
- Portable English/Chinese commands are in `README_stable_open.md` / `.zh.md`.
  A seven-file ZIP is prepared externally; its CRC and archived-source hashes
  are checked. It contains tools/instructions only, no weights or audio.
  Final archive: `I:/AI/asmr-director-sfx-model-test/2026-10-04/stable-open-preparation/stable-open-test-kit-v2.zip`
  (34,237 bytes); receipt `package-verification-v2.json` in the same directory.
  Four packaged Python ASTs and seven then-current Markdown files/local links
  passed. The archive preserves those preparation instructions; it does not
  override the latest paused status. The older identically hashed ZIP remains preserved.

**No new model audio has been generated.** Model tests are paused; the earlier
connection/host clarification is no longer the next action. These checks do not establish the 5070 Ti environment, memory usage,
audio quality or ability to cancel the Codex conversation itself.

控制流程和适配器准备已验证，尚无新模型音频，当前测试暂停。历史首轮参数与取消
方法已写入测试包；不把工具验收冒充音质验收，也不继续追问主机信息以恢复执行。
