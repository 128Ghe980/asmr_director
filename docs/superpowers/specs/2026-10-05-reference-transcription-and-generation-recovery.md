# Reference transcription and generation diagnostics

Date:2026-10-05. Existing Audio Quality V1 remains in progress.

The user wants the empty-transcript reference mode explained, local recognition of a
language-selected reference interval followed by editable human review, and diagnosis of
a VoxCPM2 failure using the newly imported 正太音. SFX model tests remain paused.

## Workflow

Layout follow-up, 2026-10-06: the 144×32px voice selector, 240×32px saved-reference player,
add and refresh controls share one toolbar. Below 560px of panel width, selector/management
share the first row and preview wraps below. Duration remains in the player and its title/
accessible description. The upload form expands below the toolbar; other recording previews
and all recognition/generation behavior keep their existing design.

Keep MP3/WAV upload, selected interval and preview, with an 8s default for new files. Add Chinese(default), English, Japanese
and Korean selection plus an explicit recognition action. Recognize only the selected
1–30s interval; populate the editable transcript. Human review remains necessary.
Recognition does not publish a reference or write profile/candidates. Empty text uses
audio-only reference conditioning; reviewed text enables audio+text conditioning. Explain
this separately from the current-range/continuous-long-text generation mode.

Keep manual text on recognition failure/cancel. File/language/interval/manual-text changes
invalidate the pending response; it must never overwrite current edits. Interval changes
retain reviewable text with a reminder to verify correspondence, while choosing a new file
keeps the existing reset behavior. Recognition blocks conflicting save/generation actions
and supports cancel. UI cleanup must not imply native exit is already confirmed.

## Local service

POST `/api/voice-references/transcribe` accepts multipart file/startSeconds/durationSeconds/
language and returns transcript/language/actual interval. Reuse32MiB,1–30s, safe fixed-format
FFmpeg normalization and valid complete16k monoPCM16 checks. Use existing local
faster-whisper-large-v3 CPU/int8 with explicit language and offline settings; no automatic
model downloads. Scratch stays outside Git, with no profile/asset publication.

Hold the existing VoxCPM2 native runtime reservation across normalization and recognition
for cross-tab/API exclusion.180s covers the full native operation; cancel/timeout kills
owned processes and allows5s to confirm exit. An unconfirmed exit retains the scratch and
reservation. Errors must not expose native logs, paths or secrets.

## Generation diagnosis

The22:20 log shows the15s reference loaded successfully before cuBLAS creation failed with
CUBLAS_STATUS_NOT_INITIALIZED during low-VRAM reference encoding. Missing transcript is
not this cause; the log alone does not prove insufficient VRAM. Show an actionable GPU
initialization error. CLI n-gpu-layers0 controls BaseLM only; CPU applies to all custom
components. Do not silently shorten saved references or automatically retry on CPU.

At most one isolated shorter-reference/short-utterance diagnostic under a hard deadline,
preserving the original reference/profile/project. Serialize ASR and TTS validation.
The isolated8s reference succeeded in13.922s, producing a1.44s utterance; recovery with the
original15s reference remains unverified.
Record the result and limitations; neither ASR nor one generation accepts listening quality.

## Verification

Test validated language/interval, normalization/offline execution, bounded lifecycle and
reservation cleanup, safe errors/no publication, editable/stale-response UI and App
generation exclusion, plus existing import behavior. Check TS, owned lint, build and actual
recognition/manual editing at original127.0.0.1:3001, preserving protected hashes.

[中文](2026-10-05-reference-transcription-and-generation-recovery.zh.md).
