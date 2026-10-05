# Generated SFX alternatives after stopping the local test

Research checked: 2026-10-04. Status superseded: 2026-10-05.
[中文](MODEL_SFX_ALTERNATIVES.zh.md).

## Current status: model tests paused (2026-10-05)

The user said “相当烂，没法用，先这样吧，记录一下推一版”. All three remote
AudioLDM2 brush outputs, each 8 seconds long, were rejected as unusable. Actual
generation totals remain **local 0 / remote 3**; no model output was adopted.
Their listening decision is rejected, superseding the earlier pending status.

Future model tests are paused. Choosing or connecting to the RTX 5070 Ti host is
no longer the next action. The Stable Audio Open adapter and external timeout /
cancel supervisor were prepared and checked with lightweight/synthetic cases;
Stable Audio Open model inference was never executed. The separate recorded
CC0 library has 13 audition entries and remains pending listening acceptance.

The user authorized recording this state and pushing one source-only version.
Publication status and actual push evidence belong in the
[main record](../records/2026-10-04-audio-quality-v1-sfx-model-test.md); this
alternatives document alone does not establish a completed push.

## Historical alternatives research (2026-10-04)

At this research checkpoint, the user had reported a five-hour,
difficult-to-interrupt attempt and requested alternatives research. Generation
was stopped: local output count 0, remote brush candidates 3, with listening
acceptance still pending then. That status is superseded above. This research
made no installs, model downloads or paid calls. The capabilities, prices,
source facts and recommendations below are the 2026-10-04 findings, not fresh
verification or instructions to resume tests.

| Route | Evidence and fit | Remaining limits |
|---|---|---|
| **First local candidate: Stable Audio 3 Small-SFX, LiteRT CPU** | Official Windows x64 runtime avoids PyTorch/CUDA; has seed control and frees stages after use. Small assets are roughly 2.3 GB on disk. [Runtime](https://github.com/Stability-AI/stable-audio-3/blob/main/optimized/tflite/README.md) | Disk size is not peak RAM. This machine's speed, memory and care-sound quality are untested. Optimized checkpoints are experimental. |
| Stable Audio 3 official API | Cloud generation, 1–380 seconds, seed control; can generate a complete long take. Price checked 2026-10-04: 26 credits / US$0.26 per successful generation. [API](https://platform.stability.ai/docs/api-reference), [pricing](https://platform.stability.ai/pricing) | Paid account/key needed. API uses Large, not local Small-SFX. No quality trial here; paid options remain deferred. |
| ElevenLabs SFX v2 | Cloud sound effects, API duration 0.5–30 seconds; use `loop=false`. [API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) | No public seed parameter. Official pricing descriptions differ on minute versus generation billing; verify account cost before use. [Pricing](https://elevenlabs.io/pricing/api) |
| AudioLDM small-v2 fallback | 421M parameter model, 16 kHz mono, CC-BY-NC-SA-4.0. [Model card](https://huggingface.co/cvssp/audioldm-s-full-v2) | Smaller weights do not resolve the observed runtime failure. Retains PyTorch/Diffusers and noncommercial restrictions; lower priority. |

At the research checkpoint, the official HF metadata API reported
`gated=false`, `private=false` for the **optimized** Stable Audio repository, revision
`da6edc54ddba10bfd79a077102ded687f80e882b`. The original Small-SFX checkpoint is
separately gated; do not conflate their access rules. Both require attention to
model terms: optimized assets are under Stable Audio Community and the text
encoder under Gemma terms, not CC0. [Optimized model card](https://huggingface.co/stabilityai/stable-audio-3-optimized).

The historical recommendation was based on runtime/interface fit, not sound
quality: a free CPU trial on the 6GB laptop, with an externally enforced
five-minute limit and explicit cancellation, one 20–30-second brush take,
memory/time recorded, and a stop on failure. At that checkpoint the helper had
no such supervisor; the later prepared supervisor is described above and has
not been used for Stable Audio Open inference. The proposed expansion was three
independent seeds only after a usable first result, then other care categories.
Each raw take would be preserved and inspected for audible/internal repetition.
Neither seed changes nor stereo output prove unique gestures or binaural
realism. Do not extend one friction clip by looping it.

The free public AudioLDM2 demo had rejected the next job on quota at the
checkpoint, making it an unreliable supply path. The three existing takes and
the separate 13 recorded candidates remain preserved. Audio Quality V1 remains
in progress, with model tests paused as stated above.

## Historical follow-up: possible RTX 5070 Ti 16GB host

At the research checkpoint, the user identified another desktop as a possible
test host. Connection, installation and execution had not been requested, and
the host had not been inspected. Later testing preparation did not execute
Stable Audio Open inference; the latest pause supersedes the host question.

| Model | Local capability | Selection notes |
|---|---|---|
| **Stable Audio Open 1.0** | Up to 47s, 44.1kHz stereo, explicit seed; official FP16 Diffusers example. [Model card](https://huggingface.co/stabilityai/stable-audio-open-1.0) | First GPU smoke candidate for simpler setup without a separate FA2 installation step; gated Community terms. |
| **Stable Audio 3 Medium** | Up to 380s, 44.1kHz stereo, editing/continuation. Official H200 peak allocated VRAM: 5.49GB at 30s, 6.52GB at 380s. [Project](https://github.com/Stability-AI/stable-audio-3) | Capacity looks promising on 16GB, not a 5070 Ti measurement. Compatible FA2 required; longer-take comparison. |
| **TangoFlux** | 1–30s, 44.1kHz stereo. [Project](https://github.com/declare-lab/TangoFlux) | Research/dataset license restrictions, not an unrestricted product asset route. No official 5070 Ti RAM benchmark. Explicit lower-level seed handling needed. |
| AudioGen Medium | 16kHz mono; official inference minimum is 16GB GPU. [Docs](https://github.com/facebookresearch/audiocraft/blob/main/docs/AUDIOGEN.md) | At the stated minimum, not proven headroom; CC-BY-NC-4.0 weights. Short-sound fallback. |

TangoFlux source at `164420faa2b3f8a28bb013ccde7006422a616fc7` shows
`generate()` omits seed and `inference_flow(seed=0)` resets Torch RNG before
sampling, overwriting an external seed change. Pass distinct seeds to the
lower-level call for independent variations. Source review does not establish
bit-identical measured outputs. [Wrapper](https://github.com/declare-lab/TangoFlux/blob/164420faa2b3f8a28bb013ccde7006422a616fc7/tangoflux/__init__.py),
[sampler](https://github.com/declare-lab/TangoFlux/blob/164420faa2b3f8a28bb013ccde7006422a616fc7/tangoflux/model.py).

5070 Ti is Blackwell / sm_120. PyTorch officially supports Blackwell starting
at 2.7/cu128; do not copy Medium's default cu126 or old FA wheel examples.
[PyTorch](https://pytorch.org/blog/pytorch-2-7/). FA2 `v2.8.3.post1` includes
sm_120 build code, but the actual binary/runtime needs verification; do not
declare Blackwell unsupported from an outdated hardware list.
[Build source](https://github.com/Dao-AILab/flash-attention/blob/v2.8.3.post1/setup.py).
Linux/WSL2 is preferable for FA2; Open + Diffusers is a simpler native Windows
start. [FA platform notes](https://github.com/Dao-AILab/flash-attention#installation-and-features).

The historical proposed sequence was one bounded/cancellable smoke test, then
three independent 20–30s takes per eligible model, with Small-SFX as the
effects-specific reference; preserve raw takes and evaluate action identity,
harshness and repeated gestures. This sequence is deferred while tests are
paused. All four GPU routes remain untested here; no 5070 Ti speed or ASMR
acceptance claim is made.
