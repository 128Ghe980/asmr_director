# VoxCPM2 Evaluation and Integration Brief

Date: 2026-07-26

Status: Main listening evaluation complete; a current best soft-Chinese long-form recipe is selected but not integrated into the product

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
- implement the approved candidate, preview, accept, and undo boundaries, while reusing the existing durable-asset, preview, revision, and remix infrastructure;
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

## 13. Listening Decision Update (2026-09-04)

### 13.1 Current Best Candidate

For the tested soft Chinese reference and 16-clause long text, the current best output is:

`I:\AI\voxcpm2-evaluation\listening\longtext-deepseek-class-local-pause-20260904\03_deepseek_class_local_rule.wav`

The selected recipe is:

1. Use the local VoxCPM2 GGUF runtime with `gpu_layers=0` / low-VRAM and the soft Chinese reference. Supply its accurate transcript with punctuation replaced by spaces and preserve one trailing space. The accepted source uses `cfg=2`, `timesteps=10`, and `temperature=1`; groups 1–5 came from `seed=7901`, `max_steps=420` long-opening runs, while the true ending came from `seed=8201`, `max_steps=220`. These values record this sample's provenance rather than product defaults.
2. Join clauses with Chinese ellipses for the main long-opening candidates. Generate the true ending separately. Its exact target is `……我会一直陪在这里……不催促你，也不会突然离开，直到困意自然地靠近。`, which contains an opening ellipsis, a linking ellipsis after “这里”, natural commas, and a terminal full stop. Do not keep a full one-shot long generation because later audio repeatedly became sharper, noisy, or less similar to the reference.
3. Split the text into semantic groups. On 2026-09-08, the user decided to retain fixed neutral continuation clauses as a long-text product default, following the successful sample and recalling that earlier full-length generations became faster and sharper toward the end. For every non-final group, use the target group + all remaining source text + fixed neutral continuation clauses as needed; generate the complete continuation and retain only the opening target group. Generate the final group independently as a true ending without padding. The old sample's 16-clause construction and roughly 177–196 Chinese-character inputs are sample details, not hard limits for all scripts; never truncate source text to fit 16 clauses. Padding's independent effect has not been isolated by ablation, so no separate causal claim is established; this is not a pending task, a removal optimization, or an integration prerequisite. Keep multiple candidates and reject incomplete, inconsistent, or noisy results.
4. Retiming in this accepted class-local output applies only to the five joins between semantic groups. The ten clause pauses inside the groups remain exactly as VoxCPM2 generated them and serve only as measurement/fallback evidence; do not expand this recipe to all 15 clause boundaries. Let a text model classify each join as short, medium, or long, then estimate its duration from the real internal pauses of the adjacent groups. Fall back to class defaults only when no usable local measurement exists: short 180 ms, medium 350 ms, long 600 ms.
5. The five selected joins in this sample are `350 / 350 / 350 / 440 / 290 ms`. The user found both the fixed class-default version and the local version natural, and selected the local version overall because it adapts better to adjacent material.

### 13.2 Scope of the Decision

- This is the best result for the tested reference, text, and selected takes. It is not a universal optimum for every voice, language, or script.
- Most softness still comes from the soft reference and candidate selection; this does not prove that a generic natural-language "softer" instruction is reliable.
- The output still uses candidate selection, extraction, and assembly and is not yet a reproducible one-click product feature.
- Groups 1–5 in the accepted sample originate from seed7901 long-opening runs. To repair the fifth group, it uses a middle excerpt from the clause-09-start continuous generation; group 6 uses the accepted seed8201 true ending. These seeds record sample provenance rather than recommended fixed defaults. The group-5 replacement is a sample-specific exception; the default future rule remains to place the current semantic group at the start and extract that opening group.
- The six-group layout was first produced by local Ollama `qwen3:1.7b`, then independently reproduced by DeepSeek V4. The final short/medium/long pause classifications came from DeepSeek. These models only analyze text; they do not synthesize audio, and the product must retain a free local analyzer and fixed pause defaults as fallbacks.
- Key listening conclusions and the technical evidence index live at `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`; use individual package READMEs and JSON evidence for the omitted turn-by-turn details from 2026-08-12 through 2026-09-03.
