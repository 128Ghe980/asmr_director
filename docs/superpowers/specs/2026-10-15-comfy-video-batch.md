# Video packages and a standalone ComfyUI batch runner

Date: 2026-10-15. Status: user-approved design, initial local implementation and verification complete; real generation-host and browser visual acceptance pending. This extends the existing Audio Quality V1 delivery workflow without creating a new top-level roadmap stage. [Chinese specification](2026-10-15-comfy-video-batch.zh.md), [development evidence](../../records/2026-10-15-audio-quality-v1-comfy-video-batch.md).

## Confirmed behavior

- Export a portable ZIP containing a manifest, per-shot assets, an API workflow and a standalone Python/FFmpeg runner for the user's separate ComfyUI generation host. Do not bundle models or require the Director browser to remain open.
- Export the active short/paragraph workspace in its current displayed shot order. Each speech or non-dialogue item is one shot. Ignore project timestamps, after-speech waits, overall duration and mix scheduling; no inserted waiting, frozen frames or transitions.
- Include exactly one adopted WAV per speech shot. No duplicate raw/processed files, global voice constraints, voice mappings or second audio selection in the runner. Measure the actual file; feed that same audio to H3 and the final video mux. Preserve complete dialogue without voice synthesis or time stretching.
- The batch's character reference is replaceable during export or before execution. The user's `I:/temp/爱哥.JPG` is a test input only; never hardcode or commit the private image.
- Non-dialogue shots remain at user-selected positions and have a final duration greater than zero and at most five seconds. DeepSeek uses scene, current description and both adjacent shots to write a simple visual and natural ambient-noise description. No speech, voice-over or music; no input WAV. Retain H3-generated ambient audio.
- Continuation means sequential tail-frame reference only. Use the immediately preceding successful output's tail as Picture 2 alongside character Picture 1. If the preceding shot failed, use character reference alone; do not borrow an older frame. No quality approval, dependency graph, cascading invalidation or automatic rerender of later shots. The first shot starts independently.
- Attempt the entire batch with bounded technical retries and per-shot error reporting. Persist and reconcile ComfyUI prompt IDs across interruption; never blindly resubmit an unknown request. Users judge results afterward and can rerender individual shots.
- Optionally create an ordered preview only when every shot has a valid successful output. Never omit missing shots, execute project waits or call the model again. Preview encoding may be standardized without changing individual shot files.
- Reuse the Director's configured DeepSeek API for textual preparation. The generation runner executes prepared prompts; credentials never enter the package.

## Workflow and package contract

The actual supplied baseline is `I:/temp/asmr04.json`. Compared with 03, LoadAudio #24 now supplies CreateVideo #11 directly, while remaining H3's audio reference. Keep the model, twenty sampling steps and acceleration parameters. Replace text-concatenation/helper nodes with direct API inputs, use FFmpeg for tail extraction, and default to the original connected 0.8MP landscape setting (1216×672), 24fps.

Speech uses original input audio for the final mux; ambience omits reference audio and muxes decoded generated audio. New/continuous modes combine with either kind. A second reference image and textual instructions do not guarantee an exact hard first frame.

Generate enough supported `17k+5` frames and finish to the desired media duration. The old formula turns five seconds into 124 frames / 5.1667 seconds, so ambient video and audio need synchronized finishing to remain within five seconds. Dialogue remains complete; project waits are irrelevant.

At package root: `project.json`, `workflow_api.json`, `runner.py`, `run.bat`, `README.zh.md`; optionally `references/character.jpg|png|webp`; per-shot directories such as `shots/001/` hold the sole `audio.wav` and optional human-readable `prompt.txt`.

Manifest: `format: "asmr-video-package"`, `version: 1`, `projectId`, `title`, optional `characterReference`, `workflow`, and ordered `shots`. Each shot has `id`, `order`, `kind: "speech" | "ambient"`, `referenceMode: "new" | "continuous"`, `prompt`, `durationSeconds`, plus a relative `audio` path for speech. Additional source metadata is allowed. No credentials, browser URLs, absolute machine paths or running-job state.

Preflight all required shot inputs and identify missing items by shot number; never silently skip a shot. Legacy non-dialogue records stay loadable but must obtain an ambient description; durations over five seconds require explicit adjustment. Validate each shot's own source without propagating predecessor-fingerprint staleness.

## Verification

Cover manifest pairing, one-WAV packaging, workspace isolation, replaceable references, ambient context, stale/cancelled requests, actual WAV bytes/duration, ZIP CRCs, bounded uploads, path confinement and cleanup. Test runner dry runs and a simulated ComfyUI server for routing, submission/history/download, continuation fallback, resume, unknown submissions, individual input changes and the five-second bound. Exercise FFmpeg with synthetic fixtures and the user's test reference locally. Do not claim real H3/remote-host, TTS/ASR or paid DeepSeek acceptance from simulation.
