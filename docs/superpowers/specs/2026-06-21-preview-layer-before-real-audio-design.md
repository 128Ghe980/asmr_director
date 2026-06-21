# Preview Layer Before Real Audio Design

Date: 2026-06-21

## Context

The app now has the approved C+ project workspace:

- Left project rail.
- Top workspace status/action header.
- Center editor with Storyboard, Timeline, Emotion Curve, Validation, and Inspector.
- Right project details dock.
- Independent left/right collapse and focused editing mode.

The right dock already reserves a preview layer, but it is still a neutral placeholder. The roadmap now calls for **preview layer before real audio**: make the product feel ready for audio preview without pretending real audio exists or connecting generation services.

## Approved Direction

Use **C: hybrid lightweight preview layer**, with one hard layout constraint:

> The left project rail and right project details dock must remain collapsible. Preview UI must not permanently squeeze the center Timeline.

Archived mockups:

- `docs/mockups/2026-06-17-preview-layer-options-vertical.html`
- `docs/mockups/2026-06-21-preview-layer-c-collapsible.html`

The 2026-06-21 collapsible C mockup is the implementation reference.

## Goals

- Upgrade the right preview layer from a single neutral placeholder into a useful project preview surface.
- Add placeholder playback states without real playback.
- Add fake waveform/status surfaces that clearly communicate "not generated yet".
- Add lightweight generation slots for project, tracks, and selected clip status.
- Keep the Timeline usable by preserving independent side-panel collapse and focused editing.
- Keep the app local-first and driven by the same `AsmrProject` state.

## Non-Goals

- No real TTS.
- No real SFX or ambience generation.
- No real audio playback.
- No real waveform rendering from audio files.
- No backend jobs or queues.
- No cloud persistence, auth, billing, collaboration, or publishing.
- No schema-breaking redesign.
- No full DAW timeline editing.

## User Experience

### Expanded Workspace State

When both side regions are expanded:

- The right project details dock shows:
  - A project preview block.
  - A disabled or placeholder play control.
  - A fake waveform/status surface.
  - Summary counts such as available preview clips, pending clips, queued clips, and real audio count.
  - Lightweight generation slots for project mix, voice track, breath track, SFX track, and ambience track.
- Timeline and Storyboard show small generation status signals for clips.
- Inspector shows the selected clip's generation status and asset slot.

This state is for understanding project readiness and preview coverage.

### Focused Editing State

When the user needs Timeline space:

- The left project rail can collapse into a narrow rail.
- The right project details dock can collapse into a narrow rail.
- `专注编辑` can collapse both sides together.
- The center editor, especially Timeline, must become visibly wider.
- Lightweight clip status colors remain visible in the Timeline even while the full preview dock is collapsed.

This state is for editing timing and clip structure, not for inspecting preview details.

### Mobile Behavior

- The layout must stack without document-level horizontal overflow.
- Preview and generation-slot information should stay readable.
- Collapse controls remain reachable, but mobile does not need to mimic desktop rail widths exactly.

## Preview Surface

The right dock preview block should include:

- A concise title such as `项目预览`.
- A placeholder state such as `未生成` or `等待素材槽完成`.
- A disabled play button or non-functional placeholder play control.
- A fake waveform/status strip.
- A clear indication that `真实音频` count is `0`.

The fake waveform must be visually neutral. It is a readiness surface, not proof that audio exists.

## Generation Slots

Generation slots should be lightweight and local-only. They may derive from existing `clip.generation.status`, track membership, and project duration.

Recommended slot levels:

- Project mix preview.
- Voice track.
- Breath track.
- SFX track.
- Ambience track.
- Selected clip asset slot in Inspector.

Each slot can show:

- Name.
- Clip count or current clip range.
- Status label such as `待生成`, `可预览`, `队列中`, or `失败`.

If the current schema does not contain a status such as queued, the implementation may derive a local display-only placeholder status from existing data for demo purposes. It must not change exported JSON unless a later schema spec explicitly approves that.

## Component Design

Likely component boundaries:

- `PreviewLayerPanel`
  - Lives inside `ProjectDetailsDock`.
  - Displays project preview state, fake waveform, and project-level preview summary.

- `GenerationSlotList`
  - Displays project/track generation slots.
  - Receives derived display data.

- `PreviewWaveformPlaceholder`
  - Pure visual placeholder.
  - Does not read audio assets.

- `generation-summary.ts`
  - Pure helper that derives display-ready preview and generation-slot data from `AsmrProject`.
  - Does not mutate project data.
  - Does not depend on React.

Existing components should keep their responsibilities:

- `StudioApp` owns project state and passes derived data down.
- `ProjectWorkspace` owns shell collapse state.
- `TimelinePanel`, `StoryboardPanel`, and `ClipInspector` may show small generation status signals, but should not own project-level preview logic.

## Interaction Rules

- Preview play button is disabled or placeholder-only.
- Clicking disabled preview controls must not imply audio playback.
- Collapse and focus actions only change layout. They must not change project data, selected clip, validation, autosave, import/export, or reset behavior.
- Existing import/export/reset behavior remains unchanged.
- Generation slots are informational in this step. If a button such as `标记为排队` appears, it must be display-only unless the implementation plan explicitly scopes a local-only state change.

## Error Handling

- Existing validation issues continue to appear in Validation Panel and field-level messages.
- Preview readiness should not be shown as an error simply because audio is not generated.
- If a clip has a schema validation issue, generation-slot surfaces can show a warning summary, but detailed error content remains in Validation Panel.
- Invalid import JSON behavior remains unchanged.

## Testing

Unit tests:

- Add tests for generation/preview summary helper.
- Cover project-level pending preview state.
- Cover track-level slot counts.
- Cover selected clip status derivation.
- Confirm real audio count remains zero in placeholder mode.

Browser verification:

- Expanded desktop state shows right preview layer and generation slots.
- Focused editing state or collapsed side rails makes the Timeline visibly wider.
- Left and right side regions still collapse independently.
- `专注编辑` still collapses both sides and restores both sides.
- Mobile width has no document-level horizontal overflow.
- Import/export/reset still work after preview UI is added.

## Implementation Constraints

- Preserve the current ASMR Project schema and exported JSON format.
- Preserve the C+ workspace shell and collapse behavior.
- Use concise Chinese UI copy.
- Keep visual style aligned with the existing Studio Console: professional tool first, restrained ASMR atmosphere second.
- Do not add real playback, real generated assets, or backend state.

## Acceptance Criteria

- The app uses the C hybrid lightweight preview direction.
- The right dock contains a useful project preview surface, fake waveform/status strip, and generation slots.
- Timeline/Storyboard/Inspector expose lightweight generation status without overwhelming editing.
- Left and right side panels remain independently collapsible.
- `专注编辑` still gives the center Timeline meaningful extra width.
- The UI clearly communicates that real audio is not generated yet.
- Existing editing, validation, persistence, import, export, reset, and project shell behavior still works.
- Mockup and specs are committed for future AI/context handoff.
