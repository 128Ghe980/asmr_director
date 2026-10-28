# Intimate interaction theatre template

Date: 2026-10-28. This extends the existing reference-template and per-shot ASMR pipeline within Audio Quality V1; it does not add a roadmap stage.

## Goal

The user supplied two local videos in the Aige directory and asked for a reusable template that preserves their camera relationship and performance qualities across new stories. Extract interaction mechanics, not either source plot, character identity, appearance, or dialogue. Evidence and timestamp anchors belong in the [development record](../records/2026-10-28-aige-performance-template.md).

## Transferable constraints

- ID: `intimate-interaction-theatre`; UI title: `近距离互动小剧场`; fixed style: `listener_pov`. The camera occupies the recipient's viewpoint. It remains stable while the listener remains seated or still. Intimacy comes mainly from the performer leaning, tilting, reaching, and bringing hands into the near foreground, rather than continuous camera travel or orbiting.
- Establish distance, eye height, the performer's current intention, and the working area. Gaze alternates purposefully between the listener and the task. A scene or eye-height change needs a story action; do not insert unexplained teleports or external reverse angles.
- Use small, motivated reactions: noticing a detail, considering it, asking, observing, working carefully, lightly teasing, then returning to care. Choose appropriate beats instead of repeating the whole loop for every line. Avoid an unchanging smile or constant generic sleep commands.
- The listener remains unvoiced. Convey exchanges through held gaze, a brief wait, and the performer's response. Do not invent listener dialogue, a visible face, choices, or completed handoffs.
- Give each short shot one principal action or reaction. Specify starting state, approach/contact, hold, and end state. Preserve hand roles, prop locations, and cross-shot continuity. Speech and movement should express the same intention.
- Dialogue may be natural, close, and mildly expressive. Exact whisper intensity, vocal texture, and the source performer's voice are neither verified source findings nor a cloning target.
- Independent ASMR follows the current material and contact action, positioned relative to the listener. Quiet observation can retain subtle room or clothing sound; do not invent tapping or orbiting sound for every nod. Continue using the existing `asmrSound` and post-processing contract for both speech and silent shots.

## Implementation boundaries

Reuse `CreativeTemplate` creative prompts, scene description, storyboard rules, and beats throughout planning, adoption, persistence, storyboard generation, and review. No duplicate style store or audio schema is needed.

The new template has its own defaults and an original map-folding example, `雨停前的地图修补桌`. The existing forbidden-trade template retains its example and specialized trading instructions. Product displays, pricing, and A/B/C item rules must no longer constrain every template unconditionally. An unknown template ID should receive a neutral example fallback, not the old trading story.

Stored template snapshots remain unchanged. Adding a template must not rewrite existing projects. Keep template details collapsed and show useful creative content rather than internal analysis or verification notes. Selection affects future creative settings; adopting a generated draft follows the existing workflow.

## Verification

Check separate defaults/examples, POV locking, adaptation to user-supplied themes, instruction propagation into planning/storyboard/ASMR, legacy compatibility, build, and actual UI. Use real planning requests with distinct themes to assess transfer. These checks do not establish final H3 image quality, hand stability, or sound quality. The development record carries final results and evidence paths.
