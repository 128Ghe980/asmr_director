# Chinese forced alignment: isolated experiment protocol

Date: 2026-10-16. Status: **initial isolated experiment complete; no product integration**. Audio Quality V1 remains in progress, without a new roadmap stage. [中文版](2026-10-16-chinese-forced-alignment-experiment.zh.md). The [real experiment record](../records/2026-10-16-audio-quality-v1-chinese-forced-alignment-experiment.md) reports three recordings, wrong-text controls and nine usable independent Whisper target windows with no literal-recognition improvement; 28 synthetic tests passed. This is not blinded listening or complete product-splitting acceptance.

## Question and authorization boundary

Test whether character-level acoustic alignment can help locate complete Chinese sentence endings in existing soft-voice recordings, including a neutral final particle, a long internal pause and a possible following interjection. Measure actual timing, resource use and failure behavior before proposing product changes.

Use three existing original WAV files and controlled alternate transcripts. Do not generate new TTS, replace production recognition/splitting, change product gates, create production candidates, confirm text or adopt audio. Experimental reports and native-PCM excerpts stay outside the repository under `I:/AI/asmr-director-forced-alignment/2026-10-16/`. Private source audio must not be copied into Git.

## Fixed model and method identity

WhisperX currently selects `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn` for `zh`. This model was fine-tuned from XLSR-53 on Chinese Common Voice 6.1, CSS10 and ST-CMDS. Its historical ASR metrics do not measure forced-alignment quality or this project's soft-voice accuracy. [WhisperX alignment source](https://github.com/m-bain/whisperX/blob/771b4a14a9486f8fd5aef18ef49e35d639523dd3/whisperx/alignment.py), [author's model card](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn).

| Item | Frozen identity |
|---|---|
| HF repository revision | `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd` |
| Public ModelScope mirror | `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn` |
| ModelScope revision | `dc70e032dd023312c750ac50ba03ade725fd8016` |
| `pytorch_model.bin` length | `1,276,296,151 bytes` |
| Weight SHA256, identical in both hosts' metadata | `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4` |
| Required runtime files | `pytorch_model.bin`, `config.json`, `preprocessor_config.json`, `special_tokens_map.json`, `vocab.json` |

Download only this one PyTorch weight format. Validate the complete downloaded file against length and SHA256 before loading; matching server metadata or a partial Range probe is insufficient. Keep the original HF identity in the receipt even if bytes come from ModelScope. [HF revision](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/commit/99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd), [HF weight metadata](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/pytorch_model.bin), [ModelScope file metadata](https://modelscope.cn/api/v1/models/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/repo/files?Revision=dc70e032dd023312c750ac50ba03ade725fd8016&Recursive=true).

Use the existing Torch/TorchAudio 2.8 and Transformers 4.50 environment, without installing the full WhisperX dependency stack. Load the fixed local files through `Wav2Vec2Processor` and `Wav2Vec2ForCTC`, with network access disabled during inference. The primary method is **CUDA fp16 acoustic inference plus TorchAudio 2.8 standard CTC forced alignment**, not the complete WhisperX pipeline and not a reproduction of all WhisperX preprocessing or postprocessing.

Create a mono 16kHz analysis copy in memory; run the processor's configured normalization and attention mask. Keep integer masks as masks when casting waveform input/model weights to fp16. Use evaluation/inference mode, obtain log-softmax emissions and align the supplied target token IDs with blank ID 0. Record emission/CTC dtype and device; float32 log probabilities may be used for the CTC calculation. The configuration has vocabulary size 3503 and convolution strides with a product of 320, implying roughly 20ms emission steps at 16kHz, not sample-accurate phoneme boundaries. [Model configuration](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/config.json), [processor configuration](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/preprocessor_config.json).

TorchAudio's `forced_align` requires batch size 1 and enough frames for the target plus consecutive repeated labels. It returns log scores; any exponentiation or aggregation must be recorded. The API is deprecated in 2.8 and removed in 2.9, so do not upgrade the environment as part of this trial. Any separately implemented or extracted trellis comparison must have its own method label and pinned source/license; it must not silently replace the primary standard-CTC result. [TorchAudio 2.8 API](https://docs.pytorch.org/audio/2.8.0/generated/torchaudio.functional.forced_align.html), [merge_tokens](https://docs.pytorch.org/audio/2.8.0/generated/torchaudio.functional.merge_tokens.html).

## Frozen existing recordings and transcript controls

`I:/AI/asmr-director-forced-alignment/2026-10-16/cases.json` is the authoritative input manifest. Record its SHA256 in the run receipt before inference. It supplies source paths, WAV and PCM hashes, exact ordered clauses, original plans/failure records and historical evidence. Recheck source identity and WAV facts; do not locate a different file by basename or silently regenerate missing inputs. All three originals are mono 48kHz, 16-bit PCM.

| Case | Existing source trace | Duration / frames | Purpose |
|---|---|---|---|
| `five_sentences` | `9f662760-6b5b-4ed0-a900-e40c50ebb1d1` | 15.36s / 737280 | Sentence-final 啦 and the five-clause safe-cut history |
| `long_internal_pause` | `c6953f1e-bfd9-4c65-9569-0775e1537693` | 30.40s / 1459200 | Long pause inside a longer recording |
| `following_hmm` | `7e564226-9ac0-462c-a736-38016383a316` | 26.56s / 1274880 | Boundary before following speech and possible 嗯 |

Run each manifest reference transcript against its unchanged source. The five-sentence reference begins `回来啦。`; alternate controls use `回来了。`, `回来。`, `回来香蕉啦。`, and the listed 雪→血 / 坐→做 variant. These controlled transcript differences reuse exactly the same PCM and must be reported separately, even if they align successfully. A same-sounding character variant may remain acoustically ambiguous; the trial must not claim lexical spelling verification from CTC scores.

The `following_hmm` control inserts `嗯` before `面快好了`. This comes from an old ASR hypothesis, **not a manually verified truth label**. Its relative score/timing cannot establish whether 嗯 was actually spoken. Do not relabel the reference or select a winning transcript simply because forced alignment finds a path.

The old five-sentence cuts are 2.02, 5.17, 8.97 and 12.26s. The other histories supply only a target-ending cut at 5.57s and 4.36s respectively; remaining entries are unknown. These are historical safe-PCM boundary evidence, not phoneme-level gold labels. Report distance from a historical cut as comparison only, never as alignment accuracy.

## Text and evidence rules

Keep the original clause text and an explicit mapping to normalized alignment characters. Separately identify punctuation/format markers such as `~~` that have no spoken character target. Preflight every remaining character against the exact vocabulary before inference. Do not silently convert a missing character to `<unk>`, a wildcard, a guessed pronunciation or a different character; leave unsupported items visibly unsupported. Any deliberate normalization, including Latin case, digits or script conversion, requires an explicit recorded mapping rather than an invisible text edit.

Current WhisperX source can assign a wildcard emission to out-of-vocabulary characters and interpolate some missing timestamps. This experiment does neither. Preserve unaligned, unsupported, invalid and low-score results; do not fill them with neighboring times or turn a found path into a passing transcript. Character scores describe acoustic path evidence under the supplied text; they are not calibrated correctness probabilities. [Pinned implementation](https://raw.githubusercontent.com/m-bain/whisperX/771b4a14a9486f8fd5aef18ef49e35d639523dd3/whisperx/alignment.py), [model vocabulary](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/vocab.json).

Forced alignment is conditional on the proposed transcript. A missing final particle or inserted word can still receive plausible timing. Record the wrong-text controls alongside the references, including durations and character scores; do not establish an acceptance threshold by selecting whichever value makes these particular recordings pass.

## Native-PCM boundary guard and independent recognition

Character times only propose search locations. A usable experimental cut candidate must also satisfy a real quiet interval measured on the original 48kHz PCM near the intended sentence ending. Record the actual guard settings, interval start/end, measured levels, search limits, final source frame and distance from adjacent character spans. If no suitable quiet interval exists, retain the diagnosis and produce no guarded cut for that boundary. An empty or unaligned character result is not a silence measurement.

When producing experimental excerpts, copy original PCM frames without resampling, fades, padding, gain adjustment or model-generated audio. Any full split group must cover source frame 0 through its last frame continuously and in order; concatenated PCM must equal the original bytes. Distinguish raw character timing, quiet-guard candidates and any independently checked excerpts in the report. None is automatically published or adopted.

Plan an independent recheck using the existing local faster-whisper-large-v3 model identified by `cases.json`, after releasing the alignment model. Feed actual original/excerpt PCM, without the alignment target as a forced transcript or semantic decoding hint. Record exact windows, model/options, transcripts, scores, word times and actual call count. Compare preservation of sentence endings and following speech, including 啦/了 and the possible 嗯. This recheck is **pending until a real result receipt exists**; successful CTC alignment or an old Whisper result cannot stand in for it. Recognition disagreement remains evidence for listening, not automatic proof that either system is correct.

## Resources, receipts and completion boundary

Check existing model activity, then run experiment phases serially without concurrent TTS/Whisper/alignment inference. The isolated tools require both **3 GiB (3,221,225,472 bytes) available physical RAM** and **4.82 decimal GB (4,820,000,000 bytes) of Windows current-process additional commit headroom**; the product memory gate remains unchanged. Use GlobalMemoryStatusEx.ullAvailPageFile for commit headroom, not virtual-address space or free pagefile disk space. Record both byte values before each phase; stop and preserve evidence if either gate fails. Preserve the initial two preflight failures that incorrectly applied the commit budget to physical RAM, and record the metric correction and each run's thresholds without counting them as model failures.

Measure model-load time, per-recording/variant inference and alignment time, source duration/real-time factor, process RAM baseline/peak, available RAM, and CUDA device/dtype plus allocated/reserved baseline and peaks. Report measurement sampling limitations. CPU/fp32 fallback or a retry is a separate labeled run with a reason, never an unreported substitute for CUDA fp16 evidence. Release models by phase; measure rather than infer 6GB-VRAM suitability from the weight's disk size.

Receipts must bind source/PCM and transcript identities, fixed weight/config hashes, method and environment versions, parameters, raw character evidence, OOV/failure states, quiet measurements, excerpt PCM checks and independent ASR outputs where actually executed. Record actual attempts and failures. Do not prefill success, resource numbers, listening acceptance, model accuracy or independent-ASR outcomes in this specification.

Completion means a bounded experiment report with its limitations and evidence, including wrong-text controls and any uncompleted checks. It does not authorize a production implementation, service restart/deployment, gate relaxation, confirmation/adoption or a roadmap change. The earlier [assessment](../records/2026-10-14-safe-cuts-and-manual-text-confirmation.md) remains historical assessment; actual results belong in the new development record and external receipts.
