# Adopted voice preview and script ordering

Route: existing **Audio Quality V1**, under the fixed [roadmap](../../ROADMAP.md). Chinese contract: [中文版](2026-10-07-accepted-voice-preview-and-order.zh.md).

The existing complete project mix requires assets on every track. This addition lets the user preview and download the voices already adopted while the rest of the project is unfinished.

## Preview contract

- Place a compact preview row below the script's batch actions, showing adopted/total voice counts. Prepare explicitly; then expose native audio controls and a WAV download for the same file.
- Select only current `voice` clips with `asset_generated` and an exact `asset://clip/<asset_id>` reference. Sort by timeline start with stable ties. Candidates, history, pending/mock assets and other tracks are excluded.
- Join the complete actual source recordings, including audio longer than old estimated slots. Preserve the adopted clip's explicit `pause_after`, otherwise infer only the gap to its immediate original next voice. Skip unadopted speech without adding its duration as silence; omit the final trailing wait.
- Export original sound as PCM16 48 kHz stereo, duplicate mono channels and preserve stereo separation. Resample PCM16/24 inputs as needed. Do not apply spatial effects, clip envelopes, loudness normalization or TTS/ASR; leave all sources and adoption records untouched.
- `POST /api/assets/voice-preview` accepts `{project}` and returns `{audioUrl,filename,clipCount,skippedCount,duration,size,expiresAt}`. Native repeatable `GET`/`HEAD` support Range; `download=1` gives an attachment. `DELETE` releases the token.
- Project, adoption, voice content, order or wait changes invalidate playback and abort pending preparation; ignore and release late results. Cancel, unmount and `pagehide` clean up. Handle React StrictMode reattachment without losing the media source.
- Prepare serially into owned temporary directories using bounded PCM chunks. Limits: 2,000 clips, 128 MiB/10 minutes per source, 20 minutes combined, 120 seconds preparation; three ready tokens with 30-minute TTL. Expired/released tokens cannot acquire new leases; active streams close before directory deletion. Use `ASMR_VOICE_PREVIEW_TEMP_ROOT` to relocate temporary output.

## Ordering contract

Each voice row exposes compact up/down buttons. First/last boundaries and active generation/import/storyboard work disable impossible moves. Swap adjacent complete voice clips while retaining IDs, source text, adopted assets, generation and video associations. Carry waits with their clips; reflow the affected voice suffix using complete adopted durations, keeping non-voice tracks and emotion points intact. Extend project bounds only when required. Preserve the current selection, use the existing edit revision/cancellation/persistence flow, and permit exact undo. Source assets/candidates are not deleted or regenerated.

## Acceptance

Targeted PCM, path, Range/session, cancellation, stale-response, StrictMode, reorder/adoption and undo regressions; full TypeScript, related lint and production build. On the original 3001 browser origin, verify the user's partial project, native playback/download, movement followed by undo and reload, compact desktop/mobile layout, and unchanged reference/original/candidate/foreign working data. No model job is required.
