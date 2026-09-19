# D motion with newly generated conversational copy

Date: 2026-09-14. This remains an offline Audio Quality V1 listening experiment; workbench projects are unchanged.

The user requested a fresh version with new, plain conversational Chinese copy. This run actually regenerates VoxCPM2 speech. It retains the original D room and four movement paths, preserving the previous 8769 artifact.

## Source

Six manually defined semantic groups describe ordinary bedtime companionship: adjusting the pillow and blanket, putting the phone aside, resting after a busy day, breathing comfortably and sleeping when ready. The exact Chinese text is in the paired Chinese specification and generated `transcript.txt`. No text API is used.

The existing soft Chinese reference is retained. Nonfinal groups use the selected long-opening recipe: current group, remaining text and required fixed neutral padding, followed by safe extraction of the target opening. The last group is generated as a genuine ending. The harness directly reuses product long-text input construction, class-local pause selection and ASR safe extraction. Assembly adds only missing silence between groups, preserves internal rhythm and applies one final active-RMS gain. Models, generation and ASR are local; all generated artifacts and logs are on I:.

## Spatial rendering and delivery

The same new dry voice feeds four synchronized paths: fixed head-center distances of 0.18 m, 0.8 m and 1.75 m, and a spiral from 1.75 m to 0.18 m. Each makes one left→back→right→front→left orbit. Timing uses actual source duration, with an initial 1.5-second angular hold and final 2.5-second angular hold; the spiral remains near for the final 22% of the source.

Original D `render.py` and `near_field.py` must match the initial manifest hashes. Optional `--source-metadata` now distinguishes newly synthesized sources from reused recordings. Clause count, duration, provenance copy and near-hold time derive from actual artifacts. Switching treatment or loudness mode preserves sentence time; the expanded page instructions now distinguish that from source/scene changes, which restart playback.

Source output: `I:/AI/asmr-director-distance-listening/2026-09-14-colloquial-source`. Spatial output: `I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`, port 8770. Previous ports 8767–8769 remain available.

## Verification status

Subsequent user decision on 2026-09-14: the user found this version acceptable and explicitly requested original-D production integration, recording and push. The sample is no longer awaiting listening feedback. Product work and its separate verification are recorded in `2026-09-14-spatial-d-product-integration.md`; the experiment-only boundaries below describe the state when this sample was created.

The new source is 34.54 seconds of 48 kHz mono PCM16, SHA256 `d6daed879942bc92c4c6d041bc45cf74eac54ea226c05185e566a4bb48ddaabc`. All six extracted groups have ASR coverage 1.0. Final independent ASR covers 22/22 clauses in order without unexpected repeats; content similarity is 0.992647. The whole-source transcript substitutes 落 for 露 once, while the corresponding extracted-group ASR has the correct 露. This is not described as a character-perfect whole-source transcript. Actual joins are 360/400/350/300/350 ms.

`source_tts.json` retains all 13 attempts: six accepted, four rejected by ASR/safe extraction, and three native technical failures without WAV output. The first two reported cuBLAS initialization errors; the third exited after prefill. Generation recovered after moving this run's CUDA cache to I:, without establishing cache location as the sole cause. Technical failures do not consume content retries. Models, reference mode and product ASR checks were retained. Two copy revisions preserve earlier plan/manifest snapshots; old full inputs remain only as historical context for retained groups. Generation manifest SHA256: `680d308dcd1391b784e1b9364f17f70575c2586dde1621e2e87c2721e5fa2a73`; final ASR SHA256: `f85e4dc2a3d18372cebe7799fb46e78f4b133dfff217d939e9a060ef58c9c925`. The generation lock was released.

All 38 numerical tests passed. The output contains eight 35.19-second, 48 kHz stereo PCM24 WAVs and 351 trajectory keyframes, with a -25 LUFS matching target. `verification.json` reports maximum estimated true peak -5.117646 dBTP, loudness error 0.031593 LU and ILD change 2.112757e-8 dB; source and output hashes pass. `motion-verification.json` confirms unchanged original D code, valid trajectories and held-endpoint residuals below 1.2e-7 against full static D convolution. Approach finishes at 26.9412 seconds, followed by a 7.5988-second near hold.

`browser-verification.json` passes actual playback, synchronized switching, paused behavior, all eight durations, preset position/transcript, download hash, file:// and 1280px/390px overflow checks, with no errors. Both screenshots were inspected. The server is running at `http://127.0.0.1:8770/`, and opening it in Codex was requested. Reproduction commands are in `tools/distance-listening/README.md`. These checks do not establish user listening acceptance of the new voice or completion of Audio Quality V1/product spatial integration.
