# Third-Party Runtimes

Last updated: 2026-10-20

This file records external runtime projects and model assets used during local experiments or planned provider integration. It is not legal advice; re-check upstream licenses and model terms before redistribution, hosted service launch, commercial release, or publishing generated voice packs.

## Chinese CTC forced alignment — isolated experiment

2026-10-16: the user authorized an actual Chinese forced-alignment comparison. The standalone tool uses the same Chinese checkpoint selected by WhisperX, `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`, with the existing TorchAudio 2.8 standard CTC API; it does not install or run the complete WhisperX pipeline. See [中文协议](specs/2026-10-16-chinese-forced-alignment-experiment.zh.md) / [English protocol](specs/2026-10-16-chinese-forced-alignment-experiment.en.md) and the [real comparison record](records/2026-10-16-audio-quality-v1-chinese-forced-alignment-experiment.md). Nine usable independent Whisper target windows showed no literal-recognition improvement; these are experiment results, not product acceptance.

The [author's model card](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn) lists Apache-2.0. HF revision `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd`; the public ModelScope same-author mirror revision `dc70e032dd023312c750ac50ba03ade725fd8016` provides identical weight bytes. The single PyTorch checkpoint is 1,276,296,151 bytes, SHA256 `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4`, verified in full after resuming from the mirror. Config/tokenizer files and the model card were verified against HF Git-blob metadata. No Flax duplicate, new Python package, model weight or private WAV is vendored into Git.

External root: `I:/AI/asmr_director/runtime/forced-alignment/2026-10-16`; reuse `env-comfyui-clone/python.exe` with Torch/TorchAudio 2.8.0+cu129 and Transformers 4.50.0. Inference is offline CUDA fp16 with processor normalization and attention mask; CTC path calculation uses CPU float32. Unsupported characters are rejected rather than replaced with unknown/wildcard/interpolated times. Given-text alignment scores are not recognition accuracy or proof of complete speech. Original 48kHz PCM, existing Whisper checks and explicit user confirmation remain separate; no product provider or candidate state is changed. TorchAudio's CTC interface is deprecated in 2.8, so this recipe records that existing version rather than upgrading the environment.


## AudioLDM2 — isolated personal-care SFX experiment

2026-10-04: user requested independent model-generated friction/care sounds, rather
than repeated reuse of one recording. This is an Audio Quality V1 experiment with
no product provider or automatic adoption. See [English protocol](audio-quality/MODEL_SFX_TEST.md)
and [中文](audio-quality/MODEL_SFX_TEST.zh.md).

- Official weights/model card: <https://huggingface.co/cvssp/audioldm2>, license
  **CC-BY-NC-SA-4.0**; noncommercial testing only in this project.
- Local target revision: `c8e7e189d324425c05c4c2f81214041ef4107983`.
  Download only configs/tokenizers and safetensors, 26 files / 4,480,952,551 bytes.
  Download completed: all 26 files passed official SHA256/Git-blob checks. Some
  LFS bytes came from the public `AI-ModelScope/audioldm2` mirror at revision
  `87e064c5ba53208c9abccd31359dcb2c4c86fce1`, after official size/SHA matching;
  the receipt preserves each source. Download completion did not establish inference support.
- Runtime/cache root: `I:/AI/asmr_director/runtime/sfx-model-test/runtime`; experiment
  evidence root: `I:/AI/asmr_director/runtime/sfx-model-test/2026-10-04`.
- Existing read-only CUDA environment: GPT-SoVITS `env-comfyui-clone/python.exe`,
  Python 3.12.8, torch 2.8.0+cu129, diffusers 0.35.2, transformers 4.50.0,
  accelerate 1.10.1, NumPy 1.26.4, SciPy 1.16.1. No package changes for this test.
- Separate actual remote smoke route: public
  <https://huggingface.co/spaces/fffiloni/audioldm2-text2audio-text2music-API>,
  source revision `f6cbb14d5e22ada888aa19b6bee08ceadc58811e`. It loads AudioLDM2
  without pinning the weight revision; remote 200-step DDIM results must not be
  combined with the pinned local 50-step DPM baseline. Job/SSE receipts preserve
  real generated outputs. Public quota failures stop the queue.
- Output: 16 kHz mono. No claim of binaural recording, spatial treatment or
  listening acceptance. Preserve raw WAVs and explicitly label gain-only copies.
- Actual result: local 0 outputs after native load/CUDA memory failures;
  remote 3 brush candidates before quota rejection. On 2026-10-05 the user
  rejected all three as unusable and paused further model testing. Stable Audio
  Open was prepared but never executed; other alternatives remain untested.
  No packages changed or production audio adopted. See the
  [rejection/publication record](records/2026-10-05-audio-quality-v1-sfx-rejection-release.md).
- Stable Audio 3 Small-SFX remains a gated future comparison. Public model-card
  access does not authorize downloading its gated weights; account-holder
  agreement acceptance must happen before downloading. No gated weights fetched.
  The separate optimized asset repository reports `gated=false` as checked on
  2026-10-04; it still carries Stable Audio Community and T5Gemma terms. The
  Windows LiteRT CPU alternative has not been installed or downloaded. See
  [alternatives research](audio-quality/MODEL_SFX_ALTERNATIVES.md).

本轮独立测试模型生成护理声音，权重、音频、证据不进 Git，录音库/用户候选保留。
远端演示、本机实际推理与下载进度分别记录；不把不同哈希或完成下载当成音质通过。

## GPT-SoVITS

Current role in ASMR Director:

- Used as the first local TTS runtime candidate for roadmap step 7, Real Generation MVP.
- Used only from a separate local runtime directory: `D:\CodexWorkplace\asmr_director_runtime`.
- Not vendored into this repository.
- Not committed together with model weights, generated audio, user reference audio, or local Python environments.

Local runtime details from the 2026-07-06 experiment:

- Upstream repository: `https://github.com/RVC-Boss/GPT-SoVITS.git`
- Local repository: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`
- Local checked commit: `bf81cdb`
- Root code license observed locally: MIT License, copyright RVC-Boss, from `LICENSE`.
- Local API endpoint used: `http://127.0.0.1:9880/tts`

Important licensing and ownership boundaries:

- The MIT license above applies to the GPT-SoVITS code as observed in the local checkout.
- Pretrained models, ASR models, vocoders, and other downloaded weights may have their own source terms. Do not assume the root code license covers every model file.
- User-provided reference audio and voice packs require separate authorization or consent metadata.
- Generated voice clips may inherit practical or contractual restrictions from the reference audio, voice pack, model weights, and intended use case.
- The product should describe imported voices as authorized or original voice cards, not as public-person or commercial-character cloning.

Repository policy:

- Keep runtime engines, model weights, caches, temporary files, generated WAVs, and user reference audio outside this repository.
- Commit only source code, provider adapters, docs, small config schemas, and safe sample metadata.
- If a future change vendors third-party code or redistributes model weights, add the exact upstream version, license, notices, and redistribution terms here before merging.

## VoxCPM2 / llama.cpp-omni native CLI

2026-10-19 stability build: [reproducible patch and build notes](../tools/voxcpm2-runtime/README.en.md), [中文说明](../tools/voxcpm2-runtime/README.zh.md). The local F32 ResidualLM KV capacity now follows the actual BaseLM context: low-VRAM 4096 uses 64MiB instead of the fixed 512MiB. The isolated executable is stored at `I:/AI/asmr_director/runtime/engines/voxcpm2/reliability-20261019/voxcpm2-cli.exe`, SHA256 `feba01044885d494bb428ec61d9db9626f728a482dc8fc51a84b6dbf5fec4c80`. It reuses the previously tested Aug30 cached components/COPY fallback; it is not solely a one-line modification of the Aug25 default binary. Weights and selected references remain external and unchanged. Two same-component, same-seed control WAVs match exactly; this does not establish that every historical initialization failure has the same cause. Production activation and batch evidence are recorded separately in the dated development record.

Optional Windows resource diagnostics use the existing Python's base interpreter with `-I -S -B` and standard-library Windows APIs; no Torch/model import or dependency installation. `GetPerformanceInfo` supplies global commit/physical figures, `GetProcessMemoryInfo` supplies native process figures, and `nvidia-smi` supplies whole-device observations. Missing data remain unknown. The monitor only controls its own GPU query process, never the native model; setup/shutdown have a total 2.5-second request wait bound. CUDA OOM, host allocation failure and cuBLAS initialization remain separate error classes.

Activated locally on port3001 at2026-10-19 16:57 HKT, build `qikKsnc9iyniAim3_PRCC`: only the profile's `cliPath` was changed, and the paragraph launcher override points to the same fixed executable. Existing model/reference inputs and134 candidate entries remain unchanged. Successful activation receipts and earlier rejected-command history are in [the development record](records/2026-10-19-audio-generation-reliability.md); earlier pending snapshots are superseded.

Current role: optional local voice generation through the existing Generation Bridge, with previewable candidates and explicit adoption. The selected long-text grouping/padding/extraction/pause workflow passed real-workbench technical verification on 2026-09-09. Product workflow verification is recorded in `docs/AI_HANDOFF.md`; user listening evaluation remains separate.

Locally inspected installation (2026-09-08):

- External evaluation root: `I:\AI\voxcpm2-evaluation`.
- Native executable: `src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`.
- Local source: `src\llama.cpp-omni-pinned`, checked base commit `74699a53df6ca0f4947ff37066f851532c20b12d`, with local runtime changes including Combined reference/prompt mode and low-VRAM handling. This commit alone does not identify all local modifications; each generated candidate records the actual executable SHA256.
- Root `LICENSE` inspected locally: MIT, copyright 2023–2026 The ggml authors. This describes the runtime code license observed in that checkout, not a new audit of model distribution terms.
- Model files: `models\VoxCPM2-BaseLM-Q8_0.gguf` and `models\VoxCPM2-Acoustic-F16.gguf`. Prior source/model terms and evaluation links are recorded in `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.md`.
- Product profile: `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json`, overridable with `ASMR_VOXCPM2_PROFILE_PATH`.
- Current references: `soft_zh` and `normal_zh`, with separate mono 16 kHz PCM16 recordings, accurate transcripts and authorization metadata in the external profile.

No full engine source, binaries, weights, references or generated audio are vendored by this integration; the repository keeps only the small local patch and build tooling described above. The provider invokes the native executable directly with argument arrays, `shell: false`, hidden windows, bounded logs and timeout; runtime paths and raw logs stay on the server. GPU layers 0 plus low-VRAM still uses GPU memory. A filesystem lock serializes all product requests sharing the runtime root, including all TTS and CPU-ASR stages of a long-text candidate. Cancellation retains that lock until child exit is confirmed. The supported output is mono / 48 kHz / PCM16 WAV; the model's 7680 samples per decode step supplies the length-limit check. Direct-clip format/cap checks do not establish ASR completeness or perceptual quality. Long-text mode separately verifies each retained group with the local ASR described below.

Reference permission remains separate from runtime/model terms. Do not copy the example consent timestamp as evidence of a new voice's authorization. Runtime setup and recovery instructions are in `apps/web/README.md`.

## Local long-text ASR and text analysis

The product helper `apps/web/scripts/analyze-voice-group.py` uses the existing faster-whisper large-v3 installation, loaded offline on CPU with int8 computation. The 2026-09-09 import probe confirmed `faster_whisper`, `numpy`, `scipy`, `soundfile` and `opencc.OpenCC` in `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe`. The spatial `.venv` exists but lacks faster-whisper/OpenCC. Model files remain at `engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3` under the external runtime. Configure alternate locations with `ASMR_VOICE_ANALYSIS_PYTHON` and `ASMR_VOICE_ANALYSIS_MODEL`; the server returns availability without exposing paths.

ASR runs through hidden, bounded subprocesses with JSON-file communication, abort handling and confirmed-exit cleanup. It checks the target opening and immediate continuation, requires a safe quiet cut with word guards, then transcribes the extracted result again. If coarse timestamps disagree with measured silence, refinement examines at most three nearby candidates and requires at least 80 ms of measured quiet on each side plus independent recognition of the complete left target and right continuation opening. Strict quiet detection remains first; bounded noise-floor adaptation is capped at −60 dBFS, 30 dB below the file's peak RMS frame, and 6 dB above the local 20th-percentile floor. The surviving verified tail interval is counted in retained quiet rather than inserted again by assembly; optional `cutValidation` stays in server analysis evidence. Final groups are checked as complete independent endings. Internal pause inputs are measured adjacent ASR word gaps, including valid 0 ms values; they are not text-length or speaking-rate estimates. This application code does not bundle Python packages or model weights and makes no new redistribution-license claim for those dependencies.

The semantic plan uses local Ollama by default, with deterministic punctuation/rule fallback clearly disclosed after model failure. An explicitly selected external JSON-mode text API reuses the existing Planner configuration and may incur charges; only the spoken text is sent for grouping and pause classification, while ASR audio stays local. Model names and provider results are recorded as provenance rather than assuming every plan came from an LLM. Fixed neutral continuation padding remains generation context only and never enters the retained script/audio.

The current request limit is 500 characters and 12 semantic groups. The accepted experiment's 16-clause / 177–196-character input is a reproduction baseline, not a rule for cutting new source text. A failed group gets at most three total attempts; a successful candidate can later regenerate one selected group while reusing the others. Existing candidate warnings are conservatively inherited during partial regeneration. This remains part of Audio Quality V1, whose spatial and real-SFX work is unfinished.

Final 2026-09-09 verification: **53 Vitest files / 465 tests, 23 Python tests, full ESLint and Webpack production build with TypeScript passed**. Real external DeepSeek analysis and local TTS/ASR produced five verified groups (20.352 s); a first-group reroll succeeded on one take while reusing the other four assets (20.57 s total). Playback, adopt/refresh/undo, cancellation and 23.36 s / 48 kHz stereo remix/download passed. Evidence is under `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`. Local Ollama success was not re-established; new sample listening quality remains for the user.

The real structural-analysis probe found that DeepSeek's default thinking exhausted the short JSON response budget. Only structural requests to the official `api.deepseek.com` host now set `thinking.type` to `disabled`; the configured `deepseek-v4-pro` returned a valid five-group plan in 2.204 seconds. Creative Planner and other compatible API behavior are unchanged. Request behavior follows the [official thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/); safe before/after results are stored as `api-plan-before.json` and `api-plan-after.json` in the evidence directory.
