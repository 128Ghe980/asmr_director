# Voice context continuity and delivery pauses

Date: 2026-11-04. Part of the existing Audio Quality V1 route; no top-level roadmap change.

## Generation context

Semantic short clips use context v2. Forward context skips silent performance clips and collects later spoken text. Silent descriptions never enter TTS. Existing fixed continuation clauses fill available capacity, within 16 clauses and 500 characters. The target is never truncated; a target that cannot leave room for a continuation boundary must be split.

The last actual spoken clip also receives continuation text and uses prefix extraction, never whole-recording adoption of padded speech. Complete source recordings remain separately available. Persisted v1 contexts retain their historical recipe. Versioned context participates in candidate/request identity; adopted recordings remain intact. This does not change the model, Chinese reference-only method, reference audio, CFG, steps, or paragraph-generation method.

## Delivery pause policy

For speech followed by another segment, precedence is: explicit `tail_pause_seconds` including zero; existing positive `pause_after`; inferred timeline gap only when `pause_after` is absent; otherwise 0.35 seconds. The final segment receives no additional pause. Silent performances receive no default extension and retain their authored duration.

The selected speech segment exposes one pause control. Short and paragraph workspaces retain independent settings. Splitting transfers the original tail override only to the last child; merging inherits the last constituent's override. Pause changes do not invalidate TTS or D processing.

Digital zero samples are appended after the chosen original or prepared D WAV, preserving the entire D tail. Original files, D backups and receipts are unchanged. PCM16/24 mono/stereo and source sample rate are preserved. Source-rate quantization is shared with previews; 0.35 seconds at 22050 Hz is 7718 frames. Source PCM and ancillary chunks remain intact. Preview inserts the pause exactly once.

## Delivery and limits

Audio ZIPs retain raw and prepared backups and add a delivery-audio folder containing the chosen WAV with its pause. Video ZIP `audio.wav` files contain the physical silence. Main-video and independent ASMR durations use that actual WAV duration; source duration and quantized pause are included as audit metadata.

Video export keeps its existing all-current-D-or-all-original selection policy. The complete delivery WAV, including D tail and pause, must not exceed 15 seconds. Exactly 15 seconds is accepted; one extra sample is rejected, with no truncation. Browser readiness checks current asset metadata; server export checks the actual WAV.

Existing packages require re-export; replacing only the runner cannot add missing WAV silence. Context v2 applies to subsequent generation and does not regenerate adopted audio. This contract covers ordered previews and video delivery; absolute-timeline mixing retains its existing placement semantics.
