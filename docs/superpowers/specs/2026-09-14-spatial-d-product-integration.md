# Original D spatial audio: product integration

Date: 2026-09-14; closeout: 2026-09-20. Stage: Audio Quality V1. Companion: [中文版本](2026-09-14-spatial-d-product-integration.zh.md).

## Decision and completion boundary

After listening to the newly generated conversational voice at port 8770, the user said “ok，我觉得还行” and authorized integrating that D sound into normal generation, recording the work and pushing it. **Original D is now the adopted spatial recipe for this product slice.** The earlier preference for D over E/F/G stands; E/F/G are not incorporated.

This completes product integration of the adopted D recipe and its four reference paths, with verification below. It does not complete Audio Quality V1, the real ASMR SFX work, vertical orbits, personalized HRTFs, source directivity, or every previously proposed director action.

## User-visible behavior and asset ownership

`timeline.mixing.binaural` controls D processing for local **mono voice** assets in the selected-clip preview, current/adopted voice preview, complete candidate preview, and full-project mix. Disabling it plays the original clip/candidate source and retains the previous ordinary-stereo mix path. Non-voice sources retain their existing path. Detailed long-text **individual-group previews remain dry**, so generation/extraction can still be checked directly.

TTS continues to save the original `asset://clip/<assetId>` WAV. Candidate adoption, undo, duration fitting and provenance continue to reference that dry asset. D audio is a disposable derived cache, never a replacement TTS asset. Changing distance or movement reuses an already-generated voice and only changes spatial rendering and mix freshness. Existing edit handling may still cancel an in-flight TTS request; this integration does not promise uninterrupted generation while editing.

Complete candidates use their actual source duration in preview, rather than the pre-adoption timeline slot. Adopted clips use the current clip duration. No room tail is added to the voice asset duration or used to shift subsequent spoken content. Already-stereo assets pass through the spatial helper byte-for-byte with `spatialized: false`; they are not downmixed or spatialized again. Existing stereo mix handling continues to preserve channel cues.

## Adopted paths and compatible controls

Distances below are measured from the **head center**, not the ear surface. They are creative controls in a generic acoustic model, not calibrated physical measurements for each listener.

| 8770 reference | Product controls | Path |
| --- | --- | --- |
| Near orbit | `movement: orbit`, `distance: very_close` | One horizontal orbit at 0.18 m |
| Middle orbit | `movement: orbit`, `distance: mid` | One horizontal orbit at 0.8 m |
| Far orbit | `movement: orbit`, `distance: far` | One horizontal orbit at 1.75 m |
| Spiral approach | `movement: orbit_approach` | One horizontal orbit while approaching from 1.75 m to 0.18 m |

The fixed distance anchors are `very_close=.18`, `close=.35`, `near=.5`, `mid=.8`, `far=1.75` meters. Orbit runs left → back → right → front → left, using an unwrapped 90°→450° angle. Orbit has a fixed left starting point; its pan control does not change that path. `orbit_approach` also owns its fixed distance endpoints.

For sources at least 12 seconds long, angular motion holds for the first 1.5 seconds and final 2.5 seconds; the first/last 10% of the moving interval uses smooth angular-speed ramps. Approach begins at 2 seconds and completes at 78% of source duration, leaving the final 22% near. Radius follows a smooth interpolation in log distance. Shorter sources proportionally shorten the holds and increase temporal sampling; there is no fixed 35-second source assumption.

Existing controls remain usable: `static` maps pan to azimuth `-90 × pan`; `left_to_right` and `right_to_left` cross the front hemisphere between ±90° at the selected radius. `approach` travels from 1.75 m to the selected radius and `recede` reverses it at the selected pan. Choosing `far` for either yields equal radius endpoints. With binaural disabled, movement uses the previous pan/gain renderer; its orbit fallback is ordinary stereo and does not claim front/back spatial positioning. Vertical motion is outside this slice.

## Processing contract

The product owns an extracted original-D implementation under `apps/web/scripts/spatial_d/`; it does not import the experimental harness at runtime. It retains Viking A measured HRIRs, the regularized rigid-sphere DVF, the original 6×6×2.7 m synthetic room with listener at (2,2,1.2), six first-order wall reflections, and the deterministic diffuse tail. Reflection coefficient .55, 6.5 kHz reflection low-pass, .28 s tail RT60 and .72 diffuse coefficient remain original D. These parameters are a listening recipe, not measured room-material properties. No E/F/G, FDN, ear-parallax correction or mouth radiation model is added.

Processing order is:

1. Read an immutable snapshot of the dry mono WAV. Accept 32/44.1/48 kHz and resample to 48 kHz; trim to the requested dry duration when supplied, without looping or extending the speech.
2. Apply the accepted source preparation: up to 12 ms sine-squared edge fades, then one source loudness gain targeting −27 LUFS. Short-source loudness measurement may be zero-padded, but the audible source is not extended. Silence remains silence.
3. Apply user fade-in/fade-out to the dry source **before** convolution, allowing the room decay to continue after the speech fades.
4. Render original D along the chosen path. Moving output crossfades complete convolution responses, preserving input history and reflection tails; this is not Doppler simulation. Static rendering retains the original direction lookup.
5. Retain the complete additional **0.65-second** room response, including the reference's final 15 ms tail fade. Write 48 kHz stereo PCM24. A common gain is applied only if needed to keep the renderer's 4× estimated true peak below its −2.1 dBTP ceiling; all four reference regressions require no such attenuation.
6. Mix using explicit `spatialized` metadata. D results bypass the old pan, distance gain and user fades. Clip `volume_db` is applied once in the mixer. A spatial tail may overlap later clips and may extend the exported WAV beyond `project.duration`; saved mix duration is measured from the actual output. The mix remains stereo PCM16 at the requested rate, normally 48 kHz.

For a mix containing D, the old upward `target_lufs` normalization is skipped. Raising each near/far render toward a separate output target would erase or even reverse the recipe's natural level difference; the product retains that difference. If the master limiter is enabled and the complete mix exceeds −2.1 dBFS, one shared attenuation is applied to the entire mix across both ears. It never boosts a quieter D mix. This ceiling is a **sample-peak** control, distinct from the Python renderer's oversampled estimate. Non-D mixes retain their previous normalization/limiter behavior. The offline −25 LUFS matched-comparison tracks are not the product's default spatial source.

`d-room-v1` is included in binaural project-mix fingerprints. Previously generated binaural exports remain playable/downloadable but become stale and require remixing. Position, timing, fades, volume, adopted assets and the binaural setting remain part of mix freshness. The derived cache additionally hashes actual source, HRTF and Python source bytes. HRTF/runtime overrides are server settings; changing them invalidates spatial cache entries, while existing exported mixes are immutable files and must be explicitly remixed.

## Service, configuration and operational boundaries

`renderSpatialClip({ assetId, position, durationSeconds?, fadeInSeconds?, fadeOutSeconds?, config, signal? })` returns `{ wav, spatialized }`. The shared helper serves both preview and mix. `GET /api/assets/spatial/<assetId>` accepts only `position` JSON plus optional `duration`, `fadeIn` and `fadeOut`; it rejects arbitrary paths and unknown/duplicate query keys. It returns WAV bytes with byte-range/If-Range seeking support, or a structured JSON error. Raw clip and saved mix routes retain their existing ownership.

All defaults below are relative to `ASMR_DIRECTOR_RUNTIME_ROOT`, which defaults on this host to `D:/CodexWorkplace/asmr_director_runtime`.

| Environment variable | Default |
| --- | --- |
| `ASMR_SPATIAL_PYTHON` | `audio-quality-v1/.venv/Scripts/python.exe` |
| `ASMR_SPATIAL_HRTF` | `audio-quality-v1/hrtf/viking/subj_A.sofa` |
| `ASMR_SPATIAL_CACHE_ROOT` | `assets/spatial` |

Python requires NumPy, SciPy, SoundFile, h5py and pyloudnorm. The installed environment/HRTF can be reused; binaries, Python packages, SOFA and generated audio remain external to the repository. This host uses I: for new verification artifacts because D: is short of space; cache location must be set explicitly when launching the workbench on I:.

`ASMR_NEXT_DIST_DIR` optionally changes the Next build directory, default `.next`. Use a directory within `apps/web` where generated modules can still resolve the project's `node_modules`. This is separate from `ASMR_SPATIAL_CACHE_ROOT`: the spatial cache can live on another drive. For low-disk operation, only a build directory's cache subdirectory may be moved externally while compiled server/static/type outputs remain in the project; setting the entire build output to an unrelated external directory is not the supported setup. Usage examples are in `apps/web/README.md` and `.env.example`.

The CLI uses a server-created request JSON file and argument arrays with `shell: false` and hidden windows. Child `TEMP`, `TMP` and `TMPDIR` point to that render's directory on the configured cache volume, while other environment values are inherited and the parent environment is unchanged. Requests are limited to 600 seconds; input/output byte caps and a five-minute process timeout bound the work. One render runs per Node process, with at most eight queued requests. This is a process-local gate, not a cross-host or distributed lock. Duplicate queued work rechecks the successful cache before starting another child.

Cache identity includes the dry WAV SHA256, renderer version, all Python source bytes, HRTF SHA256, position, trim duration, fades and preparation mode. Only complete stereo/48 kHz output with matching duration/metadata is atomically published. The service rechecks HRTF/code identity before publication. Failed or cancelled partial output is not cached, and original clip assets are never rewritten. A fully completed cache entry may legitimately survive a cancellation that arrives after atomic publication.

Abort signals flow through preview requests and the project-mix bridge/API to the renderer. Cancelling a queued job leaves another job's process alone; cancelling an active render or timing out kills its child. The slot and temporary directory remain held until exit is confirmed, including the exceptional case where termination is delayed. Browser pause alone does not guarantee a network abort; source disposal, project/job cancellation and server request abort are the relevant boundaries. Existing stale-result checks protect adopted assets and mix state. An already completed immutable file is not deleted merely because a late result is ignored.

## Data provenance and license

HRTF: **Viking HRTF Dataset v2**, Spagnol, Miccini and Unnthorsson (2020), [DOI 10.5281/zenodo.4160401](https://doi.org/10.5281/zenodo.4160401), licensed **CC BY 4.0**, as recorded in the original experiment and product renderer README. Subject A contains 1,513 directions × two ears × 128 taps at 48 kHz, measured at 1 m. Attribution and license information must accompany redistribution of the dataset or its adaptations; the SOFA itself is not committed in this slice.

Distances closer than 1 m use a modeled DVF and this generic head profile; they are not additional measured near-field HRTFs. The synthetic room is not an individually measured BRIR. Voice/reference permissions remain independent of the HRTF license and existing TTS runtime/model terms. This record adds no new model-license claim.

## Verification record

Renderer and component checkpoints:

- **26 Python tests passed**, covering the extracted renderer and trajectory/source/output boundaries. Log: `I:/AI/asmr-director-distance-listening/product-d-verification/unit-tests.txt`.
- Full regression against the four **natural**, complete 8770 WAVs passed: source preparation error 0, seven static IR regressions error 0, and all four 35.19-second output WAVs have identical PCM and SHA256 to their references. Per-render elapsed time was 6.506–7.286 seconds. Report: `I:/AI/asmr-director-distance-listening/product-d-verification/regression-01/verification.json`; accepted reference root: `I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`.
- **16 targeted service/config/API tests passed**, including cache invalidation, duplicate request reuse, queued/active cancellation, timeout/retry, dependency errors, invalid/partial output rejection and HTTP range handling.
- The subsequent child-temporary-directory fix added one regression test; the updated **11-test spatial service file passed**. This overlaps the earlier service/config/API checkpoint and is not an additional 11 independent tests.
- **20 targeted PCM/mixer tests passed** after removing upward normalization for D. A probe using the actual TypeScript mixer and decoder with the 8770 near/far WAVs preserved the natural near-minus-far RMS difference: 7.367683 dB at input and 7.367684 dB after PCM16 export; both outputs retained 35.19 seconds. The probe uses direct test getters for project validation/clip collection, so it is not a workbench end-to-end result. Report: `I:/AI/asmr-director-distance-listening/product-d-verification/mix-natural-distance-probe.json`.
- **One opt-in real TypeScript→Python integration test passed**: a 0.75-second source with user fades becomes a 1.4-second PCM24 stereo output with a nonzero tail; repeated request bytes match and the original source is unchanged. Its fixture is synthetic, so it establishes the executable contract, not speech quality. Enable with `ASMR_SPATIAL_REAL_TEST=1`; `ASMR_SPATIAL_TEST_ROOT` selects an external temporary directory. The test is skipped in ordinary unit runs unless explicitly enabled.
- Targeted ESLint and `tsc --noEmit --incremental false` passed for the service integration checkpoint. These are not substitutes for the full final repository checks.

Reproduction commands from the repository root:

```powershell
& 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe' -B -m unittest discover -s apps/web/scripts/spatial_d -p 'test_*.py' -v
& 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe' -B apps/web/scripts/spatial_d/verify.py --reference 'I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion' --output '<new-external-evidence-directory>'
npm.cmd test --prefix apps/web -- --run src/lib/asmr/spatial-audio.test.ts src/lib/asmr/local-runtime-config.test.ts 'src/app/api/assets/spatial/[assetId]/route.test.ts'
```

### Real workbench result

`I:/AI/asmr-director-spatial-integration/2026-09-14/browser-verification.json` reports **passed**. A new local VoxCPM2 generation produced candidate `vox_e6a0c0f669c3490084374081dbcda150`, dry asset `voice_spatial_qa_20260913T224039219Z_1a33113d`, 4.8 seconds at 48 kHz. `generation-response.json` and `native-1789339239605.log` establish the new native generation; the native process exited 0 and reported 230,400 samples. This is a new product-generation sample, not reused 8770 audio.

The browser verification ran in **two phases**. After successful new TTS, the initial automation stopped at an overly exact distance-selector match. `workbench-resume.cjs` resumed using that same newly generated candidate. The final report explicitly records `nativeGenerationVerifiedInPriorPhase: 1` and `nativeCalls: 0` in the resumed phase. It is not presented as one uninterrupted automation run.

Verified operations were actual candidate spatial playback; adoption, reload, undo and re-adoption; distance and orbit edits retaining the same dry asset; source-URL switching between D and original voice through the binaural toggle; and no additional TTS call during those edits. The real project mix is **5.45 seconds**, preserving the full 0.65-second room tail after the 4.8-second source. An actual browser WAV download matches the mix endpoint bytes, the saved mix persists after reload, and the 1400px/390px layouts have no horizontal overflow. The report records `errors: []`. Evidence includes `adopted-project.json`, `final-project.json`, `fresh-candidate-spatial.wav`, `fresh-project-mix.wav`, `downloaded-mix.wav` and `mix-response.json` in the same directory.

Recovery boundaries: an early automation attempt ran before the voice catalog was ready and hit the GPT service with a 502; another native VoxCPM2 attempt failed with GPU memory exhaustion. A spatial preview also returned 500 while C: was full; its exact cause was not established. After the user closed browsers and resources recovered, the same voice profile generated successfully. Separately, the previously failing 20.57-second candidate rendered successfully to 21.22 seconds with temporary paths on I:, recorded under `candidate-failure-probe-01`. Routing child temporary files to the cache volume is a robustness fix, **not a proven diagnosis of that 500**. These events establish recoverability on this machine, not resource-independent operation.

**Verification boundary:** this round did not repeat a real browser cancellation run; queued/active cancellation and timeout behavior are covered by automated tests. User adoption of original D and the successful real workbench workflow are established; neither is a pending listening decision.

### Final checks and recovery on 2026-09-20

The account limit interrupted closeout. Retained logs confirmed **57 Vitest files / 520 tests passed**, including the enabled real Python adapter (`2026-09-14/full-tests-final.log`). The production Webpack build, including TypeScript, passed (`2026-09-14/build.log`); the known Windows native SWC warning fell back to WASM. Product audio code did not change after these checks.

The remaining ESLint failure came from scanning generated `.next-spatial` and `.next-spatial-build` files. Those outputs are now excluded in `eslint.config.mjs`; full ESLint passed on September 20 (`2026-09-20/lint.log`). An independent read-only review found no blocking integration issues. `git diff --check` passed.

The production build at `http://127.0.0.1:3001/` passed another real browser check using the September 14 candidate, with **zero new TTS calls**. Candidate/current playback and seeking, adoption/undo/re-adoption, parameter edits, binaural switching, real remix, byte-matched WAV download, persisted reload and 1400px/390px layouts passed without browser errors. Screenshots were captured after the voice catalog loaded and visually inspected. Source and mix remain 4.8 and 5.45 seconds. Evidence: `I:/AI/asmr-director-spatial-integration/2026-09-20/browser-verification.json`, `desktop.png`, `mobile.png`, and `production-check.cjs`.

New verification output and temporary files use `I:/AI/asmr-director-spatial-integration/2026-09-20`; spatial cache uses `I:/AI/asmr-director-spatial-cache`. Existing C:/D: assets were not deleted or bulk-migrated. Large Next cache subdirectories point to I:, while compiled outputs remain beside project dependencies. Delivery branch: `codex/voxcpm2-product-generation`; this record accompanies the implementation and experiment reproduction tools. Audio Quality V1 remains in progress within the original roadmap.
