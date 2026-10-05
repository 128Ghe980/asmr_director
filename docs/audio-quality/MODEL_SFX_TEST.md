# Audio Quality V1 — generated personal-care sound tests

Latest status: 2026-10-05. The user said **“相当烂，没法用，先这样吧，记录一下推一版”**.
All three remote AudioLDM2 8-second brush outputs were **rejected as unusable**.
Counts remain **0 local / 3 remote**, with no adoption. Future model tests are
paused; the earlier 5070 Ti host question is no longer the next action. Stable
Audio Open's adapter and supervisor were prepared but never executed model
inference. The user authorized recording/push; publication is not claimed here.
See [中文](MODEL_SFX_TEST.zh.md) and the [tools](../../tools/sfx-model-test/README.md).

Historical preparation, 2026-10-04: the user resumed testing after the
alternatives discussion. Tools for a single bounded Stable Audio Open take
were prepared; no new inference followed. [Preparation and latest status](../records/2026-10-04-audio-quality-v1-stable-open-resume.md).
The stopped AudioLDM2 results, research-only scope and original plan below are
historical; none is a current instruction to restart model testing.

Actual result: **0 local outputs, 3 remote 8-second brush candidates**. Local
attempts failed with a native load crash and CUDA out-of-memory errors; the
available evidence does not isolate hardware capacity from runtime/loading
problems. The remote demonstration then exhausted its free GPU quota. The saved
2026-10-04 stop check found no owned generation processes. Preserve the downloaded
weights, logs and rejected samples; model testing is now paused. See the
[experiment record](../records/2026-10-04-audio-quality-v1-sfx-model-test.md)
and [alternatives](MODEL_SFX_ALTERNATIVES.md).

The user selected ear cleaning, ear brushing, massage and spray, then emphasized:
**one friction recording must not be repeatedly reused; test model generation**.
This is an experiment within Audio Quality V1, not a new top-level roadmap stage.

The production implementation currently has procedural sound synthesis, and the
separate recorded-source CC0 audition has 13 candidates, still pending listening
evaluation. Neither becomes a generated
model result. This test preserves both libraries and all adopted voice assets.

The following is the original, **uncompleted** test plan, not a current execution
instruction. Test independent takes with the same prompt and settings but seeds 104729,
130363 and 155921. Use four categories × three seeds × 8 seconds; generate longer
continuous brush takes from fresh noise, rather than stitching or looping short
clips. The local test adds three longer massage takes as well. Prompt descriptions specify targets;
they do not establish that the resulting sound really resembles the action.

Two execution routes stay separate:

| Route | Model and parameters | Interpretation |
|---|---|---|
| Local target | Official `cvssp/audioldm2`, pinned `c8e7e189d324425c05c4c2f81214041ef4107983`; FP16, model CPU offload, default SDPA, DPM multistep, 50 steps, 8 / 24 s | RTX 3060 Laptop 6GB must be measured with real output; downloaded files alone do not establish support |
| Public demonstration | `fffiloni/audioldm2-text2audio-text2music-API`; AudioLDM2, FP16 according to source, default DDIM, 200 steps; public duration 5–15 s | Remote queue/network/request times are not local inference times. Demo source is recorded, loaded weight revision is not disclosed |

AudioLDM2 weights carry CC-BY-NC-SA-4.0. Keep these as noncommercial experimental
candidates, outside the production library. Output is 16 kHz mono, with no claim
of binaural recording or ear-position processing. Stable Audio 3 Small-SFX is a
future comparison with gated account-holder agreements; do not bypass its gate.

Record each model/prompt/seed/duration/scheduler, successful job or failure,
source revision where available, actual sample frames, SHA256, generation/request
time and measured local GPU peaks. Keep remote GPU fields null. A quota failure
stops the public demonstration; do not switch identity or disguise retries.

Raw outputs remain unchanged. Audition copies only apply a documented gain with
a -30 dBFS RMS target and -6 dBFS peak ceiling, then PCM16 quantization. The peak
ceiling can prevent matching the target RMS. No loop, trim, stitch, denoise, fade
or spatial treatment is used to improve the test results.

Decoded sample hashes find exact duplicates. A bounded active 2-second window
scan finds some near-identical waveforms, and 10ms RMS-envelope autocorrelation
flags rhythmic periodicity for inspection. A separate FFT waveform autocorrelation
scan tests every sample lag at 16 kHz, for delays from 0.5 to at most 10 seconds,
with overlap-specific DC removal/normalization and a 0.995 positive threshold.
It can find periodic waveforms beyond the fixed window grid, while sine waves
or regular actions may also trigger it. Fixed alignment can miss shifted, stretched
or shorter repeated fragments. Distinct hashes, seeds and no detected clues
cannot certify naturalness, realism or absence of audible repetition. The three
existing remote takes were rejected on 2026-10-05. The original review criteria
were action identity, harshness, unintended voice/music, variation between seeds
and repeated gestures in longer clips; future candidates would initially be pending.

Artifact root: `I:/AI/asmr-director-sfx-model-test/2026-10-04`; weights/cache on
the same I-drive runtime root. Large binaries stay outside Git. Reuse the existing
CUDA environment without changing packages. The [runtime provenance](../THIRD_PARTY_RUNTIMES.md)
and experiment record distinguish completed tests from download progress.
