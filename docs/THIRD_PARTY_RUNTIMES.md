# Third-Party Runtimes

Last updated: 2026-09-09

This file records external runtime projects and model assets used during local experiments or planned provider integration. It is not legal advice; re-check upstream licenses and model terms before redistribution, hosted service launch, commercial release, or publishing generated voice packs.

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

Current role: optional local voice generation through the existing Generation Bridge, with previewable candidates and explicit adoption. The selected long-text grouping/padding/extraction/pause workflow passed real-workbench technical verification on 2026-09-09. Product workflow verification is recorded in `docs/AI_HANDOFF.md`; user listening evaluation remains separate.

Locally inspected installation (2026-09-08):

- External evaluation root: `I:\AI\voxcpm2-evaluation`.
- Native executable: `src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`.
- Local source: `src\llama.cpp-omni-pinned`, checked base commit `74699a53df6ca0f4947ff37066f851532c20b12d`, with local runtime changes including Combined reference/prompt mode and low-VRAM handling. This commit alone does not identify all local modifications; each generated candidate records the actual executable SHA256.
- Root `LICENSE` inspected locally: MIT, copyright 2023–2026 The ggml authors. This describes the runtime code license observed in that checkout, not a new audit of model distribution terms.
- Model files: `models\VoxCPM2-BaseLM-Q8_0.gguf` and `models\VoxCPM2-Acoustic-F16.gguf`. Prior source/model terms and evaluation links are recorded in `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.md`.
- Product profile: `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json`, overridable with `ASMR_VOXCPM2_PROFILE_PATH`.
- Current references: `soft_zh` and `normal_zh`, with separate mono 16 kHz PCM16 recordings, accurate transcripts and authorization metadata in the external profile.

No engine source, binaries, weights, references or generated audio are vendored by this integration. The provider invokes the native executable directly with argument arrays, `shell: false`, hidden windows, bounded logs and timeout; runtime paths and raw logs stay on the server. GPU layers 0 plus low-VRAM still uses GPU memory. A filesystem lock serializes all product requests sharing the runtime root, including all TTS and CPU-ASR stages of a long-text candidate. Cancellation retains that lock until child exit is confirmed. The supported output is mono / 48 kHz / PCM16 WAV; the model's 7680 samples per decode step supplies the length-limit check. Direct-clip format/cap checks do not establish ASR completeness or perceptual quality. Long-text mode separately verifies each retained group with the local ASR described below.

Reference permission remains separate from runtime/model terms. Do not copy the example consent timestamp as evidence of a new voice's authorization. Runtime setup and recovery instructions are in `apps/web/README.md`.

## Local long-text ASR and text analysis

The product helper `apps/web/scripts/analyze-voice-group.py` uses the existing faster-whisper large-v3 installation, loaded offline on CPU with int8 computation. The 2026-09-09 import probe confirmed `faster_whisper`, `numpy`, `scipy`, `soundfile` and `opencc.OpenCC` in `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe`. The spatial `.venv` exists but lacks faster-whisper/OpenCC. Model files remain at `engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3` under the external runtime. Configure alternate locations with `ASMR_VOICE_ANALYSIS_PYTHON` and `ASMR_VOICE_ANALYSIS_MODEL`; the server returns availability without exposing paths.

ASR runs through hidden, bounded subprocesses with JSON-file communication, abort handling and confirmed-exit cleanup. It checks the target opening and immediate continuation, requires a safe quiet cut with word guards, then transcribes the extracted result again. If coarse timestamps disagree with measured silence, refinement examines at most three nearby candidates and requires at least 80 ms of measured quiet on each side plus independent recognition of the complete left target and right continuation opening. Strict quiet detection remains first; bounded noise-floor adaptation is capped at −60 dBFS, 30 dB below the file's peak RMS frame, and 6 dB above the local 20th-percentile floor. The surviving verified tail interval is counted in retained quiet rather than inserted again by assembly; optional `cutValidation` stays in server analysis evidence. Final groups are checked as complete independent endings. Internal pause inputs are measured adjacent ASR word gaps, including valid 0 ms values; they are not text-length or speaking-rate estimates. This application code does not bundle Python packages or model weights and makes no new redistribution-license claim for those dependencies.

The semantic plan uses local Ollama by default, with deterministic punctuation/rule fallback clearly disclosed after model failure. An explicitly selected external JSON-mode text API reuses the existing Planner configuration and may incur charges; only the spoken text is sent for grouping and pause classification, while ASR audio stays local. Model names and provider results are recorded as provenance rather than assuming every plan came from an LLM. Fixed neutral continuation padding remains generation context only and never enters the retained script/audio.

The current request limit is 500 characters and 12 semantic groups. The accepted experiment's 16-clause / 177–196-character input is a reproduction baseline, not a rule for cutting new source text. A failed group gets at most three total attempts; a successful candidate can later regenerate one selected group while reusing the others. Existing candidate warnings are conservatively inherited during partial regeneration. This remains part of Audio Quality V1, whose spatial and real-SFX work is unfinished.

Final 2026-09-09 verification: **53 Vitest files / 465 tests, 23 Python tests, full ESLint and Webpack production build with TypeScript passed**. Real external DeepSeek analysis and local TTS/ASR produced five verified groups (20.352 s); a first-group reroll succeeded on one take while reusing the other four assets (20.57 s total). Playback, adopt/refresh/undo, cancellation and 23.36 s / 48 kHz stereo remix/download passed. Evidence is under `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`. Local Ollama success was not re-established; new sample listening quality remains for the user.

The real structural-analysis probe found that DeepSeek's default thinking exhausted the short JSON response budget. Only structural requests to the official `api.deepseek.com` host now set `thinking.type` to `disabled`; the configured `deepseek-v4-pro` returned a valid five-group plan in 2.204 seconds. Creative Planner and other compatible API behavior are unchanged. Request behavior follows the [official thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/); safe before/after results are stored as `api-plan-before.json` and `api-plan-after.json` in the evidence directory.
