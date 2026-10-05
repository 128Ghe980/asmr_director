# User reference-audio import

Date: 2026-10-05. Existing route: Audio Quality V1, in progress.

Amendment: new files default to8s, with language-selected local transcription and human
review. Explain reference conditioning separately from generation mode. Keep the existing
15s正太音 intact. See [transcription/diagnostics](2026-10-05-reference-transcription-and-generation-recovery.md).
The initial15s/no-ASR behavior below is a first-delivery contract superseded in those details.

The current studio only lists configured server-side voices. Add an import entry
beside the VoxCPM2 reference selector, so a user can add a recording without editing
the runtime profile. GPT-SoVITS remains its existing single voice pack.

## User flow

Choose **添加参考音频**, select MP3/WAV, review the source, name the reference and
choose a starting time and duration. The initial interval is the first 15 seconds;
the user can change it. Each imported reference is 1–30 seconds. This is an app
resource policy, not a claimed model limit. A matching transcript is optional;
blank text permits reference-only mode and never invents a transcript. Save adds
and selects the voice without generating or adopting any audio.

The authorized initial source is
`H:/comfyui/output/sd2素材/正太音/正太音.mp3` (about 108 seconds). Import its first
15 seconds as **正太音**, preserving the complete MP3. The existing default and
two references stay unchanged. Existing source, candidates and project content
must not change as a side effect of selecting or importing a voice.

## Contract

`POST /api/voice-references` accepts multipart `file`, `name`, optional
`promptText`, `startSeconds`, and `durationSeconds`. Source limit: 32 MiB. Start
is finite and nonnegative; duration is 1–30 seconds. The server generates IDs and
filenames, receives bytes rather than arbitrary paths, and keeps original uploads,
converted audio and provenance outside the repository. FFmpeg converts the
requested interval to mono 16 kHz PCM16; validate nonempty finite/nonzero samples
and requested duration. An interval extending beyond the source is an error.

Success is `{ reference, catalog }`, with safe IDs, labels, modes and preview URLs.
The studio replaces its live catalog and persists the selected reference. The
normalized recording is served through
`GET /api/voice-references/[referenceId]/audio`; filesystem paths are not returned
to the client. Source and reference fingerprints support existing generation
provenance.

Profile appends must serialize across uploads and publish atomically, retaining
all existing fields/references and the default. Keep a pre-write backup. Failures,
invalid files, conversion timeouts and cancellation before publication leave the
profile unchanged. If cancellation races an already published addition, refreshing
the catalog recovers that reference rather than pretending the write was undone.
Conversion uses hidden bounded subprocesses with argument arrays and no shell.

Import busy state prevents conflicting single/batch voice generation and voice
selection, without reporting import as a running generation. Errors allow retry;
late responses after unmount/cancel cannot select a different voice. No model,
ASR, paid service or installation is needed to add a reference.

## Verification

Check meaningful backend/API cases for valid conversion, malformed/large input,
interval checks, cancellation, write failure, concurrent appends and safe preview
lookup. Check UI immediate selection, persistence, modes, retry, busy/stale requests
and mobile layout. Verify the actual MP3 import and normalized WAV preview; this
establishes reference preparation, not generated-voice listening acceptance.
Preserve original reference files, user MP3, project assets and unrelated spatial
workbench changes. Actual results belong in the development record.

See [中文](2026-10-05-user-reference-audio.zh.md).
