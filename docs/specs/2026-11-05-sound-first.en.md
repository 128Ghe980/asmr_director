# Sound-first trial for non-speaking shots

This contract is part of Audio Quality V1. See [中文](2026-11-05-sound-first.zh.md).

## Workflow

Keep the existing creation, script, adopted speech, visual/sound design and processing workflow. Add an optional sound-first choice to video export and a project/native/sound-first override in the runner. Native remains the default. The choice does not rewrite the project, adopted speech or saved sound designs.

## Media flow

Generate the independent ASMR text-to-video candidate first. Existing ComfyUI `LoadAudio` reads its audio directly from the downloaded video. Trim that audio and use it both as the main shot's H3 `<Audio 1>` reference and as its final soundtrack. Preserve the character image and applicable previous-frame references. No new local FFmpeg dependency or separate WAV export is required.

The silent main prompt refers to non-speaking audio, requests no lip sync and does not also demand native sound generation. Pantomime restrictions remain intact; foley materials do not become visible main-scene props. Speech shots retain their adopted audio and existing tail-pause rules. Each delivered segment remains at most 15 seconds.

The ordinary preview retains raw sound-first audio. The enhanced ASMR preview applies the existing D processing once and replaces the silent shot's audio, avoiding a duplicate overlay of the same source. Speech overlays remain unchanged. Audio conditioning does not guarantee exact gesture/transient alignment; target-machine listening and viewing are required.

## Dependencies and compatibility

The optional manifest field is `silentAudioMode: "asmr-first"`; absence means `native`. CLI overrides accept `native|asmr-first`; GUI also offers project default. Every silent task in sound-first mode needs a corresponding independent sound design. Missing, failed or incomplete prerequisites block the main shot explicitly instead of silently generating native audio.

The main-shot cache depends on the same sound candidate's identity and successful media SHA. Source changes invalidate dependent main shots; processing-only changes do not regenerate source sound or video. Resume, candidate isolation, partial selections and native override must work. Legacy package defaults remain compatible.

## Spatial planning

Creation plans a justified source position and one supported movement path for suitable triggers. Design and review map it consistently to existing `start/end/movement`: static, approach, recede, left-to-right, right-to-left, orbit and approaching orbit. Backgrounds normally stay still; voice and object positions are independent.

For a whole script with at least three trigger performances, at least one operation suitable for movement while sounding, and no user requirement for fixed sound sources, include at least one single left/right pass during audible contact. Both direction and sound suggestions state its start, path and end. Relocating an object before stationary sound does not qualify. Repeat this check in the final creation checklist and automatic repair, without padding duration or forcing orbit.

Tracing a cup rim, small finger movements and camera motion do not imply orbiting the listener. Full orbit requires a genuine listener-centered circuit. The current single-path contract cannot represent repeated reversals, timed stops or independent simultaneous sources; this trial does not extend DSP or claim those effects. Keep extracted source audio dry and minimally reverberant; D supplies final spatial processing.

## Verification

Cover exported packages, prompts, graph references, prerequisite failures, candidate isolation, cache invalidation, native fallback selection and single-pass enhanced processing. Real DP output validates text/parameter correspondence only. A runnable trial package can be delivered without a connected H3 host, with actual audiovisual quality explicitly pending.
