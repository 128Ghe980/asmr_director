# Explicit audio processing after storyboards

Date: 2026-10-23. Existing route: Audio Quality V1; SFX remains paused.

## Workflow

Generate originals → listen and adopt → finish storyboards → choose **Generate audio processing** → listen to or export the prepared results.

Candidate, full-original and adopted-original playback reads the source file directly. Playback does not trigger spatial rendering. A persistent processing button sits immediately after the storyboard button and operates on the active speech workspace.

## Planning and rendering

- Use the current scene, character, ordered dialogue and current complete storyboards, including silent-shot action context. Make one batch planning call through the existing external text API after adoption and storyboard completion. Send no audio; invoke neither TTS nor ASR.
- Plan each utterance's start, end and movement relative to the listener. Keep stable positions without an actual action, inherit the previous end unless a genuine scene transition or a completed intervening silent action changes the location, and distinguish camera framing from physical sound-source distance. Silent shots supply action context without fabricated speech assets.
- Advance movement using each original's measured duration. Do not use estimated timeline timing or inter-utterance waits. Explicit anchors prevent repeated approach actions from restarting at the old fixed far position. Reuse the existing D spatial algorithm and installed environment; add no FFmpeg dependency.
- Persist planning before serial rendering, publish successful clips progressively and allow cancellation. A failed clip retains other results. Retrying the same inputs reuses the plan and prepared assets. Manual distance and movement edits feed the next explicit processing run.

## Assets and exports

Keep adopted original assets intact. Save independent processed files with source identity and hashes, plan, settings, renderer and output hashes. Preserve state in project JSON and both speech workspaces. Changed inputs or settings make results stale without deleting their files.

Processed playback only reads stored files. Complete results can be concatenated in script order for playback and download. Audio archives retain originals and include only available current processed files. Video packages and project mixes use processed audio when the complete set is current; otherwise they retain original audio instead of mixing a partial set. Export invokes no implicit AI or spatial renderer. ComfyUI continues consuming the exported audio directly without a later soundtrack replacement.

## Verification

Check raw playback without spatial requests, button placement and prerequisites, adjacent endpoints, manual edits and workspace persistence, cancellation and stale responses, partial failure recovery, original preservation, real CPU rendering and byte-identical export of stored results. Per-clip convolution guarantees planned position continuity only; it does not establish physically seamless room tails or movement velocity. Record real API, media and deployment evidence honestly.
