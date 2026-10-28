# Listener POV storyboards and narrative ASMR overlays

Date: 2026-10-28. This work remains within Audio Quality V1 and does not add a top-level roadmap stage. This specification records implementation contracts and verification limits, not a deployment or target-machine H3 acceptance claim.

## Creative style and camera behavior

Creation settings offer `character_framing` (the original character presentation style) and `listener_pov` (first person following the story). A selected reference template owns the style and disables independent selection. Legacy templates without the field use the original style; the existing secret-deal template fixes `character_framing`.

The optional style persists in the Planner brief, project videoPlan and speech workspaces, including adoption and JSON round trips. Missing legacy fields are not automatically rewritten. Missing and explicit original style produce the same shot source identity; switching to POV makes affected storyboards stale while preserving adopted speech and existing notes.

In POV, the camera is the listener's eyes. Full script context, reliably text-matched director notes and the preceding end state determine the listener's physical location, eye height and facing direction. Actual walking, turning or sitting moves that viewpoint. S1 moving does not automatically move the listener; invitations and future plans are not completed actions. The listener may contribute partial hands, but the shot does not cut to an external view of their face or body.

The original main-video prompt keeps its visible-speaker and complete `fully_copy` rules. POV requires lip synchronization when S1's mouth is visible; S1 may continue speaking off-screen when the story directs the listener toward a path or object. The camera must not return to a portrait merely to keep the speaker visible. Existing POV camera notes also carry the listener's location and orientation into later context; legacy character-framing cameras are still excluded from full-script inherited context.

## Independent sound plans

Each newly generated speech or silent storyboard requires `asmrSound` in the same text-model response:

```json
{
  "prompt": "Concrete English material, contact, texture and natural pacing directions.",
  "postProcessing": {
    "start": {"pan": 0, "distance": "near"},
    "end": {"pan": 0, "distance": "near"},
    "movement": "static",
    "gainDb": -12
  }
}
```

The description is 1–2000 characters and does not choose a duration or asset path. Pan ranges from -1 (listener left) to 1 (right); distance and the seven movement values reuse the existing audio post-processing vocabulary. Gain ranges from -36 to 6 dB. Spatial plans describe the object's location relative to the listener, not camera magnification or a close-up.

Sounds follow actions actually occurring in the current story. Without a strong contact event, the model can choose restrained, scene-appropriate material or activity sounds instead of inventing brushes, tapping or new props. Silent shots also require a plan. The independent track excludes dialogue, whispering, other vocal sounds, singing and music, does not reproduce the line, and does not perform future events early. The server wraps the description into reference-free H3 T2VA fields: `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music`. It introduces no fictitious picture, audio or subject references.

ASMR is not embedded into the original main-video prompt. Main speech and ambient-video audio rules stay unchanged. Legacy storyboards may lack this optional field and remain usable for their original workflow. Batch review may replace the entire sound-plan object; preview, application and inverse undo use the existing identity checks. Editing only the sound plan does not alter the adopted voice or main-video prompt.

## Duration, package and batch behavior

The package remains `asmr-video-package` version 1. Each shot may include `asmrSound.prompt` (the complete wrapped H3 text), `durationSeconds`, and `postProcessing`. Speech uses the measured exported WAV duration; silent shots use their own duration under the existing five-second cap. The runner remeasures the source and does not trust model timing or timeline estimates. Post-line waits are excluded.

ASMR runs as an independent reference-free H3 audiovisual task per shot and candidate, then contributes its audio. That audio is trimmed to the corresponding measured source duration; video is rounded upward to complete 24 fps frames, so the container may exceed the exact audio length by less than one frame. Native results and task receipts are retained. The batch completes the original video phase and then its sound phase. Each phase has independent identities, reconciliation and resume; sound failure never removes original video results.

With concatenation enabled, each complete candidate gets the original `preview.mp4` and an additional `preview-asmr.mp4`, with `-c001` etc. for multiple candidates. Each sound is processed and mixed into its own aligned segment before concatenation. Missing main shots, sound plans or same-numbered sound candidates prevent an incomplete overlay preview. Changing only ASMR gain or spatial settings reuses both video-generation branches and rebuilds only the overlay preview.

Post-processing reuses the product's D renderer and configured SOFA through the packaged `custom_nodes/asmr_director_audio` adapter in the target ComfyUI. The package supplies engine files, data and dependency instructions; the node must be installed in that ComfyUI and the server restarted. The runner host still needs no FFmpeg and does not install dependencies or start services. Generated stereo is treated as one object source: it is downmixed, rendered to stereo by D and aligned to the segment. Mixing includes peak protection. This intentionally does not preserve H3's native binaural cues; the original audiovisual result is retained separately.

## Verification and limits

Backend verification passed 185 tests across eight files covering legacy data and prompts, style identity, measured durations, silent shots, sound contracts, review and inverse undo. Sixteen scoped files passed ESLint; full TypeScript checking passed. The main work record will consolidate package, node and runner evidence.

A bounded live validation made two business calls and exactly two upstream requests to `deepseek-v4-pro`: a 6.25-second all-zero WAV fixture for a doorway-to-desk speech shot and a four-second continuous silent shot looking down at an open book. The first output explicitly moves the listener forward while S1 remains behind-right and off-screen. The second remains at the desk, looks at the page and plans a fingertip paper sound. Both return valid sound and spatial plans. Deliberately incorrect 99-second speech metadata does not replace the measured 6.25 seconds. Evidence is under `I:/AI/asmr_director/qa/storyboard/2026-10-28-pov-asmr/`, including requests, full results, both prompts, synthetic WAV and review summary.

This verifies real text planning, not rendered audiovisual quality. It generated no TTS, ASR or H3 media and changed no user project. The first model result combines footsteps, fabric and a final hand contact in one track with an `approach` plan; its physical placement still needs listening. Schema validity and narrative text continuity are not audio-quality acceptance. Final media and target ComfyUI compatibility remain subject to a real target-machine run.
