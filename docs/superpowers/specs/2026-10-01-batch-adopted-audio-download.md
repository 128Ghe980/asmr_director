# Batch download of adopted audio

Date: 2026-10-01. This extends the existing project export workflow within Audio Quality V1, without adding a roadmap stage. [中文版](2026-10-01-batch-adopted-audio-download.zh.md).

Latest interface extension (2026-10-03): the same **批量下载** entry now offers **音频 / 分镜** tabs. Audio retains the package and processing behavior below; storyboard export writes one existing usable H3 prompt per dialogue to a separate TXT ZIP, retaining original paragraph numbering. See the [storyboard status and batch TXT spec](2026-10-03-storyboard-status-and-batch-txt.md) and [development record](../../records/2026-10-03-audio-quality-v1-storyboard-status-export.md). Both export kinds use the native token download flow documented in the later transport-recovery section.

## Scope and package

The user requested one attractive batch-download entry that collects all generated and adopted audio into one folder, separated into untreated and post-processed versions.

The export snapshots the current project. It selects only current timeline clips with `generation.status: asset_generated` and a consistent local `asset://clip/<asset_id>` reference. Voice, breath, SFX and ambience clips may participate. Unadopted candidates, complete generation-window recordings, historical revisions and the full-project mix are excluded. Downloading does not generate or adopt audio or alter the project.

One ZIP contains a sanitized project-title directory with `无后处理/`, `后处理/` and `导出清单.json`. Clips are numbered in timeline-start order; both versions use the same numbered WAV filename. Chinese names use UTF-8. Project titles and clip labels cannot create nested paths, traversal or Windows reserved filenames. The manifest maps clip/asset IDs to both paths and records source settings, processing mode, spatial status and processed duration.

## Audio behavior

`无后处理` copies the complete adopted WAV byte for byte. It means the current adopted asset, which may already be an extracted candidate; it does not silently substitute an earlier full generation window.

`后处理` uses the existing clip-processing pipeline and current volume/fades/position. It exports the complete source duration, without timeline-based truncation, loop repetition, leading project silence or the next clip's waiting gap. It produces a standalone 48 kHz stereo PCM16 WAV. Project master loudness normalization and full-mix limiting do not apply per clip.

When global binaural processing is enabled, mono voice uses the accepted original D distance, room and movement implementation and preserves its full 650 ms room tail. Volume follows spatial processing; existing D fade handling is retained. If D returns an unprocessed mono fallback, the package fails with a readable error rather than presenting it as a finished spatial version. Existing stereo source preserves its two channels and receives ordinary gain/fades; the manifest identifies it as a stereo source rather than claiming newly rendered surround. Nonvoice clips and voice with global binaural processing disabled use the existing applicable PCM gain/fades/pan/distance/movement processing.

## Interface and delivery

The project header has a restrained green download entry and adopted count. Its compact popover previews the two folders, explains the current spatial switch, and includes empty, preparing, cancellation, retryable error and download-started states. It preserves the one-screen workspace; small screens use an accessible icon entry, viewport-bounded popover and internal scrolling. Escape, outside click, keyboard focus and screen-reader labels remain usable.

`POST /api/assets/batch-download` validates the project and prepares the complete temporary ZIP before returning a stream, so missing assets or processing failures remain readable JSON errors. Processing is sequential by clip; original bytes stream into a stored ZIP. One package preparation runs at a time per server process. Limits are 2,000 clips, 128 MiB per source, 10 minutes per clip and a 1 GiB archive. Cancellation propagates to asset reads and spatial processing; failed/canceled packages and completed response streams clean up only their generated temporary directory. New scratch follows the existing I-drive spatial-cache configuration, with optional `ASMR_BATCH_DOWNLOAD_TEMP_ROOT` override.

The UI now sends `Accept: application/json`: POST returns `{ downloadUrl, filename, clipCount, size }`, and the browser downloads the ZIP through `GET /api/assets/batch-download?token=<UUID>` without reading binary data into a JavaScript Blob. Default POST still returns the original ZIP/attachment response. Tokens are opaque, process-local and single-use, expire after five minutes and retain at most two ready archives; no file path is exposed or accepted. GET claims before streaming, opens/stats the file before headers, applies 64 KiB byte backpressure and releases its owned archive once. Failed/abandoned/canceled downloads clean up; restarting invalidates ready links. Existing folder/audio behavior remains unchanged.

## 2026-10-02 transport fix — verified

The server prepared/read the entire 10-clip, 20,982,790-byte ZIP while the IAB binary fetch failed; removing only the attachment header did not resolve it. No specific browser-internal size limit was established. JSON preparation followed by native GET succeeds. The actual browser-saved ZIP has 21 entries and passes every CRC, raw-source SHA and processed PCM/full-duration check. An independent 20-clip fixture reuses one existing asset and verifies a 21,015,839-byte/41-entry package. Two targeted files/27 tests, owned-file ESLint, full TypeScript and production build pass; 138 asset hashes and visible dialogue/timeline are unchanged. No synthesis or user candidate changes. Evidence: `I:/AI/asmr-director-batch-download-recovery/2026-10-02`; see [bug record](../../records/2026-10-02-audio-quality-v1-batch-download-recovery.md) and [latest runtime](../../AI_HANDOFF.md). No commit/push.

## Historical 2026-10-01 verification

Implementation, automated checks, real API download and production-browser verification are complete. Evidence root: `I:/AI/asmr-director-batch-download/2026-10-01`. Full Vitest passes 72 files / 755 tests, with one existing opt-in file/test skipped. Targeted UI passes 3 files / 24 tests, including 6 new download-component tests; targeted backend passes 5 files / 35 tests, including existing mix-DSP tests. Full TypeScript, ESLint and the production Webpack build pass. The final ESLint rerun after adding the new build-directory ignores also passes. Independent backend read review found no required fix.

Automated cases cover filtering/order/safe names, UTF-8 ZIP/CRC/raw bytes, full source duration, injected D tail/fades, disabled/stereo/mono-fallback paths, missing/malformed assets, API validation/concurrency/cancellation and temporary cleanup. Logs: `tests.log`, `lint.log`, `build.log`. The verified build is `.next-batch-production` on D:, with only its cache junction directed to I:. Production is 3001 / PID 4380 / HTTP 200.

An actual single-clip POST reused the current project's adopted first asset without new TTS. `live-api.zip` is 1,051,540 bytes; Python's standard `zipfile` validates every CRC and the Chinese paired directories/manifest. The raw 3.21-second entry is byte-identical before and after download, SHA-256 `9a40366cee0423a10cf252a71954b2c3f4648d5bf1ef9279897f7ecf07cf1e3f`. Real original-D processing yields 3.86 seconds, 48 kHz stereo, `spatialized: true`, preserving the 650 ms tail. Details: `live-api-verification.json`.

Production browser reload preserves all 15 unit texts exactly and shows 9 adopted clips. Clicking the batch action reaches the download-started success message. The browser download-event tool did not provide a saved-file path, so the nine-clip browser package was not reopened or inspected; package/audio claims above refer to the independently saved live API ZIP. The 1768×1252 desktop view was visually inspected. At 390×844 and 320×740, document dimensions equal the viewport and the popover stays inside it (390px: x=14–382, y=72–448; 320px: x=8–312, y=72–468), without horizontal overflow. Escape hides the popover and restores trigger focus. No browser console errors/warnings. Screenshots were inspected through the tool, not saved as evidence image files. No project/adoption changes, commit, push or new listening-quality acceptance.
