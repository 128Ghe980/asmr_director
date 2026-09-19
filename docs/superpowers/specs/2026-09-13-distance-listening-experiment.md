# ASMR distance listening experiment

Date: 2026-09-13. Status: offline artifacts and technical validation complete; user headphone listening acceptance is pending. This is not product integration or a claim that spatial quality has been accepted.

## Authorization and scope

After discussing Cetera, ITD/ILD and distance perception, the user accepted the proposed comparison of one fixed soft voice and brush recording across ear-near, front, far and approaching conditions, including loudness-matched variants. This remains within the approved Audio Quality V1 stage; no new top-level roadmap gate was introduced.

Only `tools/distance-listening/` and supporting documentation were added. The product mixer, Timeline DSL, saved projects, candidate adoption and old dirty worktree are unchanged. No new TTS or paid API request was made.

## Deliverable

Output: `D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13`.
Open `index.html` beside its `audio/` directory, or use the loopback-only service at `http://127.0.0.1:8767/`.

There are 80 stereo PCM24 WAVs at 48 kHz: 2 sources × 4 methods × 5 scenes (four separate conditions plus a tour) × 2 loudness modes. The voice tour lasts 29.5 seconds and the brush tour 47.2 seconds. Order: left ear, front, far, approach; inter-segment gaps are 0.6 seconds.

The page defaults to voice/tour/natural/D-room without autoplay. Method and loudness switches preserve position; source/scene switches restart. Only one audio plays at a time. Chapters seek to actual segment boundaries and each WAV can be downloaded.

## Sources and licenses

- Voice: `I:/AI/voxcpm2-evaluation/runs/restricted-softer-g2-soft_refonly-seed7202-gpu0/output.wav`, 48 kHz mono, 4.96 seconds. Text: “枕头的位置舒服吗？如果不合适，我再轻轻帮你调整。” The user selected this soft-reference take in its 2026-07-30 comparison. Original `result.json` and listening records retain generation provenance. No regeneration occurred.
- Brush: BenDrain, [Paint_Brush_06.wav](https://freesound.org/people/BenDrain/sounds/488027/), CC0 1.0. The downloaded asset is the public HQ MP3 preview, **not the original WAV**. It is 8.5 seconds at 48 kHz with sample-identical channels, so one channel is explicitly selected. Approximately 99.5% of its spectral energy was below 40 Hz. All brush conditions therefore share a single second-order 40 Hz high-pass preparation step to remove rumble and recover headroom. Raw downloads and source JSON remain under output `sources/`.
- HRTF: Viking Dataset v2, subject A; Spagnol, Miccini and Unnthorsson (2020), CC BY 4.0, [DOI 10.5281/zenodo.4160401](https://doi.org/10.5281/zenodo.4160401). Existing local `audio-quality-v1/hrtf/viking/subj_A.sofa` contains 1513 directions × 2 ears × 128 taps at 48 kHz, **measured only at 1 m**. Receiver 0 is the left ear at +y; receiver 1 is right at −y; ear radius is 0.076 m and Data.Delay is zero.

Every condition shares the same prepared source array: sample-rate conversion if necessary, the declared brush high-pass, 12 ms edge fades and source loudness preparation. Source hashes and prepared WAV hashes are recorded in the manifest. Original inputs are unchanged.

## Methods and controls

| Version | Processing |
| --- | --- |
| A | Equal-power pan and distance gain, representing the current approach |
| B | Measured 1 m HRIR, preserving interaural timing and spectral cues |
| C | B plus a rigid-sphere magnitude distance variation filter (DVF), implemented as a 512-tap minimum-phase FIR |
| D | C plus six first-order wall reflections and a short synthetic diffuse tail |

Coordinates are x forward, y left, z up. Ear-near is 0.14 m from the head center (about 6.4 cm from the modeled left ear); front is 0.65 m, far is 2.5 m directly ahead. Approach stays at left 90 degrees and smoothly moves from 2.5 to 0.14 m while the source repeats twice with a 0.3-second gap.

All methods share a bounded creative gain curve anchored at the product's `1.12 / 1.0 / 0.82 / 0.62 / 0.35`, interpolated in log distance. This is not calibrated SPL or exact free-field 1/r attenuation. Movement crossfades complete convolution outputs for 33 positions, preserves tails and adds no Doppler or common propagation delay.

HRIR calibration uses one scalar across all directions and both ears. The DVF independently implements the Duda–Martens rigid-sphere pressure solution, Eqs.7–8, using a stable scaled Hankel recurrence. Target/reference normalized pressure magnitudes form the compensation ratio, so there is no duplicate 1/r gain or extra interaural onset delay. Experimental regularization is 1/6-octave smoothing and a ±12 dB design bound. Minimum-phase equalization still has frequency-dependent phase/group delay.

The room is 6×6×2.7 m with listener `[2,2,1.2]`. First-order image sources use their arrival directions' HRIRs, relative propagation delays, r/L path ratios and amplitude reflection coefficient 0.55. A deterministic diffuse tail has RT60 0.28 s. This is neither a measured BRIR nor a full room solver.

Natural mode uses one headroom scalar for the entire set of each source, without a limiter. Matched mode applies one scalar equally to both ears of each static clip: voice target −25 LUFS; brush target approximately −27.79 LUFS to preserve transients with −2 dBTP headroom. An approach clip is matched as a whole, retaining its internal loudness motion. The matched tour concatenates the separately matched clips without further normalization. It removes static overall loudness differences but does not isolate non-level cues to approach motion.

## Verification

- 13 tests pass: an independent SciPy spherical Bessel/Hankel reference, zero-frequency closed form, reference-radius identity, mirror symmetry, low-frequency distance trend, a 60-case finite/bounded spectrum sweep, FIR response, crossfade continuity and full tail retention.
- At this geometry, additional 125 Hz ILD at 1 / 0.7 / 0.3 / 0.14 m is about 0 / 0.85 / 4.72 / 13.42 dB. These are model measurements, not perceptual results.
- All 80 assets pass independent decoding, format, SHA256, finiteness and clipping checks. Maximum 4× oversampled true-peak estimate is approximately −2.00 dBTP. Maximum matching error is 0.059 LU; ILD changes through matching are below 0.000001 dB.
- Direct/reflected impulse-energy ratio is 36.47 / 14.12 / 4.33 dB at ear/front/far.
- Browser verification passes actual playback, synchronized switching, paused state, one-at-a-time playback, chapter seeking, all 80 metadata loads, download hash, file:// playback and 1280px/390px layout checks with no final console errors. Screenshots were visually inspected.
- Python's ordinary file server prevented WAV seeking. The added loopback `serve.py` supports byte ranges; HTTP 206 and exact requested byte length were verified.

Evidence: output `manifest.json`, `verification.json`, `browser-verification.json`, `desktop.png`, `mobile.png`. Reproduction commands and host dependency paths are in `tools/distance-listening/README.md`.

## Boundaries and listening feedback

No individualized HRTF, ear parallax, mouth directivity, head tracking or measured near-field/room data is claimed for this first experiment. Subject A's externalization and distance effects may vary by listener. Subsequent feedback described the added room as good and D as acceptable; this is positive initial feedback, not complete spatial acceptance. The authorized refinements are recorded in `2026-09-14-distance-algorithm-refinements.md` and its Chinese counterpart. Product spatial integration and broad real-SFX coverage remain unfinished.

Suggested evaluation: compare B/C for ear-near in matched mode; compare C/D for front/far room distance; assess whether the approach has unnatural timbre or transitions.

References: [Duda & Martens (1998)](https://doi.org/10.1121/1.423886), [Brungart & Rabinowitz (1999)](https://pubmed.ncbi.nlm.nih.gov/10489704/), [Spagnol et al. (2017)](https://research.unipd.it/handle/11577/3199763), [3D Tune-In Toolkit (2019)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0211899). No 3D Tune-In implementation code was copied.
