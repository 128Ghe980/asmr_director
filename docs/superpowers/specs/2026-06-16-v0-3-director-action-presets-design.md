# AI ASMR Studio V0.3 Director Action Presets Design

## Background

The studio already supports an editable Timeline DSL loop:

- select a clip from Storyboard or Timeline
- edit clip fields in Clip Inspector
- validate the current project live
- autosave and restore the current project in the browser
- import and export ASMR Project JSON

The next step is to make the app feel less like a raw form editor and more like an ASMR director console. Director action presets should turn intent such as "softer", "closer", or "left ear" into deterministic local Timeline DSL edits.

This feature remains frontend-only. It does not generate real audio, call an AI model, or change the project schema.

## Goal

Add a compact Director Actions strip for selected voice clips.

The first version should:

- apply deterministic local edits to the selected voice clip
- reuse the existing project state, validation, autosave, import, and export flow
- keep the underlying behavior testable through a pure helper
- make spatial actions feel obvious while keeping emotion and loudness edits controlled

The approved intensity model is mixed:

- spatial actions should produce a clear result in one click
- emotion, pace, pause, and volume actions should be conservative

## Non-goals

This version does not include:

- real TTS or SFX regeneration
- backend job queues
- waveform or audio playback
- silence clip insertion
- timeline drag and resize
- undo and redo
- multi-clip batch actions
- presets for breath, sfx, ambience, or post-processing clips
- schema changes

## User Experience

When a voice clip is selected, Clip Inspector shows a `Director Actions` strip near the top of the panel.

First preset actions:

- `Softer` / `更温柔`
- `Closer` / `更贴耳`
- `Left Ear` / `左耳`
- `Right Ear` / `右耳`
- `Add Pause` / `加停顿`
- `Quieter` / `更小声`

When a non-voice clip is selected, the strip is hidden. Non-voice preset behavior should not be invented until there is a clear deterministic mapping for those clip types.

The action strip should feel like part of the existing professional Studio Console UI:

- compact, not hero-like
- button labels short enough for the right Inspector column
- clear hover and disabled states
- no extra instructional copy inside the app
- no layout shift when different voice clips are selected

## Preset Behavior

All presets edit only the selected voice clip.

### Softer

Purpose: make delivery gentler without radically changing timing or position.

Suggested deterministic patch:

- append or normalize a gentle cue in `style`
- prefer a calmer `emotion`
- set `pace` toward a slower whisper style
- reduce `volume_db` slightly, clamped to the schema range

This action should be conservative.

### Closer

Purpose: make the voice feel more intimate and near the listener.

Suggested deterministic patch:

- set `position.distance` to `very_close`
- set `position.movement` to `static` unless the clip already has a deliberate left-right movement
- reduce `volume_db` slightly to avoid a harsh near-ear result

This action should be obvious in the Inspector and Export JSON.

### Left Ear

Purpose: place the voice clearly in the left ear.

Suggested deterministic patch:

- set `position.pan` to a strong left value within schema range
- set `position.distance` to `close` or `very_close`
- set `position.movement` to `static`

This action should be spatially obvious.

### Right Ear

Purpose: place the voice clearly in the right ear.

Suggested deterministic patch:

- set `position.pan` to a strong right value within schema range
- set `position.distance` to `close` or `very_close`
- set `position.movement` to `static`

This action should mirror Left Ear.

### Add Pause

Purpose: add a readable performance pause without changing the schema or inserting a new silence clip.

Suggested deterministic patch:

- add a short pause marker to the voice `text`
- increase `duration` slightly only when the result still fits inside project duration
- leave `start` unchanged

This action should be conservative. If the clip is already too close to the project end, it should still add the text pause marker but avoid creating an invalid duration.

### Quieter

Purpose: reduce loudness without changing performance meaning.

Suggested deterministic patch:

- reduce `volume_db` by a small fixed amount
- clamp the result to the existing schema range

This action should be conservative and repeatable.

## Technical Design

Add a pure helper in `apps/web/src/lib/asmr/`, likely named `director-presets.ts`.

Suggested public API:

```ts
export type DirectorPreset =
  | "softer"
  | "closer"
  | "left-ear"
  | "right-ear"
  | "add-pause"
  | "quieter";

export function applyDirectorPreset(
  project: AsmrProject,
  clipId: string,
  preset: DirectorPreset,
): AsmrProject;
```

The helper should:

- find the target clip by `clipId`
- return the original project if the clip is missing
- return the original project if the clip is not a voice clip
- produce an immutable project update
- reuse `updateClipInProject` or the same patch model instead of duplicating traversal logic
- clamp numeric edits before returning the project
- avoid project-invalid duration changes when applying `add-pause`

UI wiring:

- `StudioApp` can continue passing only `onUpdateClip` if the UI computes patches directly, but the preferred design is to pass a preset callback or let `ClipInspector` call a new `onApplyDirectorPreset`.
- `ClipInspector` renders the action strip only for `selectedClip.type === "voice"`.
- Applying a preset should clear any import error in the same way manual clip edits do.

The current autosave, validation, import, reset, and export paths should not need special-case code because they already observe the shared editable `AsmrProject` state.

## Error Handling

Preset actions should avoid producing invalid values where possible:

- clamp `volume_db` to `[-80, 12]`
- clamp `position.pan` to `[-1, 1]`
- avoid increasing `duration` beyond project duration in `add-pause`

If future presets can still produce invalid project state, the existing `ValidationPanel` should surface the issue rather than hiding it.

## Testing

Add unit tests for the preset helper before UI wiring.

Required test coverage:

- applying `closer` updates only the target voice clip position
- applying `left-ear` and `right-ear` set opposite pan values within schema range
- applying `quieter` clamps volume at the lower schema bound
- applying `add-pause` does not extend a clip past project duration
- applying a preset to a missing clip returns the same project
- applying a preset to a non-voice clip returns the same project
- the original project object is not mutated

After UI wiring, run the existing app verification commands:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Browser verification should cover:

- selecting a voice clip shows Director Actions
- selecting a non-voice clip hides Director Actions
- clicking each action updates Inspector fields
- Storyboard, Timeline, Validation, and Export JSON reflect the changed project
- refreshing after a preset action restores the edited project from localStorage
- desktop and mobile widths have no horizontal document overflow

## Acceptance Criteria

- Voice clips expose the six approved Director Actions.
- Non-voice clips do not expose voice-specific actions.
- Each action produces deterministic local Timeline DSL edits.
- The shared project state remains the single source of truth.
- Autosave, restore, import, export, and validation continue working without separate preset-specific state.
- Tests cover the pure preset behavior.
- No backend, model calls, audio generation, waveform work, or schema changes are introduced.
