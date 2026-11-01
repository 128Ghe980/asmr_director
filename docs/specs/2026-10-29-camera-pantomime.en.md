# Close interaction template: empty-handed camera performance

Date: 2026-10-29. Route: Audio Quality V1 in the existing [product roadmap](../ROADMAP.md). This corrects the current creative and visual/sound planning pipeline; it adds no top-level stage.

[中文规格](2026-10-29-camera-pantomime.zh.md) / [Development record and verification status](../records/2026-10-29-camera-pantomime.md).

2026-10-30 update: the historical five-second task rule is superseded by the [performance pacing and independent-shot contract](2026-10-30-performance-pacing.en.md). The empty-handed visual principles remain.

## Intent and workflow

The user reported detached collars and isolated faces in a generated close-interaction Halloween video. Dialogue may still describe caring for the listener, such as adjusting a collar or sweeping a cheek. The visible performer must enact that intent with empty-handed gestures toward the camera, in a stable frame resembling the reference performances.

The workflow stays unchanged: select a template and enter an idea; generate speech plus timed non-speaking segments; review the script; generate and adopt speech; design visuals and sound; apply audio processing; export the batch. Non-speaking operations continue to receive real time automatically.

## Explicit capability and compatibility

`intimate-interaction-theatre` v3 stores `visualPerformance: "pantomime"`. Only this explicit snapshot capability enables the new behavior. The template ID, title, or `listener_pov` alone does not activate it. The template retains its locked viewpoint selection, with the capability imposing fixed camera performance.

Saved v1/v2 templates and snapshots lacking the field retain their original prompts, as do projects without this capability and the forbidden-counter trade template. Selecting the new template adopts the capability; existing projects and exported packages are not silently migrated. The full template snapshot already participates in source fingerprints, so adopting a new snapshot invalidates mismatched saved designs.

## Visible performance contract

- S1 is the only visible person. Keep the full head, upper torso, and connected arms together in frame; use the reference appearance and outfit. Hands and the interaction space remain empty.
- Keep a fixed frontal medium close shot. S1 may lean slightly or change expression. Do not track the performer, tilt toward an imagined target, or cut to isolated faces, hands, or objects.
- Locate task gestures relative to the lens: lower edge, left or right camera-facing space, or upper edge. Do not anchor the task to S1's own forehead, cheeks, hair, or clothing.
- `scene/direction/visual/action/camera` describe visible hand shapes, trajectories, pauses, and end poses. Do not materialize listener body parts, clothing, hair, hands, mannequins, transparent bodies, or invisible held objects. Do not add tools or transfer the care task to S1's own body.
- Gaze, reactions, and waiting are valid quiet content. Do not force gestures or add exhaling, blowing, sighing, or staged breathing. Ordinary breathing need not be described. Visible speech follows adopted TTS; non-speaking segments have no lip performance.

Story intent and visual enactment are distinct. Dialogue can name the imagined care target, while director fields describe the executable empty-handed performance without repeatedly naming a visual target.

## Foley and continuous time

`soundSuggestions`, `ambientSound`, and `asmrSound.prompt` may request independently produced foley synchronized to the mimed gesture. The main frame does not need a physical sound source. The separate ASMR carrier video may show materials or hands needed to produce sound, but only its audio is used; those visual objects must not enter the main shot.

Foley follows the current task's texture, rhythm, position, and gaps. Inheriting a previous hand position does not authorize copying its action or sound. Gaze and waiting may use quiet room tone. Exclude speech, whispers, breath, mouth sounds, and music; keep source recordings dry, with spatial processing applied afterward.

The independent `asmrSound.prompt` describes only that foley or room tone. It must not comment on the main soundtrack, prioritize S1's voice, reference S1/Picture/Audio labels, or repeat dialogue. Quiet waiting requests room tone directly, keeping speech preservation instructions out of the separate sound-generation task.

Speech shots retain the complete adopted `fully_copy` soundtrack and use independent foley as `overlay`. Non-speaking shots describe the same sound intent in `ambientSound` and independent foley; the enhanced version uses `replace`. Existing original/enhanced merges and measured speech or planned non-speaking durations remain unchanged.

Long non-speaking segments still use the existing partition algorithm, with blocks no longer than five seconds and an unchanged total duration. Blocks represent phases of one performance: establish, continue or pause naturally, and finish only in the final overall block. Request windows retain global indices; a window boundary is not a closing beat. Do not copy a complete raise/operate/lower cycle into every block.

## Generation, rewriting, and review

Creative generation, section rewriting, and visual/sound design read the capability. Short legacy clips use the same pantomime design path even without `performance` metadata. Design context retains script text and original action/sound intentions while removing other clips' generated `storyboardContext` examples. `previousEnding` supplies only the inherited final hand position, posture, and camera state. The user message ends by restating the current task and sound intent.

Batch review follows the same contract. It must not restore physical handoffs, listener anatomy, or props from old review examples, nor silence valid foley because the performer is empty-handed. Patches preserve speech, audio, timing, order, provenance, reference mode, and sound ownership. Editing `parts` preserves their count and durations. Pantomime structural repair wording retains the current task, empty-handed staging, fixed frame, and continuous phases; legacy repair wording remains unchanged.

Time allocation remains automatic. Initial prompts ask the model to estimate speech, then allocate the remaining target time to existing gestures and reasonable pauses. When the existing budget validation fails, pantomime requests that permit non-speaking content receive exact feedback: for current speech estimate `S`, explicit silent durations should total `target − S`, with an allowed range of `max(0, lower bound − S)` to `upper bound − S`. If speech already consumes the target, reduce speech before recalculating. Sum actual segment durations; do not mechanically scale, invent side plots, auto-fill content, relax validation, or add retries beyond the existing single repair.

## Export and acceptance boundaries

Single-shot H3 previews, batch usable prompts, and ZIP export all carry the capability. Export does not restore listener-driven camera movement or off-screen S1 speech. Independent foley keeps its sound-production description.

Report local contract tests, real DP semantic review, isolated build/deployment checks, and final H3 audiovisual acceptance separately. Text and structural checks do not prove rendered video quality. This change does not reopen broader dialogue personality or general directing optimization. Preserve historical duration failures and keep the RAM-paused No-sleep production task paused. The development record tracks the actual verification state.
