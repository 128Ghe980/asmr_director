# Original D with continuous long-voice motion

Date: 2026-09-14. Existing Audio Quality V1 experiment; no product integration.

The user prefers original D over E/F/G, reporting that E reduces distant echoes/reverberation and weakens spaciousness. Preserve D as the current listening baseline. The requested follow-up uses longer text with continuous orbits, held distances and an approach.

## Source and paths

Reuse the previously selected complete 34.75-second, 48 kHz mono voice file: `I:/AI/voxcpm2-evaluation/listening/longtext-deepseek-class-local-pause-20260904/03_deepseek_class_local_rule.wav`. Its source SHA256 is `0311ca567eecb144c8a93558de4950135dde6833c584d0bbd4ead66de0e9e3e3`. Existing ASR evidence at `I:/AI/voxcpm2-evaluation/evidence/longtext-deepseek-class-local-pause-asr.json` confirms 16/16 clauses in order. No TTS regeneration, repetition, time stretching or changed group pauses. Shared preparation applies original harness edge fades and loudness normalization only.

Four versions share 353 time/angle keyframes: fixed radius 0.18 m, 0.8 m, 1.75 m, and approach from 1.75 m to 0.18 m. Distances are from head center; at the left-side 0.18 m endpoint the modeled ear is about 0.104 m away. Angle progresses 90→450 degrees: left, back, right, front, left. Initial hold is 1.5 s, final angular hold 2.5 s; cosine velocity ramps limit speed to about 13 degrees/s. Approach uses smooth interpolation in log distance from 2 s to 27.105 s, preserving 7.645 s at the near radius.

## Retaining D

Original `render.py` and `near_field.py` hashes are checked against the initial artifact. Every filter is the original `room_ir`: 6×6×2.7 m room, listener (2,2,1.2), six first-order reflections with 0.55 coefficient/6.5 kHz low-pass, synthetic RT60 0.28 s tail with gain coefficient 0.72. No E/F/G room, ear parallax, mouth directionality, FDN or additional guard delay. At 1.75 m the orbit remains inside the room, at least 0.25 m from a horizontal wall.

`motion_convolution.py` evaluates the same complete-convolution output crossfade as the old renderer, computing only active output windows with full input history. Single-pass IR generation avoids retaining the full bank. Keyframe spacing is at most 100 ms. The original nearest measured HRIR lookup remains; this is not continuous measured HRTF data or a complete moving-source wave solver. Original room, missing elevation, calibrated-distance and individualization limitations remain. No Doppler is simulated.

Each output is 35.4 s including the room tail. Natural mode uses one common 0 dB headroom gain across all four; matched mode uses one shared stereo scalar per complete clip at a -25 LUFS target. Within-clip motion and interaural differences remain.

## Delivery and verification

Output: `I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion`; page: `http://127.0.0.1:8769/`. Eight stereo PCM24 WAVs, standalone `index.html`, transcript, source copy and provenance are retained. The page synchronizes speech time across versions and offers collapsed transcript/preset-position displays. Previous 8767/8768 artifacts remain intact. Commands are in `tools/distance-listening/README.md`.

37 numerical tests passed in the session. `verification.json`: eight files, max 4x true-peak estimate -5.383748 dBTP, max matching error 0.029475753 LU, ILD change 1.306728e-7 dB. `motion-verification.json`: original D hashes/source text unchanged, trajectories valid, held endpoints agree with original full static D convolution within 1.2e-7 PCM residual. `browser-verification.json`: playback, synchronized switching, position/transcript, download hash, all metadata, file:// and 1280px/390px checks pass with no errors. Screenshots were visually inspected; server logs are alongside the reports. The new motion listening preference remains pending; Audio Quality V1 and product spatial integration are not marked complete.
