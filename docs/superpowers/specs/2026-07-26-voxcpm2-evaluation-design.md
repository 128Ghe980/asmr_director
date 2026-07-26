# VoxCPM2 Evaluation and Integration Brief

Date: 2026-07-26

Status: Approved for experimental evaluation

Audience: implementation session

## 1. Decision

Evaluate VoxCPM2 as a third local voice candidate for ASMR Director. Its value is zero-shot cloning combined with natural-language control over softness, whispering, emotion, and pace. Do not replace GPT-SoVITS or CosyVoice before a loudness-matched headphone evaluation.

The local machine has an NVIDIA GeForce RTX 3060 Laptop GPU with 6 GB VRAM. The official VoxCPM2 BF16 inference profile is approximately 8 GB, so the first test profile is:

```text
VoxCPM2-BaseLM-Q8_0.gguf
+ VoxCPM2-Acoustic-F16.gguf
+ llama.cpp-omni
```

Run a standalone feasibility probe before modifying the product path. Register an experimental Provider only after the probe is stable and produces intelligible audio.

## 2. Model Summary

VoxCPM2 is a tokenizer-free diffusion-autoregressive multilingual TTS model released by OpenBMB / ModelBest.

- approximately 2B parameters;
- approximately 2.36 million hours of multilingual training data;
- 30 languages and 9 Chinese dialects;
- MiniCPM-4 backbone;
- AudioVAE V2 with 16 kHz encoding and 48 kHz decoding;
- 6.25 Hz LM audio token rate;
- original code and weights released under Apache-2.0.

Tokenizer-free refers to speech generation in a continuous latent space without an external discrete speech tokenizer. It does not mean that input text has no text tokenization.

## 3. Relevant Generation Modes

### Plain TTS

Text only. This does not clone a known person.

### Voice Design

No reference audio. A parenthesized natural-language description creates a new voice. This is voice creation, not identity cloning.

### Reference-only Controllable Cloning

Reference audio identifies the speaker, while a parenthesized instruction controls delivery. It requires no reference transcript and no fine-tuning. This is the primary ASMR Director test mode because it combines:

- zero-shot speaker cloning;
- cross-lingual synthesis;
- style, emotion, and pace control.

### Ultimate Cloning

Reference audio plus an accurate reference transcript conditions continuation-style cloning. Use one diagnostic sample to estimate the similarity ceiling, but do not make it the default. It depends on transcript accuracy and tends to continue the reference performance rather than execute each Timeline Clip's independent direction.

## 4. Quality Evidence

Author-reported Seed-TTS-eval results for VoxCPM2:

| Test | Intelligibility | Speaker similarity |
| --- | ---: | ---: |
| English | WER 1.84% | SIM 75.3% |
| Chinese | CER 0.97% | SIM 79.5% |
| Hard Chinese | CER 8.13% | SIM 75.3% |

These results place VoxCPM2 among strong open-source zero-shot cloning models, but not unambiguously first:

- LongCat-Audio-DiT reports higher similarity in the same table;
- Qwen3-TTS and Fish Audio S2 are stronger on some intelligibility metrics;
- the final decision must use matched local audio and user listening.

VoxCPM2 is highly competitive on English instruction following. Chinese control is effective but trails Qwen3-TTS in some InstructTTSEval dimensions. Official documentation recommends generating one to three candidates because Voice Design and Style Control can vary between runs.

## 5. ASMR Fit

Map Timeline voice direction to explicit natural-language instructions through a controlled mapping layer. Example meanings:

| Timeline value | VoxCPM2 control meaning |
| --- | --- |
| `comforting` | calm, reassuring and comforting |
| `sleepy_whisper` | sleepy, intimate and barely above a whisper |
| `soft` | very soft, breathy and gentle |
| `whisper` | close, natural near-whisper without dramatic emphasis |
| `slow` | slow pace with relaxed pauses |
| `fade_out` | gradually softer and sleepier toward the end |

English control instructions may be used with Chinese target text because the official instruction benchmark is stronger in English. Keep this mapping explicit; do not concatenate arbitrary UI values into prompts.

Do not ask TTS to implement left/right ear placement, distance, horizontal motion, vertical motion, gain, or fades. The existing spatial and mix layers remain responsible for those effects.

## 6. Memory and Quantization

### Official BF16 profile

The official model card reports approximately 8 GB inference VRAM. The raw 2B BF16 parameters account for roughly 4 GB, while AudioVAE, ResidualLM, LocDiT, activations, context, CUDA workspaces, and framework allocation account for the remaining runtime memory.

On this 6 GB Windows laptop GPU, successful model loading is insufficient evidence; the first generation may still OOM. Official CPU inference is available with `device="cpu"` and `optimize=False`, but its latency must be measured.

### Recommended Q8 GGUF profile

The official repository documents llama.cpp-omni for on-device VoxCPM2:

| File | Precision | Approximate size | Component |
| --- | --- | ---: | --- |
| `VoxCPM2-BaseLM-Q8_0.gguf` | Q8_0 | 1.6 GB | Base language model |
| `VoxCPM2-Acoustic-F16.gguf` | F16 | 1.7 GB | ResidualLM, FSQ, LocEnc, LocDiT, AudioVAE |

This is not full INT8. Only the BaseLM is quantized; the acoustic stack stays F16. The roughly 3.3 GB file total is not a promise of 3.3 GB peak VRAM. The official guide describes negligible quality loss for BaseLM Q8_0, but ASMR micro-prosody and breathiness still require local listening tests.

llama.cpp-omni supports CPU, CUDA, Vulkan, and Metal. MLX INT4/INT8 builds target Apple Silicon. Community ONNX and other quantizations should not replace the documented Q8 path in the first evaluation.

## 7. Evaluation Procedure

### Feasibility probe

Run outside the repository in the D-drive runtime. The implementation session may choose the exact layout, but it must:

1. pin the llama.cpp-omni commit;
2. record model sources, filenames, hashes, and licenses;
3. try Windows CUDA first, then Vulkan or CPU if needed;
4. use the same authorized reference audio as the existing voice candidates;
5. complete at least three consecutive generations;
6. record peak VRAM, system RAM, model load time, generation time, audio duration, and RTF;
7. preserve stdout, stderr, parameters, and raw WAV files.

Repeated OOM, crashes, or unintelligible output stop product integration. Do not silently substitute another model or report a false success.

### VoxCPM2 test mode

Use Reference-only Controllable Cloning as the primary mode:

- CFG 2.0;
- 10 inference timesteps;
- one fixed seed plus two additional seeds for stability;
- the same authorized reference audio;
- no unrelated automatic post-processing;
- preserve the original 48 kHz mono output.

Cover neutral close speech, soft/slow speech, natural whisper, sleepy/comforting speech, and cross-lingual cloning from the current reference language to Chinese. Generate one additional Ultimate Cloning sample only as a similarity diagnostic.

### A/B/C comparison

GPT-SoVITS, CosyVoice, and VoxCPM2 must use the same authorized reference audio, target text, segmentation, and approximately matched loudness. Preserve both raw and loudness-matched files, randomize playback order, and hide Provider names.

Use these fixed Chinese samples:

```text
今天辛苦了，现在什么都不用做，慢慢放松就好。
把眼睛慢慢闭上，听着雨声，我会一直陪着你。
不用担心，也不用急着睡着，只要安静地呼吸。
```

Each Provider produces neutral and softer candidates. VoxCPM2 also produces an explicit whisper candidate to prove that style control is audible.

## 8. Acceptance Criteria

### Runtime gate

- three consecutive generations without OOM or process failure;
- readable, non-empty WAV output;
- no complete-sentence truncation, severe repetition, or unintelligible output;
- measured peak memory and latency;
- explicit failures that do not overwrite accepted assets.

CPU-only output may be evaluated as `experimental_cpu`, but an unacceptably slow profile cannot become the interactive default.

### Audio checks

Record sample rate, channels, duration, peak, RMS, clipping, abnormal leading/trailing silence, click/chirp, reference-tail leakage, truncation, and repetition.

### Headphone listening

Score 1–5 with written observations:

- speaker similarity;
- Chinese intelligibility and pronunciation;
- naturalness;
- soft/whisper instruction adherence;
- emotional fit;
- breathiness and close-delivery quality;
- metallic sound, noise, clicks, pops, or drift;
- long-listening fatigue.

Pass only when:

- at least two of three matched samples make the VoxCPM2 softer version audibly softer than its neutral version;
- VoxCPM2 is preferred or tied for preferred ASMR softness against GPT-SoVITS / CosyVoice on at least two samples;
- softness does not come from a clear loss of intelligibility or speaker identity;
- clicks, truncation, and drift are not frequent;
- the user completes headphone listening and explicitly approves the Provider.

## 9. Product Integration Principles

This report intentionally does not prescribe a detailed project file structure. Inspect the latest branch and extend the current Provider and candidate boundaries.

Required principles:

- register VoxCPM2 as experimental before making it a default;
- route generated audio through existing candidate, preview, accept, undo, and remix flows;
- reuse only authorized Voice Packs;
- record Provider, backend, quantization, weight version, seed, CFG, timesteps, control instruction, and reference identifier;
- allow reference paths only under approved runtime / voice-pack roots;
- keep runtimes, weights, references, and generated WAVs out of Git;
- keep Provider-private parameters out of the Timeline DSL;
- leave ear placement and motion to spatial post-processing;
- if CosyVoice or a Provider registry already exists in the latest implementation session, extend it instead of creating a parallel path.

## 10. Known Risks

- Style and Voice Design vary between generations; official guidance suggests producing one to three candidates.
- An open upstream issue reports click/chirp and reference-tail leakage at the start of one-shot cloned clips.
- Long outputs can drift in speaker identity. Per-Clip generation reduces long-form drift but increases seam and cross-Clip consistency checks.
- Cross-lingual cloning may preserve the reference speaker's accent.
- 48 kHz output is model super-resolution from a compact 16 kHz representation, not recovered source-recording bandwidth.
- Q8 BaseLM quality may be close to BF16 in general while still affecting ASMR breathiness, sibilance, or micro-prosody.
- Apache-2.0 model terms do not replace the need for explicit authorization to use a reference voice.

## 11. Implementation Session Directive

1. Inspect the current GPT-SoVITS, CosyVoice, Provider registry, and candidate flow.
2. Complete the standalone VoxCPM2 Q8 GGUF feasibility probe on the D-drive runtime.
3. Preserve runtime evidence and raw WAVs.
4. Register the smallest experimental Provider only after the runtime gate passes.
5. Run the matched A/B/C evaluation.
6. Deliver audio files, parameters, measurements, and written findings to the user.
7. Do not switch the default Provider or claim the softer action is complete without explicit user headphone approval.

## 12. Sources

- [VoxCPM repository](https://github.com/OpenBMB/VoxCPM)
- [VoxCPM2 model card](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM2 documentation](https://voxcpm.readthedocs.io/en/latest/models/voxcpm2.html)
- [VoxCPM2 technical report](https://arxiv.org/abs/2606.06928)
- [Official audio samples](https://openbmb.github.io/voxcpm2-demopage/)
- [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni)
- [VoxCPM2 GGUF weights](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF)
- [One-shot click/chirp issue](https://github.com/OpenBMB/VoxCPM/issues/272)
- [Long-form voice drift issue](https://github.com/OpenBMB/VoxCPM/issues/302)
