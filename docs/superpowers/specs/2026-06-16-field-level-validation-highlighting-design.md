# Field-Level Validation Highlighting Design

Date: 2026-06-16

## Context

The project route in `docs/AI_HANDOFF.md` points to field-level validation highlighting as the next step. Current app reality matches that route: schema validation already produces live issue paths such as `timeline.tracks.0.clips.3.duration`, and the global `ValidationPanel` displays them, but the selected clip's `ClipInspector` fields do not show which input caused the issue.

## Goal

When a selected clip has schema validation issues, the corresponding editable fields in `ClipInspector` should show an error state and compact field message while the global `ValidationPanel` remains the full project issue list.

## Scope

In scope:

- Map project validation issue paths to editable fields on the currently selected clip.
- Highlight matching `ClipInspector` controls with a restrained amber/red error state.
- Add compact field-level messages below invalid controls.
- Add accessible state with `aria-invalid` and `aria-describedby` when a field has errors.
- Cover the currently editable clip fields:
  - `text`, `emotion`, `style`, `pace`
  - `breath`
  - `sfx`
  - `ambience`, `loop`
  - `start`, `duration`, `volume_db`
  - `position.pan`, `position.distance`, `position.movement`
- Keep all mapping logic in the ASMR domain helper layer rather than teaching UI components about raw timeline path parsing.

Out of scope:

- Storyboard or Timeline error badges.
- Full form engine or field registry.
- Real audio validation.
- Backend or persistence changes.

## Design

Add a helper in `apps/web/src/lib/asmr/edit-project.ts` that accepts the project, selected `clipId`, and current project validation issues. It finds the clip's track index and clip index, then returns a field-keyed map of issues for paths matching that clip.

Example:

```ts
getClipFieldValidationIssues(project, "voice_004", issues)
// {
//   duration: [{ path: "timeline.tracks.0.clips.3.duration", message: "clip end must be within project duration" }]
// }
```

`StudioApp` computes the selected clip's issue map from the existing `validationIssues` memo and passes it to `ClipInspector`.

`ClipInspector` adds a small field error display helper. Each editable field reads its issue list by key. Invalid controls receive error styling, `aria-invalid`, and an `aria-describedby` pointing to the inline error text.

The UI should feel like a professional tool: clear enough to act on, not noisy. The global `ValidationPanel` remains the full diagnostic view.

## Route Reality Check

The documented route remains valid. No route adjustment is needed before implementation.

## Testing

Add tests in `apps/web/src/lib/asmr/edit-project.test.ts` for:

- A selected clip receives its own `duration` issue.
- Issues for another clip are ignored.
- Nested `position.pan` issues map to `position.pan`.
- Non-clip or unsupported paths are ignored.

UI behavior will be covered by browser verification after implementation:

- Editing selected voice clip duration beyond project duration highlights Duration and shows the inline issue.
- Editing selected voice clip pan beyond `1` highlights Pan and shows the inline issue.
- Restoring valid values removes inline field errors.
- Global `ValidationPanel` still shows the project issue list.
