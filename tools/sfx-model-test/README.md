# Local generated SFX experiment

This standalone experiment tests independent personal-care sound generation and
screens for repeated waveforms. It does not adopt audio into ASMR Director.
See [中文](README.zh.md).

**Latest status, 2026-10-05:** the user said **“相当烂，没法用，先这样吧，记录一下推一版”**.
All three remote AudioLDM2 8-second brush outputs were **rejected as unusable**;
local output count remains **0**, remote output count **3**, with no adoption.
Future model tests are paused. The earlier 5070 Ti host question is no longer
the next action. Stable Audio Open's adapter and external supervisor were
prepared and checked, but model inference was never executed. The separate
13-entry recorded CC0 audition library remains pending listening evaluation.
The user authorized recording and publication; this status does not claim a
completed commit or push. [Current record](../../docs/records/2026-10-04-audio-quality-v1-stable-open-resume.md).

The external supervisor passed six Windows synthetic lifecycle checks; these
are process-control evidence, not model inference or listening acceptance.
See [Stable Audio Open instructions](README_stable_open.md). The plan and
stopped/research-only paragraphs below are historical.

**Historical stop, 2026-10-04:** the user requested alternatives research after the long
attempt. Local output count is 0 (native crash / CUDA memory failures); the
separate remote demo produced 3 brush candidates before quota rejection.
Commands below describe the unfinished experiment and are not current execution
instructions. At that checkpoint there was no cancellable timeout supervisor.
The later prepared Open route has one; all model tests are now paused. Any future
trial requires explicit resumption, an externally enforced wall-clock limit,
a single first case and stop-on-failure before a batch.
See [status and alternatives](../../docs/audio-quality/MODEL_SFX_ALTERNATIVES.md).

- Model: official `cvssp/audioldm2`, revision
  `c8e7e189d324425c05c4c2f81214041ef4107983`.
- Weights: CC-BY-NC-SA-4.0; isolated noncommercial testing. Output is 16 kHz mono,
  with no claim of binaural recording or ear-specific spatial processing.
- Runtime: PyTorch CUDA / Diffusers, FP16 with model CPU offload, default PyTorch
  SDPA attention, DPM multistep scheduler, 50 steps, guidance 3.5, one waveform
  per invocation. Versions and measured GPU usage are saved in the manifest.
- Four categories, three fixed seeds per category, 8 seconds per independent
  generation; three longer takes each of brush/massage test continuous texture variation.
- Stable Audio 3 Small-SFX is a separate future comparison: its official model
  download requires the account holder to accept the gated agreements first.

Keep weights, environments, caches, audio and reports outside Git, on I:. The
existing CUDA environment is used without installing or changing its packages.
The external download receipt records the official revision, byte counts and
SHA256 hashes. Download only configs/tokenizers and safetensors, not duplicate
`.bin` weights. See `docs/THIRD_PARTY_RUNTIMES.md` for provenance.

Example (PowerShell, after verified weights exist):

```powershell
$taskPython = 'D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/python.exe'
$taskModel = 'I:/AI/asmr-director-sfx-model-test/runtime/cache/models/cvssp--audioldm2--c8e7e189d324425c05c4c2f81214041ef4107983'
$taskOutput = 'I:/AI/asmr-director-sfx-model-test/2026-10-04'
$taskRevision = 'c8e7e189d324425c05c4c2f81214041ef4107983'
$env:PYTHONPYCACHEPREFIX = 'I:/AI/asmr-director-sfx-model-test/runtime/pycache'
& $taskPython tools/sfx-model-test/generate.py --model-path $taskModel --revision $taskRevision --artifact-root $taskOutput --categories ear_brushing --seeds 104729
& $taskPython tools/sfx-model-test/generate.py --model-path $taskModel --revision $taskRevision --artifact-root $taskOutput
& $taskPython tools/sfx-model-test/generate.py --model-path $taskModel --revision $taskRevision --artifact-root $taskOutput --categories ear_brushing massage --duration 24
& $taskPython tools/sfx-model-test/analyze_and_listen.py --manifest "$taskOutput/generation-manifest.json" --artifact-root $taskOutput
& $taskPython tools/distance-listening/serve.py "$taskOutput/listening" --port 8769
```

Successful recorded run IDs are preserved on rerun after verifying prompts and
raw SHA256. Changed prompts require a new artifact root. Existing raw files are
never overwritten. Retried failures move into the manifest's attempt history.
The sampler produces each long take from fresh seeded noise; no short clip is
looped or stitched. Raw float32 WAVs stay unchanged. The listening tool also
exports unaltered raw copies and gain-only audition copies, with applied gain
shown. There is no denoising, fade, trim or spatial processing.

PCM hashes detect exact duplicates. Active non-overlapping windows screen for
near-identical waveforms, while RMS-envelope autocorrelation flags periodicity
for inspection. The report specifies coverage and thresholds. Distinct seeds,
hashes or low correlation cannot establish realism or pleasing ASMR. Every
new candidate would start with listening acceptance pending. The three existing
remote brush outputs were rejected on 2026-10-05. The original review criteria were action identity,
harshness, unintended voices/music, variation between seeds and looping within
long takes. Refer to the preserved recorded-source audition at port 8768.

## Separate public remote smoke test

`generate_remote.py` uses the public HF-team AudioLDM2 demonstration, with its
actual 200-step DDIM configuration. Remote timing includes queue/network/download,
GPU metrics are unmeasured, and the loaded weight revision is not disclosed.
The source revision and every API job/SSE receipt are saved. Keep its artifact
root separate from the pinned local baseline. Its public duration is 5–15 seconds.

The 2026-10-04 anonymous run produced three independently seeded 8-second brush
takes, then the service explicitly rejected the massage job because its GPU
quota was exhausted. That queue stopped. The intended 16 remote takes were not
completed; no identity change or quota bypass was attempted. Use the saved
outputs as rejected experimental evidence. No further submissions are planned
while model tests are paused. The saved remote manifest preserves the historical
generation metadata; the 2026-10-05 rejection supersedes the original pending status.
