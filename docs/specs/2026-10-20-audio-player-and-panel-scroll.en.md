# Audio preview and right-panel scrolling

Date: 2026-10-20. Under Audio Quality V1, which remains in progress; SFX is paused. The user requested publishing the current version first, then improving frontend audio playback and nested right-panel scrolling.

## Playback

Replace four native audio-control sites with AudioPlayer: voice previews including original recordings and reference voices, candidate groups, reference import, and accepted-voice preview. Preserve the real HTMLAudioElement, ref, source, preload and media events. Generation parameters, audio files, recognition, adoption and downloads remain owned by their existing flows.

Use compact dark controls for play/pause, actual seek position, elapsed/total time and mute. Unknown durations use a placeholder; seeking requires finite metadata. A native range supplies keyboard/touch semantics, explicit labels and visible focus. Loading remains cancellable, errors retryable, and source changes/unmounts invalidate old callbacks. Existing parent error UI can suppress duplicate status text.

A page-local coordinator pauses the previous registered audio only after an actual play event. Include both headless clip/mix playback paths in the main studio. Failed play attempts do not interrupt another active preview. Preserve the spatial workbench's existing custom A/B and convolution-tail engine.

## Scrolling

Keep one outer vertical scroller per audio/storyboard tab. Candidate lists, original recordings, recognition comparisons and recognition text grow naturally; keep disclosures and pagination. The readonly H3 preview grows with its content and panel width while retaining selection/copy. Reserve a stable scrollbar gutter and retain existing narrow-screen editor tabs.

## Validation limits

Test media events/state, expiration cleanup, exact selection endpoints and source replacement; cover project/workspace switches, reordering and storyboard integration. Run typechecking, relevant lint and a production build. Preserve the existing 127.0.0.1:3001 origin and user data. If browser tooling fails, explicitly record missing visual/touch verification instead of treating DOM checks as screenshot validation.
