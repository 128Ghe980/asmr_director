# Qwen3-TTS standalone local evaluation — 2026-10-06

The user requested a Qwen3-TTS listening setup on `I:\AI` because D: is nearly
full. This is an isolated experiment within Audio Quality V1.

## Current status

Setup, all three complete model downloads, and actual CustomVoice/Base
inference/playback are verified. The follow-up added one-shot cloning from the
existing reference catalog and a matched Serena1.7B instruction comparison.
Two reference clones and both comparison samples were generated and fully
played. The local page remains running with model weights released.
Listening quality and clone similarity remain for the user to judge.

## Installation and usage

- Root: `I:/AI/qwen3-tts`. Chinese/English instructions are in `README.zh.md` /
  `README.md` there. Model weights, the isolated venv, source, caches, temporary
  files and output WAV/JSON are on I:.
- Official source commit: `022e286b98fbec7e1e916cb940cdf532cd9f488e`,
  <https://github.com/QwenLM/Qwen3-TTS>; code and official model cards state Apache-2.0.
- Python 3.12.8 base interpreter remains in the existing read-only
  GPT-SoVITS `env-comfyui-clone` on D:. CUDA torch/torchaudio 2.8.0+cu129 and
  their companion packages were copied to the new I: venv. Other environments
  were not upgraded. Required dependencies are installed only in the new venv.
- Verified versions: qwen-tts 0.1.1, transformers 4.57.3, accelerate 1.12.0,
  gradio 5.50.0, librosa 0.11.0, NumPy 1.26.4. `pip check` passes;
  CUDA/BF16 and UI construction pass on the RTX 3060 Laptop GPU, 6GB.
- Models: 0.6B/1.7B CustomVoice and 0.6B Base. CustomVoice0.6B supports preset
  voices only; instruction control needs CustomVoice1.7B. Base clones a reference
  voice without training, preferably with its accurate transcript, and does not
  support natural-language instructions. All inference is local/offline,
  BF16/SDPA, single model and serial generation. No FlashAttention dependency.
  Windows uses safetensors0.8.0 `pread` and disables Transformers' allocator
  warmup only during loading; both library entry points are restored in finally.
- `start.cmd` / `stop.cmd`; local page `http://127.0.0.1:7863`. It includes text,
  speaker/language, read-only reference preview, per-request transcript/audio-only
  controls, 1.7B instruction comparison, WAV/JSON output and model-release controls.
  Limit: 250 characters / 512 audio tokens; long text can truncate. Output is mono.
- Standard-library downloader verifies exact HTTP ranges and every full SHA256
  using the official Qwen ModelScope API. All three main weight hashes match the
  recorded official Hugging Face hashes. Identical codec files are reused after
  validation. Per-model receipts avoid concurrent manifest writes.

## Actual 0.6B result

Serena, Chinese, seed42, no instruction, 512-token cap. Text:
“欢迎回来，辛苦了。先坐下来，慢慢放松。今晚，我们只需要安静地休息。”

`outputs/qwen_0.6_Serena_20261006_064951_392090.wav`: **7.92s**, mono24kHz,
PCM16,190080 frames; peak0.3418/RMS0.04482. SHA256
`f8854d804425389c8d094248df1fe8f683eaf16491a49e037d2b437df65e3a59`.
Load3.889s, generation27.862s, elapsed32.07s, peakallocated2.245GiB.
Actual browser generation, audio playback to0:08, output links and model release
pass. Released model weights return GPU usage to about1.26GB including the
desktop/context; this does not mean every CUDA context byte is unloaded.

## Actual 1.7B result and Windows memory recovery

Same text, Serena, Chinese, seed42 and 512-token cap. Instruction:
“用温柔、轻声耳语的方式说话，语速稍慢，保持自然呼吸和舒缓的节奏。”

`outputs/qwen_1.7_Serena_20261006_071232_697305.wav`: **13.76s**, mono24kHz,
PCM16,330240 frames; peak0.2461/RMS0.03947. SHA256
`fa9f0c3b9bf20718762e8edd9ee63019c2fcaeac6df2b65cb3305ef76265a916`.
Load9.514s, generation46.157s, elapsed55.951s; peakallocated4.300GiB,
reserved4.570GiB. Actual browser generation, playback to0:14, output links
and model release pass. After release overall GPU usage is about965MiB.

The initial 1.7B load hit Windows error1455 (pagefile/commit limit), including
a `pread`-only retry. Safetensors0.8 still briefly maps the file header;
Transformers4.57.3 also preallocates GPU storage during warmup. Disabling that
warmup together with `pread` resolved the actual load without changing weights,
system paging settings, or creating a derived model. The optional standard-library
`prepare_sharded_model.py` was written but never run; no shards or layout copies exist.
References: [Safetensors API](https://huggingface.co/docs/safetensors/en/api/torch)
and the [Transformers Windows mapping report](https://github.com/huggingface/transformers/issues/48285).

Both models have14 complete SHA-verified files. The final merged manifest and
`logs/verification.json` verify sizes, receipt hashes, paired sample parameters,
WAV frames/non-silence/SHA256, HTTP200, browser playback and model release.
Other evidence: `logs/environment.json`, `requirements-lock.txt`,
`logs/baseline-wav-verification.json`, adjacent output JSON,
`logs/serena-1.7b-result.png` and `logs/serena-ready.png`.
The start/stop launchers were exercised through real stop/restart cycles;
current server ownership is in `server.json` and the final verification receipt.

## Boundaries and follow-up

No product provider replacement, audio adoption, repository app-code change,
commit or push. The existing3001 service, browser project data,
references and assets retain their own paths. SFX model work remains paused;
Audio Quality V1 remains in progress. Initial system memory pressure caused
import/download errors; the user closed apps, and successful generation plus
the Windows loading adjustment established runtime viability. A missing copied
`torio` companion was repaired. Recursive cleanup of this task's interrupted
venv/pip/HF temporary files was policy-rejected, so those files remain on I:.
SoX CLI is absent and emits an import notice; the verified CustomVoice/Base WAV paths do
not require it. Whisper control does not establish binaural or listening quality.

## Follow-up: existing-reference clones and instruction comparison

The user requested one-shot support for the existing references and another
instruction comparison. Added `references.py`, Base generation and comparison
handling in `runtime.py`, the corresponding `app.py` controls and CLI options,
and Base support in `download_models.py`. Both local READMEs were updated.
All these files are under `I:/AI/qwen3-tts`; repository changes for this work
are documentation only.

`Qwen3-TTS-12Hz-0.6B-Base` has14 complete download-time SHA256-verified files.
HF revision reference `5d83992436eae1d760afd27aff78a71d676296fc` is an upstream
reference, not a ModelScope commit identity. Main weight size1829344272bytes,
SHA256 `180b3b10eb1c9f1b4db7806d5475bae3071c0243c299d49926bab1da3b6946f6`.
The identical verified codec is shared through a same-volume hardlink. The
completed per-model receipt is `models/Qwen3-TTS-12Hz-0.6B-Base.download-manifest.json`;
the merged `models/download-manifest.json` now records all three models.
See [official voice cloning documentation](https://github.com/QwenLM/Qwen3-TTS#voice-clone)
and the [official Base model](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base).

The catalog dynamically reads the existing VoxCPM2 profile: five reference WAVs,
four with transcripts. Preview audio is copied only to an I-drive SHA-named cache;
edits to the displayed transcript affect this request only. The15s reference
without a transcript defaults to audio-only mode, observed in the browser;
that mode was not synthesized in this test. Original profile, five WAVs and
four transcript files were checked before/after: all10 size/SHA256 pairs match
in `logs/reference-preservation-before.json` / `reference-preservation-after.json`.

All four new samples use the same sentence quoted above, Chinese, seed42 and
max512tokens. Base uses reference+transcript (`x_vector_only_mode=false`). The
comparison uses Serena1.7B with identical parameters and only the instruction
changed; each sample resets its seed. The instruction is the gentle-whisper
sentence quoted above. Base rejects instructions because its upstream path
does not support them.

| Sample | WAV under `outputs/` | Duration | Generation | Peak allocated |
| --- | --- | ---: | ---: | ---: |
| Base: 温柔中文参考 | `qwen_0.6-base_soft_zh_20261006_080000_761845.wav` | 6.32s | 46.737s | 2.447GiB |
| Base: 正太音2 | `qwen_0.6-base_user-dd2a4e32-e72d-4e80-bf7d-96611831b52b_20261006_080226_588809.wav` | 7.52s | 33.265s | 2.685GiB |
| Serena1.7B: no instruction | `qwen_1.7_Serena_20261006_075531_463109.wav` | 6.80s | 25.197s | 4.099GiB |
| Serena1.7B: gentle-whisper instruction | `qwen_1.7_Serena_20261006_075606_371906.wav` | 13.76s | 48.479s | 4.300GiB |

Base cold load4.196s; comparison cold load9.310s. The second sample of each
model reuses the loaded model, so these generation times are not cold-start totals.
All four outputs are non-silent mono24kHz PCM16, with corresponding JSON metadata,
source-reference hashes for clones, and independent output SHA256:

- 温柔中文参考: `717b372d1524619bf4fe68a5f02926026198f12575c85bc0b478646ef9e1d4db`.
- 正太音2: `efc20490f060587b6eab1cc822a7b67b7c2d6dc36806eb524ecfede7ec254f46`.
- Serena no instruction: `a32c7137a06e394581c18bad53f450b3361c0b27f5bd563f29e49294aa2d8303`.
- Serena with instruction: `fa9f0c3b9bf20718762e8edd9ee63019c2fcaeac6df2b65cb3305ef76265a916`.

`outputs/instruction_comparison_20261006_075531_454206.json` records the completed
pair. `logs/clone-comparison-verification.json` verifies WAV formats, frames,
non-silence, hashes, matched parameters, Base receipt/current file sizes,
HTTP200, actual browser generation/full playback/download links and preservation.
The model hashes were verified during downloading; the final helper rechecks
receipt/current sizes without hashing multi-GB weights again. Screenshots:
`logs/clone-soft-and-comparison.png`, `logs/clone-and-comparison-ready.png`.
AST and CLI help passed before launch; the actual browser is the UI integration
check. The model-release action was confirmed; overall GPU usage afterward
was805MiB, including desktop/CUDA context. I: has21.62GiB free at this check.
Current server ownership is in `server.json`; recheck it before reuse rather
than relying on a historical PID.

中文：已补装0.6B Base，接入5条现有参考，并真实生成温柔中文6.32秒、正太音2 7.52秒。
1.7B Serena同台词/seed对照：无指令6.8秒，温柔耳语指令13.76秒；四段完整播放并验证保存。
原配置、5条录音、4份原话文件哈希未变化，模型显存已释放；音色相似度与耳语听感待用户听审。
实验仍属于 Audio Quality V1，不直接接入或替换现有 ASMR Studio，SFX继续暂停。

## Follow-up: reference voice plus instructions using the community method

The user found the 0.6B clone insufficient and authorized a trial combining the
existing reference with natural-language controls. This evaluation is isolated
at `I:/AI/qwen3-tts-community`, with a Chinese page on port7864, its own launchers,
cache, temporary files, derived assets, voice exports and output receipts. The
official port7863 page was stopped to free memory; its models and samples remain.
No product provider/profile replacement or automatic audio adoption is involved.

The community source is pinned at commit
`ef339be58a778b062e1c14382347964552eae007`. Windows has neither an enabled WSL
installation nor a registered Linux distribution. Rather than enable system
features or reboot, this trial adapts the community x-vector plus TPAD/WOVR graft
method to the already working native Python/CUDA environment. **The original C
engine has not been built or run.** Python results do not verify its numerical
equivalence or performance. Source remains unmodified.
See [community source](https://github.com/gabriele-mastrapasqua/qwen3-tts) and
[graft format](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/docs/icl-graft-portability.md).

Only82 selected tensors from official 1.7B Base are needed: the speaker encoder,
text projection, codec embedding and three special text-token rows. The derived
subset is53,392,512bytes (50.92MiB), SHA256
`507f2f5b771b208bba366603c08a0730228ab322d42f03a2bdd6db133b68add2`.
It comes from exact206 ranges, checked individually and per tensor, associated
with official HF revision `fd4b254389122332181a7c3db7f27e918eec64e3` and the matching
ModelScope file metadata. The complete3.86GB Base checkpoint was **not** downloaded
or rehashed; its upstream SHA in the manifest identifies the remote file only.
Asset receipt: `assets/base_1.7_subset.manifest.json` under the community root.

`bridge.py` independently extracts the reference embedding on CPU FP32 with the
official24kHz/128-mel speaker encoder. The actual6.9s `soft_zh` reference produced
an8192byte float32-LE2048-vector, SHA256
`b5a338698094d249d6987d821c62d2f7633e0967e2f2e25ac81ece545f3f45e5`.
It reuses the original 1.7B CustomVoice checkpoint and environment, passes this
embedding and instruction tokens together to the internal generator, and decodes
on GPU BF16/SDPA. Graft temporarily substitutes Base text projection, codec rows
0:2048 and BOS/EOS/PAD text rows, then restores them in finally. Original model
files and the public SDK are not edited. This experiment does not use reference
transcripts or reference-code ICL; shared compatibility tensors are not a newly
trained per-user voice model. Existing five references remain available read only.

The actual matched trial uses `soft_zh`, graft, the same Chinese sentence quoted
above, seed42, max512tokens. Instructions are empty, “用轻柔、舒缓的声音说话，语速稍慢，保持自然。”,
and the same gentle-whisper instruction from the official1.7B comparison.
The completed receipt is `outputs/comparison_20261006_091806_551356.json`.

| Sample | Community WAV under `outputs/` | Duration | Generation | Peak allocated |
| --- | --- | ---: | ---: | ---: |
| No instruction | `adaptation_graft_soft_zh_20261006_091854_917350.wav` | 8.80s | 32.218s | 4.173GiB |
| Soft instruction | `adaptation_graft_soft_zh_20261006_091926_847189.wav` | 9.36s | 31.676s | 4.188GiB |
| Whisper instruction | `adaptation_graft_soft_zh_20261006_092000_229402.wav` | 9.68s | 33.174s | 4.198GiB |

Cold CustomVoice load9.489s; the second and third takes reuse the model. These
three durations/timings establish actual generation, not voice similarity,
whisper naturalness or user acceptance. Those listening decisions remain open.

`logs/verification.json` passes artifact/provenance/preservation verification:
all three WAVs are non-silent mono24kHz PCM16 with no clipped samples, matching
parameters and source hashes. Independent WAV SHA256 values are:

- No instruction: `5a4a6634ba05faab4e4e4dcdc04fe7dab5c9d7e8e2d198ea453cb256fd345960`.
- Soft instruction: `c447456166f1575d28cf2b9611d9e4e70585f0e72a3cd43a40635d6888127198`.
- Whisper instruction: `cfc654ec1f30141edd9b57aa2e9efe462dca792a23e1d9f2548848de4f914021`.

RMS is0.03022/0.02821/0.09068 respectively; the whisper-instruction take is louder
in this unnormalized comparison. These measurements support signal validity;
voice identity and whisper effectiveness remain listening questions.
The Base derived subset/config and82 tensor payload hashes match their receipt;
the exported voice vector is finite and receipt-matched. All10 original profile,
audio and transcript size/SHA pairs are unchanged in the before/after snapshots.
The reused3,833,402,552byte CustomVoice main weight was fully rehashed this time
and still matches its download SHA256 in
`logs/original-customvoice-weight-check.json`. Source Git status is clean.

Actual UI generation, all three full playbacks (ending at0:09/0:09/0:10), visible
download links and model release were observed and recorded in
`logs/browser-verification.json`. Screenshot: `logs/community-three-comparison.png`.
`logs/runtime-check.json` records HTTP200, the official7863 page stopped, the
community7864 page available, about870MiB total GPU usage after releasing weights,
and21.15GiB free on I:. The page and saved audio remain available. These are
historical checks; current ownership is in the community root `server.json`.

中文：已用现有温柔中文参考真实生成“无指令8.80秒／轻声指令9.36秒／耳语指令9.68秒”。
三个版本同台词、seed、graft方式，完整播放及文件核验通过；原参考、原配置和模型文件保持。
独立页面7864和音频保留在I盘，模型显存已释放。此次是社区方法的Python适配，原C引擎未运行，
音色相似度与指令效果待用户听审，不据此接入正式provider；Audio Quality V1继续进行、SFX仍暂停。

## Follow-up: user-rejected whisper and one new take

The user explicitly rejected the9.68s graft whisper-instruction result as
“这个耳语完全不对” and requested another generation. That sample is retained;
its perceptual status is **rejected by the user**, overriding the earlier
pending-listening description for that take. Technical file checks remain
historical artifact checks, not listening acceptance.

Generated one new take through the7864 page's custom-instruction controls,
preserving `soft_zh`, graft, Chinese, the original text and512-token cap. Seed
changed42→43, and the instruction now explicitly requests an unvoiced/breathy
whisper throughout:

“Speak the Chinese text in an intimate, close-mic, breathy ASMR whisper throughout,
with audible airflow and almost no vocal-fold vibration. Keep the reference
timbre and clear words, speak slowly, and never switch to normal voiced speech.”

New output under `I:/AI/qwen3-tts-community/outputs/`:
`adaptation_graft_soft_zh_20261006_114933_072753.wav`,10.72s, mono24kHz PCM16,
257280frames, peak0.11914/RMS0.01431, zero clipped samples. SHA256
`9d5b894109011e39976be59ef3ba4069992fde2d77a2af77fd94ec6456cc3487`.
Cold load9.639s, generation37.294s, elapsed47.386s, peakallocated4.228GiB.
The reduced signal RMS is not a perceptual whisper acceptance result.

`logs/whisper-retry-verification.json` passes the new file/parameter checks and
confirms the rejected original audio and all10 protected source files retain
their hashes. Actual UI full playback ended at0:11; WAV/JSON downloads are shown,
HTTP200 and model release were confirmed, leaving about883MiB overall GPU usage.
Screenshot: `logs/whisper-retry.png`. The new take's **listening status is pending**;
no claim that whisper quality has been repaired. The page and both takes remain,
with no model/runtime code or product-provider changes.

中文：上一版9.68秒耳语已按用户反馈记为听感拒绝并保留；改用明确英文气声耳语指令、seed43，
原参考/台词/graft不变，真实重生成10.72秒候选。完整播放、文件核验、原文件保持和显存释放通过；
新候选待用户试听，未宣称耳语已修复。

## Follow-up: emotion and expressive fullness matrix

The user requested different emotions and different degrees of emotional
fullness. The matched trial uses joy/sadness/anger, each with restrained/clear/full
direction, yielding nine requested takes. All share the existing `soft_zh`
reference, graft, original Chinese text, seed44 and512-token cap. Only the
instruction changes; every call resets the same seed. The full English prompts
and actual generated metadata are recorded in
`I:/AI/qwen3-tts-community/outputs/emotion_20261006035420Z.json`.

These prompts request normal voiced delivery, preserving the reference timbre
and clear Mandarin while varying emotional cues, vocal weight, emphasis and
rhythm. The three labels describe requested acting choices, not a calibrated
scalar emotion control or independently measured vocal fullness. Audio is
retained at its original amplitude; no normalization or other waveform editing
is applied. The previous rejected whisper and the10.72s retry remain separate.

An independent static listening gallery is built under
`outputs/galleries/emotion_20261006035420Z/`, with nine cards, the reference
recording, actual prompts, per-file metadata and a manually initiated sequential
playlist. WAVs/JSON are copied byte-for-byte and verified by SHA; source outputs
and original references remain. The gallery is served only on127.0.0.1:7865 with
the standard-library HTTP server; the original generation page remains on7864.
`start-emotion-gallery.cmd`/`stop-emotion-gallery.cmd` control only this gallery.

All nine actual UI generations completed. Gallery files use the readable case
IDs below; the manifest maps each one to its original timestamped output and
unmodified adjacent JSON under the community root.

| Emotion | Requested degree | Gallery WAV | Duration | Generation | Peak allocated |
| --- | --- | --- | ---: | ---: | ---: |
| Joy | restrained | `joy_low.wav` | 10.40s | 45.168s | 4.219GiB |
| Joy | clear | `joy_mid.wav` | 8.00s | 34.143s | 4.149GiB |
| Joy | full | `joy_high.wav` | 7.92s | 34.247s | 4.147GiB |
| Sadness | restrained | `sad_low.wav` | 9.28s | 38.638s | 4.186GiB |
| Sadness | clear | `sad_mid.wav` | 10.40s | 44.959s | 4.219GiB |
| Sadness | full | `sad_high.wav` | 11.84s | 51.090s | 4.260GiB |
| Anger | restrained | `anger_low.wav` | 8.88s | 38.637s | 4.174GiB |
| Anger | clear | `anger_mid.wav` | 7.60s | 32.507s | 4.138GiB |
| Anger | full | `anger_high.wav` | 8.00s | 34.664s | 4.149GiB |

Total audio82.32s. Cold load9.880s; subsequent takes reuse the model. Maximum
allocated GPU memory4.260GiB. `logs/emotion-verification.json` passes technical
checks: nine distinct non-silent mono24kHz PCM16 WAVs with no clipped samples,
shared parameters and stable source/voice hashes, exact adjacent metadata,
all10 original reference/profile files preserved, and all four earlier community
WAV/JSON pairs preserved. The full checkpoint was not unnecessarily rehashed
again in this follow-up; derived subset/config hashes were checked against the
previous verified assets. No model or generation-code changes were needed.

`gallery-manifest.json` verifies all copied WAV/JSON bytes. The separate
`logs/emotion-gallery-verification.json` confirms HTTP200, served HTML matching
the saved page, all nine served WAV SHA256 values matching their original files,
and the served reference matching the original. Model release returned overall
GPU use to880MiB; I: had22,546,743,296bytes free at this check. Current server
ownership is `emotion-gallery-server.json` (gallery) and `server.json` (generation).
These are technical and runtime results; nine-take perceptual acceptance remains
pending, without a claim of calibrated or monotonically increasing emotions.

Actual gallery UI verification clicked the sequence button, observed1/9 then9/9,
and finished with “9段播放完成”, all nine cards marked ended and the button restored
to “按顺序播放9段”. This verifies82.32s of complete sequential playback, not auditory
quality. `logs/emotion-browser-verification.json` records these observations;
`logs/emotion-grid.png` shows the completed desktop three-column gallery. Both
generation and gallery tabs remain available as user outputs.

中文：真实生成喜悦／悲伤／愤怒各克制／明显／饱满，共九段。原参考、台词、seed44保持，
仅改变普通有声情绪指令；九段原始音量、原始波形保留，文件与来源核验、82.32秒连续完整播放通过。
九格页7865可逐段或顺序试听，生成页7864保留，模型显存释放；情绪区分、饱满度递增与相似度
待用户听审，不把指令目标当听感验收，不更换正式provider，旧耳语拒绝/新耳语待听状态保持。
