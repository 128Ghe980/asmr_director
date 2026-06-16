# Project Structure Upgrade Design

Date: 2026-06-17

## Context

The project has grown from a single demo page into a local-first ASMR Director workspace:

- The app can edit the Timeline DSL through panels and inspector fields.
- Project JSON can be imported, exported, reset, restored from local storage, and validated.
- The interface is now Chinese-first.
- Current project-level controls are still split between `ProjectHeader` and `ProjectControls`.
- The page does not yet clearly reserve space for future project lists, project metadata, or a preview layer.

The earlier roadmap described this step as a clearer Project Shell / project workspace structure:

- Distinguish current project, project status, and local save state.
- Organize project-level operations into a workspace-like surface.
- Reserve room for future project list, project metadata, and preview layer.

The first narrow interpretation, "top project shell plus toolbar", was not enough because it did not visibly reserve the future project list, metadata area, or preview layer. The approved direction is therefore the stronger **C+ structure**.

## Approved Direction

Use **C+: collapsible two-side project workspace**.

Archived mockups:

- `docs/mockups/2026-06-17-project-structure-upgrade.html`
- `docs/mockups/2026-06-17-project-structure-upgrade-collapsible-c.html`

The C+ structure has four regions:

1. **Left project rail**
   - Shows the current project.
   - Reserves visible space for future recent projects and project list workflows.
   - Can collapse into a narrow rail to free editing space.

2. **Top workspace header**
   - Shows project identity and metadata summary.
   - Shows project status, validation status, and local save state.
   - Hosts project-level actions: `导出`, `载入`, `重置`.

3. **Center editing workspace**
   - Keeps the current core workflow: storyboard, timeline/emotion/validation, and inspector.
   - Must remain the most important area when side panels are expanded.
   - Expands when either side panel is collapsed.

4. **Right project details dock**
   - Contains three project-level blocks:
     - Preview layer placeholder.
     - Project metadata.
     - Save / validation summary.
   - Can collapse as a single dock to free editing space.

This keeps the app feeling like a durable project workspace without adding backend persistence, auth, collaboration, real generation, or full multi-project management.

## Goals

- Make the page read as a project workspace, not a single embedded demo.
- Make current project identity, save state, and validation state visible at the workspace level.
- Move project-level operations out of the middle of the editing flow.
- Give future project list, metadata, and preview features stable layout homes.
- Let users collapse both side regions when they need more room for the center editor.

## Non-Goals

- No backend persistence.
- No authentication.
- No collaboration.
- No full multi-project store.
- No real audio/image generation.
- No actual preview playback or asset rendering in this step.
- No destructive schema redesign.

## User Experience

Default state:

- Left project rail is expanded.
- Right project details dock is expanded.
- Top header shows project name, duration, language, version/id, edit state, local save state, and validation summary.
- Center workspace remains usable without horizontal scrolling at normal desktop widths.

Focused editing state:

- The user can collapse the left project rail.
- The user can collapse the right project details dock.
- A `专注编辑` action can collapse both sides at once.
- Collapsed side regions remain visible as narrow rails or labels, so users can restore them without searching.

Mobile behavior:

- Side regions stack above or below the center workspace instead of forcing horizontal overflow.
- Collapsed controls remain reachable.
- Project-level actions stay short and clear.

## Component Design

Add or reshape components around explicit workspace boundaries:

- `ProjectWorkspace`
  - Owns the top-level shell layout.
  - Receives project, validation summary, local save state, and action handlers from `StudioApp`.
  - Controls left/right collapsed state as local UI state.

- `ProjectRail`
  - Displays current project identity.
  - Shows lightweight future placeholders such as recent projects and project list.
  - Does not implement real multi-project persistence yet.

- `ProjectWorkspaceHeader`
  - Displays current project summary, validation summary, and local save state.
  - Hosts project actions: export, import/load, reset.
  - May reveal or delegate the JSON import text area through a compact import area.

- `ProjectDetailsDock`
  - Displays preview placeholder, project metadata, and save / validation summary.
  - Collapses as one unit.

- Existing editing panels
  - `StoryboardPanel`, `TimelinePanel`, `ValidationPanel`, and `ClipInspector` remain focused on editing.
  - They should not own project-level import/export/reset UI.

`StudioApp` remains the single state owner for the current `AsmrProject`, selected clip, dirty/restored state, local persistence, import/export, reset, and validation.

## Derived Data

Add a small pure helper module for workspace summaries, for example `project-summary.ts`.

The helper should derive presentation-ready data from:

- `AsmrProject`
- dirty/restored/local persistence state
- validation issues

It should produce:

- project identity labels
- project metadata rows
- local save status label
- validation status label and issue count
- preview readiness placeholder state

The helper should not mutate projects and should not depend on React.

## Interaction Rules

- `导出` exports the current project JSON exactly as today.
- `载入` keeps the existing JSON import behavior, including parse/schema errors.
- `重置` restores the demo project exactly as today.
- Collapsing side regions only changes layout. It must not alter project data, selection, validation, or local persistence.
- `专注编辑` toggles both sides:
  - If either side is open, collapse both.
  - If both sides are collapsed, restore both.
- The UI should remember collapse state only within the current browser session unless implementing persistence is trivial and clearly isolated. Project data persistence is more important than layout preference persistence.

## Error Handling

- Existing import parse/schema errors remain visible near the import surface.
- Validation issues still appear in the validation panel and field-level highlights.
- Workspace-level validation only summarizes issue count and status. It does not replace detailed validation.
- If preview is not implemented, the preview block should clearly show a neutral placeholder such as `未生成`, not an error state.

## Testing

Unit tests:

- Add tests for the project summary helper.
- Cover clean demo state, dirty state, restored/local state, validation pass, and validation failure counts.
- Confirm preview placeholder state is stable.

UI/browser verification:

- Desktop default layout shows left project rail, top workspace header, center editor, and right details dock.
- `专注编辑` collapses both side regions and expands the center workspace.
- Left and right collapse controls work independently.
- Import/export/reset still work after being moved.
- Validation summaries update when schema errors exist.
- Desktop and mobile widths do not produce document-level horizontal overflow.

## Implementation Constraints

- Keep the current local-first single-project model.
- Keep schema and exported JSON format unchanged.
- Keep visible button names concise Chinese.
- Keep the visual direction aligned with the existing Studio Console style.
- Do not add a full project list implementation yet; placeholders are enough for this step.
- Do not implement real preview generation; only reserve the preview layer.

## Acceptance Criteria

- The app has a recognizable Project Shell with left project rail, top status header, center editor, and right project details dock.
- Left project rail and right project details dock can be collapsed.
- A focused editing action can collapse both sides.
- Project-level operations are no longer scattered in the middle of the editor.
- Existing editing, validation, persistence, import, export, and reset behavior still works.
- The archived mockups and this spec are committed for future AI/context handoff.
