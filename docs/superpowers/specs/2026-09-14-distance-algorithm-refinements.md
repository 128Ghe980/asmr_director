# Distance algorithm research and D refinements

Date: 2026-09-14. Scope: the existing Audio Quality V1 offline experiment, not a new roadmap gate.

## User direction

The user likes D's room impression and described D as acceptable. This is positive initial feedback, not acceptance of all spatial processing. They clarified that they want additional algorithm families comparable to the earlier Cetera/HRTF/DVF discussion, and also authorized the proposed room and near-ear/source-orientation improvements. HRTF ear-profile selection was not part of this iteration.

## Algorithm alternatives

These are complementary layers, not all substitutes for HRTF:

| Route | Relevance and practical limit | Primary reference |
| --- | --- | --- |
| Measured BRIR convolution | Captures a real room plus two-ear response; arbitrary motion needs multiple positions/orientations and interpolation. A BRIR already contains the direct HRTF, so do not blindly convolve an HRTF into it again. | [BRT listener models](https://grupodiana.github.io/BRT-Documentation/library/listener-models/) |
| ISM + FDN / SDN | Image sources model early paths; FDN creates a dense tail; SDN relates the network to room geometry. BRT SDN supports shoebox rooms, directional sources and nine-band wall absorption. Ordinary FDN is not automatically a geometric SDN. | [SDN paper, 2015](https://arxiv.org/abs/1502.05751), [BRT SDN](https://grupodiana.github.io/BRT-Documentation/library/environment-models/sdn-environment-model/) |
| Parametric RIR reconstruction | Paraspax detects and spatializes direct/early events in one measured mono RIR and extrapolates BRIRs. Directions need geometry, assumed distributions or supplied directions; mono RIR does not uniquely reveal geometry. MATLAB research implementation. | [Paraspax code](https://github.com/facebookresearch/Paraspax), [2021 paper](https://doi.org/10.17743/jaes.2021.0009) |
| Geometric propagation / diffraction | Useful for doors, corners, obstructions and non-rectangular rooms. Requires geometry/materials; does not replace centimeter-scale near-field ear modeling. | [Steam Audio](https://github.com/ValveSoftware/steam-audio), [RoomAcoustiCpp](https://github.com/IoSR-Surrey/RoomAcoustiCpp) |
| Neural binaural rendering | Mono plus source/listener pose becomes learned two-ear audio. WarpNet uses warping/rendering, BinauralGrad uses two-stage diffusion, BinauralFlow uses flow matching and a causal streaming model. Speech benchmarks do not establish whisper/brush/close-ear performance. | [Neural Binaural Speech Synthesis](https://github.com/facebookresearch/BinauralSpeechSynthesis), [BinauralGrad paper](https://arxiv.org/abs/2205.14807), [BinauralFlow ICML 2025](https://proceedings.mlr.press/v267/liang25k.html) |
| Ambisonics + binaural decoding | A useful rotatable representation for many sources and head tracking; not a mono-to-real-distance recovery algorithm. | [IEM Plug-in Suite](https://plugins.iem.at/docs/plugindescriptions/) |

Engineering recommendation: keep near-field direct rendering, compare measured BRIR as a reference, and prioritize a controllable geometric room layer. Treat neural models as an independent listening experiment. BinauralGrad publishes code and two checkpoint links ([official README](https://raw.githubusercontent.com/microsoft/NeuralSpeech/master/BinauralGrad/README.md)); its default inference is memory-heavy but clip length can be reduced. The upstream paired dataset and Meta WarpNet code are noncommercial; code availability is not blanket product/model/data licensing permission. BinauralFlow has a [public listening demo](https://liangsusan-git.github.io/project/binauralflow/), but this research did not confirm public code, downloadable weights or model license. No neural model was installed or run here.

## Implemented listening matrix

The old `2026-09-13` output and port 8767 remain intact. New output: `I:/AI/asmr-director-distance-listening/2026-09-14`, port 8768. The initial render exhausted D: space; only this iteration's incomplete new output was relocated to I: and regenerated. No older assets were deleted.

- D: original room algorithm, rendered on the new scene matrix.
- E: D direct path, second-order ISM (6 first-order + 18 second-order paths), wall-dependent coefficient/low-pass presets, eight-line Householder FDN with loop damping and a low-frequency RT60 design target of 0.24 s. This is a synthetic hybrid, not SDN, a measured room or an exact wave solver.
- F: D's room structure, ear-specific measurement-sphere parallax, onset-aligned HRIR interpolation, center-direction delay restoration, original-direction DVF. Voice directivity affects each ear's direct radiation ray and each reflection's initial emitted ray, with its effect on the late energy. Brushes get no voice radiation filter.
- G: E room plus F source processing.

Two unchanged dry sources, five scenes plus tour, two loudness modes: 96 PCM24 stereo WAVs. Ear/front/far retain the original static geometry. Approach is now 45 degrees left-front, 2.5 to 0.14 m. A fixed 0.35 m source turns 110 degrees away and back. Brush turning is intentionally an unchanged control. Motion uses 41 full-convolution crossfade keyframes, not Doppler simulation.

All methods receive the same fixed interpolation guard delay, including early/late paths. D therefore differs from the earlier static WAVs only by that delay, common headroom gain and PCM rounding. Raw source hashes and prepared dry WAV hashes are checked against the original experiment. Matched static clips use one shared stereo scalar; motion/turn clips match as a whole and retain their internal loudness and ILD changes.

## Model boundaries

Parallax and delay separation follow the structure described in [3D Tune-In 2019](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0211899), with independently written code. Onsets are estimated at 15% of HRIR peak; interpolation is continuous over measured rings, not a perceptually validated individual ear model. Directional spectral phase can still alter waveform peaks. Viking A's lowest measured elevation is -45 degrees; no missing lower-hemisphere measurements are invented. Reflection lookup retains the original nearest measured direction.

Voice radiation is explicitly approximate: frequency-dependent blending between unity low-frequency response and a forward cosine high-frequency pattern; a 1 kHz single-pole transition. FIR coefficients are nonnegative and sum to one, which bounds magnitude by one. This is not the selected speaker's measured mouth/whisper pattern. Per-wall filters and FDN decay are listening presets, not acoustically fitted materials. The FDN late envelope follows aggregate reflected energy; its detailed spatial pattern is not rebuilt from individual wall rays.

No product mixer, project storage, Timeline DSL or old worktree changes. No new TTS, paid provider, head tracking, individualization or fully calibrated distance gain. Improvement is a listening hypothesis, not a declared perceptual winner.

## Verification

Verification passed: 27 numerical tests; all 96 decoded audio files and hashes; maximum 4x oversampled true-peak estimate -2.1000 dBTP; maximum static loudness-match error 0.09761 LU; stereo ILD change below 0.000001 dB. Cross-artifact D checks pass (voice is sample-identical after removing the common guard, brush differs only by a 0.988553 common gain and <1.2e-7 PCM residual). Turning changes the early reflection structure, with a best-scalar-fit relative residual of 0.291/0.303 for the old/new room; brush rotation is exactly unchanged.

Real Edge verification passed playback, method/mode position retention, paused state, all five chapter seeks, all 96 metadata loads, download hash and file:// playback. Desktop 1280px and mobile 390px screenshots were visually inspected; no horizontal overflow or console errors. Evidence is recorded in `verification.json`, `refinement-verification.json`, `browser-verification.json`, `desktop.png` and `mobile.png`. Reproduction commands are in the harness README. New listening preference remains pending.
