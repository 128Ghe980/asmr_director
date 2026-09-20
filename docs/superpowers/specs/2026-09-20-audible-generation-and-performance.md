# Audible originals and generation performance

Date: 2026-09-20. Part of Audio Quality V1, with no new roadmap stage.

## User decision

Checks must not prevent audio delivery. Every complete original must be available for listening and download, while normal grouped extraction and assembly remain. This explicitly supersedes the earlier policy of retrying failed checks three times and withholding the candidate.

## Behavior

Native output is published atomically before quality decisions. A separate original-recordings panel polls during generation and supports refresh, downloads and stable cursor pagination. It does not depend on candidate success. Range responses and downloads preserve the exact source bytes. Current recordings match project, clip and text; legacy recordings require the same complete text and are labeled as historical matches. Whitespace at the text edges is ignored.

Each group receives one TTS call. Verified groups retain normal extraction. Failed or unavailable analysis instead retains the full source, marks the group for review, and continues. The assembled candidate warns that these sources can include continuation text, padding or repetitions. User adoption remains explicit. Review metadata does not invent ASR measurements.

Silent and step-limited valid WAVs are delivered with warnings. Malformed bytes remain downloadable without being treated as valid candidates. Cancellation, native failure or disk failure may stop remaining work, but already published originals stay available. A native process exiting after its wait deadline still publishes its stable output; unconfirmed live output is not read prematurely.

VoxCPM2 sampling settings and original-D rendering are unchanged.

## Scheduling

Planning overlaps environment readiness; one session shares its readiness promise, including when the first TTS exceeds the old 30-second cache TTL. Failed quality checks no longer trigger two additional random TTS/ASR attempts.

`ASMR_VOICE_PIPELINE=auto|serial|overlap` permits at most one TTS and one ASR at a time, with one group of lookahead. Automatic overlap requires at least 8 GiB free RAM and eight available logical CPUs. ASR requests remain ordered.

`ASMR_VOICE_ASR_REUSE=auto|off|always` controls a single per-task CPU/int8 Whisper worker. Automatic reuse needs 8 GiB free RAM and releases the worker below 6 GiB after a group. All active child PIDs are tracked; the runtime reservation is released only after confirmed exits. Duplicate no-PID error/close callbacks cannot unregister another live child.

A real worker loaded its model once in 9.55 seconds, then checked the same 22.72-second recording in 51.66 and 40.27 seconds. Both results remained `cut_text_mismatch`. Peak RSS was 3.455 GiB and free memory fell to 0.483 GiB, so this machine defaults to serial execution without model residency. These consecutive requests are not a controlled speedup benchmark.

`ASMR_VOICE_WORK_ROOT=I:/AI/asmr-director-voice-work` holds new scratch files and originals. Legacy D-drive recordings remain readable; no files were moved or deleted. Locks remain in the original runtime for shared exclusion.

## Evidence

Evidence root: `I:/AI/asmr-director-audible-generation/2026-09-20`.

- Historical recovery found nine same-text originals. The selected previous failed run's 20.16/24.48/22.72-second recordings are byte-identical by SHA256. Latest listing took about 45 ms.
- Real two-group generation, with only the plan fixed: 141.086 seconds, two native TTS calls, two ASR calls, two originals, zero automatic retries. Both groups failed checks, yet a complete 34.91-second candidate was returned and the runtime lock released.
- The first 31.52-second original was listable at 32.593 seconds, before ASR completion; the second 3.04-second original appeared at 116.460 seconds. Both retained group assets match their original bytes exactly. Assembly contains both full groups plus 350 ms silence; whole-result gain error is below `2/32767`.
- This verifies delivery despite failed checks, not correct speech or listening acceptance. The real sample precedes the final readiness deduplication; that small follow-up has separate cross-TTL regression coverage.
- Tests cover advisory failures, cancellation/late exits, original preservation, process locks, bounded overlap, schema compatibility, paging and path containment. Final build/browser evidence is recorded in the same-date project archive.
- Final checks passed: 58 Vitest files / 579 tests, 27 Python tests, ESLint, TypeScript and the Webpack production build; one unchanged opt-in spatial integration test was skipped. Port 3001 is updated. Browser checks used the real API for nine historical and two new originals, playback and seeking to the end, Range, byte-identical downloads and reload recovery. Desktop/390px layouts have no overflow and screenshots were inspected. Only an additional busy/error-state response was intercepted; original listings and audio were real, with no browser errors.
