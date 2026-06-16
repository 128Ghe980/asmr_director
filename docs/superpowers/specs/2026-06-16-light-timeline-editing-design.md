# Light Timeline Editing Design

Date: 2026-06-16

## Context

The current handoff points to light timeline editing as the next step. Current project reality supports that route:

- `updateClipInProject` already updates `start` and `duration`.
- `ClipInspector` already edits numeric timing fields and shows field-level validation issues.
- `TimelinePanel` already reflects `start` and `duration` visually.
- The app has local persistence, import/export, and live schema validation.

The missing layer is a small set of timing actions that feel like timeline editing instead of only raw number entry.

## Goal

Add deterministic, local Timeline DSL timing actions for the selected clip, without introducing drag/drop, waveform editing, or real audio.

## Scope

In scope:

- Add selected-clip timing controls in `ClipInspector`.
- Support start nudges:
  - `Start -0.5s`
  - `Start +0.5s`
- Support duration nudges:
  - `Duration -0.5s`
  - `Duration +0.5s`
- Keep existing numeric fields visible and editable.
- Use existing project validation and field-level validation to show invalid timing outcomes.
- Keep Timeline/Storyboard/Inspector/Export JSON driven by the same project state.

Out of scope:

- Drag/drop timeline editing.
- Clip resizing handles.
- Waveform rendering.
- Audio playback.
- Collision/overlap solving between clips.
- Backend or real generation work.

## Design

Add a pure helper in `apps/web/src/lib/asmr/edit-project.ts`:

```ts
type ClipTimingNudge =
  | { field: "start"; delta: number }
  | { field: "duration"; delta: number };

function nudgeClipTiming(
  project: AsmrProject,
  clipId: string,
  nudge: ClipTimingNudge,
): AsmrProject
```

The helper finds the clip and applies the timing patch through the existing immutable update path.

Rules:

- Round results to one decimal place to match the UI step.
- Clamp `start` to `0` so a nudge cannot create negative start time.
- Clamp `duration` to a minimum of `0.1` so a nudge cannot create non-positive duration.
- Do not clamp clip end to project duration. If the user nudges beyond project duration, schema validation should surface that issue through the existing Validation Panel and field-level error system.
- Return the original project if the clip is missing.

`StudioApp` receives a new timing nudge handler and passes it to `ClipInspector`.

`ClipInspector` adds a compact `Timing Actions` row near the existing Start/Duration fields. Use icon buttons or short text buttons with clear accessible labels:

- `Start -0.5s`
- `Start +0.5s`
- `Duration -0.5s`
- `Duration +0.5s`

This stays intentionally modest. Timeline blocks should update visually through existing state flow after each action.

## Route Reality Check

No route adjustment is needed. This is the documented second step after field-level validation highlighting. The first implementation should stay button-based in the Inspector; timeline drag interactions are a later decision.

## Testing

Add helper tests for:

- Nudging start earlier reduces `start` by `0.5`.
- Nudging start earlier clamps at `0`.
- Nudging duration shorter reduces `duration` by `0.5`.
- Nudging duration shorter clamps at `0.1`.
- Nudging duration longer can exceed the project end and then validation reports the existing duration issue.
- Missing clip id returns the same project object.

Browser verification:

- Select a voice clip.
- Click `Start +0.5s`; Timeline and Time row update.
- Click `Duration +0.5s`; Timeline and Time row update.
- Nudge a late clip duration beyond project duration; Duration field shows field-level validation issue.
- Restore valid timing and confirm the issue clears.
- Confirm desktop and 390px mobile viewports have no document-level horizontal overflow.
