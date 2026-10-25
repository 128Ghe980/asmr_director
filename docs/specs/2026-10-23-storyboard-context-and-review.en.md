# Storyboard narrative context and batch review

Date: 2026-10-23. Route: Audio Quality V1 remains in progress; SFX remains paused.

## Goal

The historical Snow Night package repeatedly holds the speaker at the entrance, leaves a coat handover pending, retains an offered cup, and uses medium close-ups throughout. Improve the inputs and action instructions used for storyboard generation, then perform one text API review across the batch. Review is not a prerequisite for subsequent work.

## Generation

Supply the complete script order, the current clip's position, neighboring semantics, and measured current speech duration. Neighboring dialogue may provide context without adopted audio. Engineering start times, explicit waits, and estimated clip durations do not determine action choreography. The scene remains planning context rather than repeated boilerplate in the exported H3 prompt.

Continuity preserves established character, prop, and action states while allowing natural movement, seating, and camera following within the scene. Center each shot on one main event with a visible outcome; allow stillness when appropriate. Distinguish the speaker's action, invitations to the listener, past facts, future plans, and conditions. Keep the speaking face and mouth visible while framing important hands and props; do not mandate close-ups throughout. Preserve reference appearance, dialogue, original audio, reference modes, measured durations, and concise output fields.

Added context protects in-flight generation against changed narrative inputs. It does not retroactively invalidate every historical storyboard.

## Batch review

Inserting a silent shot creates an editable unit without a text API request. Its neutral pending description asks for a natural transition based on surrounding story, without inventing props, locations or actions. When generating the storyboard, use the full script, current position and neighboring context to turn pending or general continuity instructions into concrete visuals and natural ambience. A placeholder is not an event that already happened. Preserve explicit user intentions. The new default affects subsequent inserts and does not migrate or overwrite saved descriptions.

Generation and review reuse the persisted project limits: visual 800, action 600, camera 400 characters; title 120 and ambientSound 600. The 320/180/120 targets remain concise-writing guidance in the prompt only. Exceeding a writing target does not reject, truncate, rewrite, repair or retry a reply. Required text remains nonempty, and unknown fields or model-controlled source metadata remain forbidden.

After a storyboard batch, make one request to the existing external text API when current storyboards are complete. Supply the full script and all shots as context; allow automatic edits only to this batch's successful, unedited generated shots. Review prop ownership and handovers, speaker/listener locations, repeated action resets, outcomes, duration feasibility, and visibility of important objects. Do not turn future plans, conditions, or memories into present actions or require constant movement and reframing.

Return only necessary direction changes with short reasons. Code preserves dialogue, source audio, duration, order, independent/continuous preferences, and source bindings. Editable fields are title, visual, action, camera, and silent-shot ambient sound. Rebind predecessor fingerprints of originally current downstream shots after application without changing their directions or reviving previously stale shots.

Use consecutive three-digit script shot numbers in model input and map them back to project clip IDs on the server, avoiding gaps in legacy IDs. The model returns only changed text fields; code merges unchanged fields. Missing or empty patches are no-ops, while actual changes still require atomic number, permission, field, and length validation. Visual describes the opening state and action describes the event and outcome; the next shot should inherit that outcome. An independent shot may open with the speaker already seated without adding a walking or sitting sequence.

Existing projects use a manual batch-review entry in the batch actions menu. Show proposed changes before the user applies them, protecting unknown historical manual edits. Automatic changes also show a compact summary and support undo. Pending reviews and undo records remain in page memory; applied shots persist through normal project and short/paragraph workspace storage.

Run one pass without scoring, approval gates, or recursive re-review. Failure or cancellation preserves generated work and does not prevent post-processing or export. Users may manually retry. Project, workspace, or related-input changes invalidate late responses and previews. Persist before updating the page. Undo restores only review-related storyboard changes and preserves unrelated audio, mix, and post-processing settings.

## Verification

Test complete narrative inputs, action rules, independent/continuous and silent-shot semantics, in-flight guards, a single review call, edit scope, manual protection, failures, cancellation, persistence errors, workspace isolation, downstream rebinding, and undo. Exercise the real text API on a read-only reconstruction of the historical Snow Night package and inspect changes and invariants. Do not write to original package assets, production audio, browser projects, or remote rendered videos. Prompt review does not certify that a video model executed its instructions.
