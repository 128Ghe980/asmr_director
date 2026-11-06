# Native silent ASMR and speaking during an ongoing action

This experiment belongs to Audio Quality V1. After trying sound-first generation, the user reported weak audiovisual correspondence and requested native sound from silent main videos as a reference for the following speaking action. See the [Chinese contract](2026-11-05-action-first.zh.md).

## Performance and workflow

Keep creation, script review, adopted speech, visual/sound design, post-processing, and batch export in their current order. New scripts may continue a sustained trigger from a silent segment into the next spoken segment. They should not invariably finish the action before speech. Completed one-shot transfers, placement, or unwrapping must not be repeated. Sustained tapping and rubbing can continue. One-shot actions stay within 10 seconds and each generation within 15 seconds.

An optional `asmrSound.continuation: "previous-silent"` marks an authored continuation. It is only valid on a speaking trigger segment immediately after a silent segment with the same ongoing action. Adjacency or matching hand positions alone is insufficient. Users can inspect or remove the marker; existing projects are not automatically linked. Sound dependencies do not force visual tail-frame continuity or weaken the existing independent-shot cadence.

Add a separate export mode, `silentAudioMode: "action-first"`. Preserve native mode and the previous `asmr-first` experiment, without migrating existing projects or altering adopted audio.

## Generation dependencies

1. Generate every silent main video with native sound; do not generate a separate ASMR video for that silent segment. Emphasize sleep-oriented ASMR, identifiable materials, gentle contact, synchronized action rhythm, and quiet gaps. Empty-hand templates retain their visual constraints; foley must not instantiate imaginary listeners or props.
2. For marked speech, read the audio of the same candidate of the immediately preceding silent main video. Use it as an acoustic reference for a new independent sound video with the current segment's duration and action. Preserve material and contact character rather than copying the entire prior soundtrack.
3. Apply the existing D spatial/loudness process to the new sound, then mix it with the adopted speech WAV. This same mixture feeds both the H3 audio reference and the final main video's soundtrack. Lip motion follows speech only, while the performed action follows the trigger rhythm.
4. Unmarked speech retains its prior main-video and independent-sound behavior.

The export maps the marker to `asmrSound.referenceShotId`, referencing the previous silent generation task, or its last part when split. Never borrow another candidate's sound or silently fall back when a prerequisite is missing, failed, outdated, or modified.

## Post-processing, concatenation, and recovery

The ordinary preview preserves main soundtracks: native silent sound and the already mixed continuation speech. The enhanced preview applies D once to silent native sound and replaces it; it neither overlays nor processes continuation speech again. Other speech retains its existing overlay behavior.

Reuse existing ComfyUI LoadAudio, D, and mix nodes. No additional local media tool is required. Include candidate identity and source contents in fingerprints. Changed silent source invalidates its dependent sound and speech main video; sound post-processing changes invalidate the premixed main video without regenerating the sound. Preserve native-mode cache identities. Cover interruption, selected segments, candidates, reruns, and explicit dependency failures.

## Verification boundary

Verify old/new modes, real export, speech PCM and tail pauses, candidate dependencies, conditioned sound generation, pre-reference mixing, absence of duplicate mixing, recovery/invalidation, independent shots, and real DP continuation planning. Offline graphs and generated text do not establish H3 synchronization or perceived sound quality; that remains a generation-machine trial.
