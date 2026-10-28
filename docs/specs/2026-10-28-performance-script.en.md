# Performance scripts and visual/sound design

Date: 2026-10-28. Status: `deployed_local`; the feature is deployed on local port 3001, while rendered-media and performance quality remain unaccepted. Git publication is tracked by the development record and its publication receipt. Verification and deployment are tracked in the [development record](../records/2026-10-28-performance-script.md). This work remains within Audio Quality V1 and adds no top-level roadmap stage.

2026-10-29 user decision: retain the current implementation for mostly stable, fixed-position shots. Natural small talk and playful exchanges are not required for now. The proposed action-completion checks, extra semantic review, sound-position refinement, and editable under-duration draft fallback are deferred; none was implemented in this checkpoint. Known defects remain documented, and this decision does not establish rendered-media quality acceptance. Resume these improvements only in response to subsequent needs.

## Product goal and workflow

The intended output is ASMR performed by a character in a mostly stable view: speech, deliberate handling, listening, waiting for a response, and necessary movement. Mime can be quiet. A segment must not acquire imaginary tapping merely because the system expects sound. Generating speech alone and relying on users to insert silent shots cannot express this performance time.

The workflow remains: enter an idea, optionally with a template → generate a performance script → review, add, remove and edit speech and nonspoken segments → generate and accept speech audio → design visuals and sound → post-process → export for batch rendering. An entirely nonspoken script can proceed directly to visual/sound design without generating or accepting speech.

“Allocate performance time before writing dialogue” is automatic planning inside script generation. It uses target duration, theme, notes and template pacing to reserve time for speech, trigger actions, transitions and interaction before writing the final script. It does not introduce another mandatory approval screen. Users review the result and can edit the description and duration of each nonspoken segment.

Target duration guides writing; accepted WAVs determine actual speech duration. The system does not truncate dialogue, shorten accepted audio or add whole-project silence to force a target. Planning estimates and final media duration remain distinct.

## Segment contract

| Property | Spoken segment | Nonspoken segment |
| --- | --- | --- |
| Purpose | Dialogue and conversation during the current action | ASMR operation, transition or interaction wait |
| Text | Words to speak | Performance, action or waiting description |
| Duration | Estimated while planning; actual WAV after acceptance | Editable positive duration, at most 600 seconds |
| Voice generation | Existing speech generation, acceptance and processing | Excluded from TTS; directions are never spoken |
| Visual/sound design | Full speech with matching performance and accompanying sound | Action and sound progression, including nearly silent performance |

New generated drafts carry `performanceVersion: 1`. Each segment declares `kind` (`speech` / `silent`) and `purpose` (`dialogue` / `asmr` / `transition` / `interaction`). Nonspoken segments require a duration and cannot use the dialogue purpose. The model must not fix spoken duration. The internal value remains `silent`; the product presents this as a nonspoken segment.

Adoption stores stable source segment IDs, purpose, direction and sound intent in optional clip `performance` metadata. It survives persistence, both speech workspaces, visual design and review. Editing source words or action descriptions invalidates old instructions and designs that no longer describe the content. Split/merge operations clear instructions specific to the old segment. Nonspoken content must never enter TTS through a speech editing operation.

New scripts express meaningful waits and operations as explicit nonspoken segments instead of also adding legacy planned pauses after each line. Natural breathing and pauses within speech remain in the actual WAV. Existing projects without the new fields retain their speech and pause semantics; they are not automatically upgraded or reordered.

## Automatic pacing and templates

The budget distinguishes no speech, sound-led/minimal speech, speech-only and ordinary ideas. A no-dialogue request can produce only nonspoken segments. Template pacing specifies where time belongs instead of inserting identical tapping breaks into every theme.

New generation uses dedicated `performancePrompts`, separate from existing `rewritePrompts`, so legacy speech-density and sentence-splitting instructions do not undermine the performance budget. The new prompt supplies speech time, nonspoken time, a character budget and per-segment duration estimation. The returned estimate must remain within 80%–120% of the target; otherwise repair receives the specific excess or shortfall. This validates a draft and never trims final audio. Necessary handover, entry and sitting actions must occupy corresponding nonspoken transition time rather than exist only in spoken directions.

- Forbidden counter trade v2: follow an introduction with material listening, then a response, return and change of objects. Reserve separate time for handling that cannot occur naturally during the spoken line. Longer works extend listening and comparison instead of endlessly adding products.
- Intimate interaction theatre v2: reserve eye-contact and facial-response waits, quiet work, care and necessary posture changes. Mime is allowed; prop tapping is not mandatory.
- No template: infer transitions, trigger actions and interaction from the idea. If handing over a coat is followed by entering a room, actual movement should occupy the script rather than appear as an unexplained location jump.

Both templates update their mixed examples and `performancePacing`, retain saved snapshots, and continue to fix their visual style. Existing project snapshots are not replaced. Traditional microphone-front, sound-led ideas can use this structure; this iteration does not add a standalone traditional-ASMR template.

## Visual and sound design

The former storyboard action is presented as designing visuals and sound. New performance scripts use a separate prompt; legacy projects retain their original prompt. Stable viewpoint, current operation and sound progression take precedence over new camera angles or elaborate movement for each line. A character approaching, reacting or bringing hands into the foreground does not require moving the listener's viewpoint.

Each design includes `visual`, `action`, `camera`, `ambientSound` and `asmrSound`. Spoken segments retain their full actual audio duration. For nonspoken segments, `ambientSound` describes the sound the main video should produce: triggers, clothing, environment or a quiet wait. It no longer universally means white noise. Independent `asmrSound` describes the matching sound intent for that segment and includes existing spatial, movement and gain settings.

Starting state, contact, prop placement and ending state must connect. An invitation to enter is not already-completed entry. One object cannot simultaneously be held and remain on the table. New design prompts use English except for titles. Structure, duration, language and part checks can request model repair; these checks do not establish physical continuity or performance quality.

## Long nonspoken segments and export

A nonspoken segment longer than five seconds remains one logical performance in the editor. Design supplies continuous `parts`, each at most five seconds, with complete visual, action, camera and sound descriptions. Their durations sum to the logical duration. Remainders are balanced, so 5.1 seconds does not become a five-second job and a 0.1-second job. The limit is 600 seconds/120 parts. Bounded model windows continue from the preceding ending state rather than restart the performance.

Parts are generation boundaries, not camera cuts. Only the final part completes the whole action. Users can inspect and edit individual parts. Review exposes part changes, and apply/undo preserves the full structure and sound mode. A top-level summary cannot hide the content actually exported. Missing parts, mismatched durations or blank required directions block export.

Predecessors with `parts` use a bounded content digest covering every part's duration and visible state. A 600-second/120-part design therefore does not exceed the successor fingerprint field limit; editing even its last part invalidates the successor. Legacy fingerprints without `parts` retain their original representation to avoid invalidating existing projects.

Export flattens authored parts into ordered jobs with IDs such as `originalClipId--part-001` and segment/part metadata. The first part uses the original reference mode; subsequent parts use continuous references. Logical segment count and ZIP task count are calculated separately: three segments with three parts in the middle produce five jobs. Speech WAVs are still located by their original segment, copied unchanged and measured for duration.

## Two previews and sound ownership

The original preview uses native main-video audio, including actual triggers in nonspoken performance. The enhanced preview processes independently generated sound through the existing D engine and combines it with the corresponding segment.

- Spoken segments use `overlay`, preserving TTS and adding accompanying sound.
- New nonspoken segments use `replace`, replacing main-video audio with processed independent sound to prevent doubled taps and ambience.
- Legacy data without `mixMode` retains `overlay`. A review that changes a sound prompt must not erase an existing `replace` by omitting the field. Spoken segments cannot replace their voice track.

Both previews include every continuous part. Sound-prompt changes regenerate only the corresponding sound. Spatial, gain or mix-mode changes rerender only the enhanced preview, without regenerating main video or sound. The implementation reuses the existing ComfyUI audio node, D processor and SOFA; it adds no local FFmpeg installation or service.

New nonspoken sound preserves its planned duration. Video rounds upward at 24 fps, allowing less than one frame of tail padding per job. These container differences can accumulate across parts. Matched sound duration must not be described as a final container whose total duration exactly equals the creative target. Legacy job compatibility is retained.

## Verification boundary

Verification covers mixed and wholly nonspoken ideas, template differences, adoption and source-edit invalidation, pure nonspoken readiness/export, legacy projects, long continuous parts, review/undo, measured WAV duration, export task counts and both sound modes. CPU tests and an actual ZIP dry run verify structure and recovery behavior; real text API requests test generation quality. Actual H3 rendering, target-machine ComfyUI execution, and final audiovisual listening are separate acceptance work. Current results, failed attempts and outstanding work are in the development record.

The feature is deployed locally. The final isolated suite passed 2,266 tests with five conditional skips; the complete Webpack/TypeScript build succeeded. Port 3001 serves build `rfG9d0aAGn_UKKsVC-xYL`. HTTP, eight static assets, seven references and two Japanese WAVs were checked; all 75 feature files match the deployment and 28 unrelated work items remain unchanged. The compiled HTTP export expands one 18-second segment into four jobs. The update ZIP is independently verified. Git publication is tracked by the development record and its publication receipt.

The first three live text-API rounds exposed duration-budget, description-threshold and continuity issues. After introducing the dedicated generation prompt, round four passed structure and budget checks for six business requests. Four scripts estimate 52/56/50/60 seconds; design checks use measured WAV duration and an 18-second, four-part performance. Semantic issues remain, such as a mismatch between the overview's tap count and individual part actions, so performance quality is not fully accepted. The Computer Use attempt was stopped, so this iteration has no browser-interaction acceptance. Component tests, HTTP checks or builds do not substitute for it. No actual H3/TTS/ASR generation or final audiovisual acceptance was performed.
