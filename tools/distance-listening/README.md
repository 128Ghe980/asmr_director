# Distance listening experiment

An offline listening harness for the approved Audio Quality V1 work. It does not change the product mixer, Timeline DSL, saved projects, or TTS generation. On 2026-09-14 the user chose original D over E/F/G, finding E's reduced distant echo/reverberation less spacious. D remains the listening baseline. The new continuous long-voice motion artifact is technically verified; its listening judgment and product spatial integration remain unfinished.

Design, sources and results: [English report](../../docs/superpowers/specs/2026-09-13-distance-listening-experiment.md) / [中文记录](../../docs/superpowers/specs/2026-09-13-distance-listening-experiment.zh.md).

## Run

Local Python: `D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe`.
Dependencies used: Python 3.11, numpy 2.4.6, scipy 1.17.1, soundfile 0.14.0, h5py 3.16.0, pyloudnorm 0.1.1. The last dependency was installed in this existing audio venv for the experiment.

From the repository root in PowerShell:

```powershell
$audioPython = 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe'
$listeningOutput = 'D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13'
& $audioPython tools/distance-listening/render.py --config "$listeningOutput/render-config.json" --output $listeningOutput
& $audioPython tools/distance-listening/verify.py $listeningOutput
& $audioPython -m unittest discover -s tools/distance-listening -p 'test_*.py' -v
& $audioPython tools/distance-listening/serve.py $listeningOutput --port 8767
```

Open `http://127.0.0.1:8767/`. The server supports byte ranges so WAV seeking works. The completed `index.html` also works directly with `file://` when kept beside its `audio/` directory. A page-only refresh is available with `render.py --page-only --output <directory>`.

Browser validation on this host:

```powershell
node tools/distance-listening/browser-check.cjs $listeningOutput
```

`browser-check.cjs` uses the installed Codex Playwright runtime and Edge paths; edit those paths on another machine. It launches an isolated headless browser, checks actual WAV playback and the complete asset matrix, and saves desktop/mobile screenshots and a JSON report. No user project storage is accessed.

## Files

- `near_field.py`: independently implemented rigid-sphere magnitude distance compensation and minimum-phase FIRs.
- `render.py`: source preparation, measured HRIR rendering, shared distance curve, room approximation, crossfaded movement, loudness variants and manifest.
- `listening-template.html`: self-contained Chinese listening page, populated from the generated manifest.
- `verify.py`: independent output checks, hashes, true-peak estimate, loudness tolerance and preservation of interaural differences.
- `test_near_field.py`, `test_render.py`: numerical reference and continuity/tail tests.
- `serve.py`: loopback-only local server with byte-range responses.

Generated WAVs, raw sources, source metadata, render configuration, screenshots, manifests and server logs remain outside Git in the runtime output directory. The render configuration records exact source selections; neither fresh TTS nor a paid provider is needed.

## Interpretation

There are 80 WAVs: 2 sources × 4 methods × (4 scenes + one tour) × 2 loudness modes. Each static matched clip uses a single scalar applied equally to both ears. An approach clip is matched as a whole; its within-clip loudness envelope remains. The matched tour concatenates these separately matched segments, without a further whole-tour normalization.

The distance curve is a bounded creative curve shared across methods, not calibrated absolute sound pressure. Near-field compensation is modeled, not measured. The room response combines geometric first-order reflections with a synthetic short diffuse tail, not a measured BRIR or a full room solver. No head tracking, individual HRTF selection, ear parallax or Doppler is claimed.

## D/E/F/G refinements (2026-09-14)

This is a separate output retaining the old D algorithm as reference. E adds second-order images, wall filtering and an FDN tail. F adds onset-aligned parallax interpolation and voice-source directivity. G combines them. The same input/prepared hashes are required; no new TTS. There are 96 WAVs (two sources, four methods, five scenes plus tour, two modes). New scenes expose oblique approach and source rotation; brush rotation is an unchanged control.

The user subsequently preferred D; E/F/G are not adopted. This comparison is no longer awaiting feedback. The artifacts remain available for reference.

Design and algorithm survey: [English](../../docs/superpowers/specs/2026-09-14-distance-algorithm-refinements.md) / [中文](../../docs/superpowers/specs/2026-09-14-distance-algorithm-refinements.zh.md).

```powershell
$audioPython = 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe'
$originalListening = 'D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13'
$refinedListening = 'I:/AI/asmr-director-distance-listening/2026-09-14'
& $audioPython tools/distance-listening/refine.py --reference $originalListening --output $refinedListening
& $audioPython tools/distance-listening/verify.py $refinedListening
& $audioPython tools/distance-listening/verify_refinement.py $refinedListening
& $audioPython -m unittest discover -s tools/distance-listening -p 'test_*.py' -v
& $audioPython tools/distance-listening/serve.py $refinedListening --port 8768
```

While the server is running: `node tools/distance-listening/browser-check.cjs <refined-output-directory> http://127.0.0.1:8768/`.

`source_geometry.py` provides the parallax and approximate voice radiation filters. Its fixed 74-sample interpolation guard for Viking A is also applied to every comparison/direct/reflected path. `refine_room.py` computes unique 6+18 image sources and a contractive eight-line FDN. `verify_refinement.py` compares the new static D outputs against old WAVs after removing common delay/gain and tests that source orientation affects reflected structure, rather than only overall level. FDN is not SDN; wall/directivity parameters are listening presets, not measured materials or a measured whisper pattern. Full model limitations are in the bilingual report.

## Original D with long continuous motion (2026-09-14)

This artifact reuses the accepted 34.75-second, complete 16-clause voice without new TTS, repetition or time stretching. Four synchronized paths make one orbit (left→back→right→front→left): fixed 0.18 m, 0.8 m and 1.75 m radii, plus a 1.75→0.18 m spiral. All distances are measured from head center. Orbit motion holds for the first 1.5 s and last 2.5 s; approach reaches 0.18 m at 27.105 s and holds it for the remaining 7.645 s of source audio. Eight 35.4-second PCM24 stereo WAVs provide natural and whole-clip matched loudness. The position disclosure shows the preset trajectory, not measured perception; the full transcript is also collapsed by default.

Design and verification: [English](../../docs/superpowers/specs/2026-09-14-d-long-motion.md) / [中文](../../docs/superpowers/specs/2026-09-14-d-long-motion.zh.md). Output is on I: because D: is nearly full; leave the completed 8767/8768 outputs intact.

```powershell
$audioPython = 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe'
$originalListening = 'D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13'
$motionSource = 'I:/AI/voxcpm2-evaluation/listening/longtext-deepseek-class-local-pause-20260904/03_deepseek_class_local_rule.wav'
$motionAsr = 'I:/AI/voxcpm2-evaluation/evidence/longtext-deepseek-class-local-pause-asr.json'
$motionOutput = 'I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion'
& $audioPython tools/distance-listening/long_motion.py --reference $originalListening --source $motionSource --asr-evidence $motionAsr --output $motionOutput
& $audioPython tools/distance-listening/verify.py $motionOutput
& $audioPython tools/distance-listening/verify_long_motion.py $motionOutput
& $audioPython -m unittest discover -s tools/distance-listening -p 'test_*.py' -v
& $audioPython tools/distance-listening/serve.py $motionOutput --port 8769
```

With that server running, run browser verification in another terminal:

```powershell
node tools/distance-listening/browser-check.cjs 'I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion' http://127.0.0.1:8769/
```

`long_motion.py` preserves the original D renderer/HRTF/DVF hashes and records 353 trajectory keyframes. `motion_convolution.py` computes the crossfaded convolution locally while retaining signal history and tails; it changes computation, not the D room preset. `test_long_motion.py` and `test_motion_convolution.py` cover trajectory and convolution behavior. `verify_long_motion.py` checks held endpoints against complete static D convolution and verifies unchanged source text and original code.

The current 37-test suite passed in the session. Artifact evidence: `verification.json` (eight files, max true-peak estimate -5.383748 dBTP, matched error 0.029475753 LU), `motion-verification.json` (original D unchanged, endpoint residuals <1.2e-7), and `browser-verification.json` (actual playback, same-time switching, preset position, transcript, eight metadata loads, download hash, file://, desktop/mobile). `source-asr-evidence.json`, `transcript.txt`, the manifest and original/prepared source WAVs preserve provenance. `desktop.png`, `mobile.png`, `server.stdout.log` and `server.stderr.log` are in the same output directory. Test success is recorded in the session; no separate saved test-log file is claimed. New long-motion listening feedback is still pending.

## Fresh conversational voice with original D (2026-09-14)

The next user request is an actual new local TTS generation with plain conversational Chinese copy, retaining the four D motion paths. `generate_colloquial.py` uses the installed VoxCPM2 profile and local Whisper model, directly calls the product input/pause and safe-cut functions, and records all real attempts, revisions and ASR traces under a separate source directory. It holds the real product native-generation lock, preserves accepted source groups and never adopts anything into the workbench. Use an unused I-drive directory for an independent generation; do not overwrite old listening artifacts.

Design and current verification status: [English](../../docs/superpowers/specs/2026-09-14-d-colloquial-motion.md) / [中文](../../docs/superpowers/specs/2026-09-14-d-colloquial-motion.zh.md).

Once source generation and its final ASR have succeeded, reproduce the spatial output with:

```powershell
$audioPython = 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe'
$newVoiceRoot = 'I:/AI/asmr-director-distance-listening/2026-09-14-colloquial-source'
$newMotionOutput = 'I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion'
& $audioPython tools/distance-listening/long_motion.py --reference 'D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13' --source "$newVoiceRoot/colloquial-final.wav" --asr-evidence "$newVoiceRoot/final-asr.json" --source-metadata "$newMotionOutput/source-metadata.json" --output $newMotionOutput
& $audioPython tools/distance-listening/verify.py $newMotionOutput
& $audioPython tools/distance-listening/verify_long_motion.py $newMotionOutput
& $audioPython tools/distance-listening/serve.py $newMotionOutput --port 8770
```

In another terminal: `node tools/distance-listening/browser-check.cjs <new-motion-output> http://127.0.0.1:8770/`. Source metadata sets `new_generation: true`, the page title/previous-page URL and the real `source_tts.json` path. The renderer requires complete ordered ASR coverage and records source and generation-manifest hashes. Actual source duration determines orbit speed and the final near-distance hold; no fixed 16-clause or 35-second assumption is used for this run.

Completed output: a new 34.54-second source, 22/22 ordered ASR clause coverage (one 露/落 whole-source transcript difference), eight 35.19-second stereo files and 351 keyframes. The 38 numerical tests and all three artifact reports passed; maximum estimated true peak is -5.117646 dBTP, matched error 0.031593 LU and original-D endpoint residual below 1.2e-7. Real playback, synchronized switching, downloads and desktop/mobile screenshots were verified. New listening feedback remains pending; no product project was modified.
