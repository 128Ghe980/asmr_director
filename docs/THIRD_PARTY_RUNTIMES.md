# Third-Party Runtimes

Last updated: 2026-09-08

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

Current role: optional local voice generation through the existing Generation Bridge, with previewable candidates and explicit adoption. Product workflow verification is recorded in `docs/AI_HANDOFF.md`; the independent long-text experiments are not proof of product acceptance.

Locally inspected installation (2026-09-08):

- External evaluation root: `I:\AI\voxcpm2-evaluation`.
- Native executable: `src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`.
- Local source: `src\llama.cpp-omni-pinned`, checked base commit `74699a53df6ca0f4947ff37066f851532c20b12d`, with local runtime changes including Combined reference/prompt mode and low-VRAM handling. This commit alone does not identify all local modifications; each generated candidate records the actual executable SHA256.
- Root `LICENSE` inspected locally: MIT, copyright 2023–2026 The ggml authors. This describes the runtime code license observed in that checkout, not a new audit of model distribution terms.
- Model files: `models\VoxCPM2-BaseLM-Q8_0.gguf` and `models\VoxCPM2-Acoustic-F16.gguf`. Prior source/model terms and evaluation links are recorded in `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.md`.
- Product profile: `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json`, overridable with `ASMR_VOXCPM2_PROFILE_PATH`.
- Current references: `soft_zh` and `normal_zh`, with separate mono 16 kHz PCM16 recordings, accurate transcripts and authorization metadata in the external profile.

No engine source, binaries, weights, references or generated audio are vendored by this integration. The provider invokes the native executable directly with argument arrays, `shell: false`, hidden windows, bounded logs and timeout; runtime paths and raw logs stay on the server. GPU layers 0 plus low-VRAM still uses GPU memory. A filesystem lock serializes all product requests sharing the runtime root. The supported output is mono / 48 kHz / PCM16 WAV; the model's 7680 samples per decode step supplies the length-limit check. No ASR completeness or perceptual-quality claim is made from that check.

Reference permission remains separate from runtime/model terms. Do not copy the example consent timestamp as evidence of a new voice's authorization. Runtime setup and recovery instructions are in `apps/web/README.md`.
