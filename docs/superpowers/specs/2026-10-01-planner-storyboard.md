# Text storyboards in creative planning

Date: 2026-10-01. This extends the existing first-step Planner within Audio Quality V1, without adding a roadmap stage. [中文版](2026-10-01-planner-storyboard.zh.md).

## Scope

The user requested storyboard generation in the existing first-step generation area, with a simple initial prompt that can later be replaced or enhanced using an official skill. The current scope is an editable text storyboard: visual description, character action and camera direction, associated with the current script. Image generation is outside this iteration.

The script remains the source for audio generation. Storyboard content is planning metadata and does not become spoken text, modify audio clips or trigger audio generation. The accepted original-D audio processing and adopted-audio batch download remain in place.

## Interface

The existing Planner's right panel gains compact `文案` / `分镜` tabs. Both views share its bounded content area and internal scrolling, preserving the one-screen workspace and the existing script-selection editing tools. The left creative-settings panel retains its established desktop and narrow-screen behavior.

An empty storyboard view offers `根据文案生成分镜` when a valid script is available. Existing storyboards show numbered cards with their associated script passage and editable title, visual, action and camera fields. A compact optional instruction can guide regeneration. Save status, undo, download, generation progress, cancellation and retryable errors follow the existing Planner conventions. Cards use one column on narrow screens; controls and long text must fit without horizontal overflow.

Shots follow changes of scene, action and dramatic beat. The prompt aims for approximately 6–12 shots for a normal script, with a hard maximum of 24; short scripts can use fewer. Each shot may span several adjacent semantic speech units. A 200-unit script must not become 200 shots simply because the audio editor uses short units.

## API and validation

`POST /api/storyboard` accepts `{ provider, draft, instruction? }`, using the same configured local or external text provider as the Planner. The draft is validated before sending it to the model. The initial storyboard prompt is kept separate and simple, so later skill guidance can be incorporated without redesigning the UI or persistence format.

The response contains a `storyboard` with:

```ts
{
  version: 1,
  title: string,
  sourceFingerprint: string,
  shots: Array<{
    id: string,
    title: string,
    sourceSectionIds: string[],
    visual: string,
    action: string,
    camera: string,
  }>,
}
```

The server attaches the fingerprint of the validated input rather than trusting model-supplied provenance. It uses the script title, scene, character and ordered section IDs/text. Shot IDs are unique. Section references must refer to the submitted script and form ordered adjacent groups, covering the script without duplicate or omitted sections. Invalid model output is reported as a readable generation failure; it must not overwrite the working storyboard or silently present a local template as generated output.

Generation shares the Planner's cancellation and request-identity protection. Editing content, loading another source or undoing while a request is pending aborts it; a late response cannot replace newer work. A failed or canceled request preserves the previous script and storyboard. External requests retain the existing provider's usage-based billing behavior.

## Editing and provenance

Storyboards are stored beside the working script and participate in the same undo snapshots. The local editor permits temporarily empty text fields while the user edits, with bounded field sizes and shot count; model input and adoption still use complete-content validation where required.

Changing the source script preserves the editable storyboard and marks it as out of date through its fingerprint. The UI explains that the script has changed and offers regeneration. Undoing the script change restores the matching relationship automatically. Splitting, merging, inserting, deleting or reordering semantic units changes provenance because ordered IDs/text are part of the fingerprint. Updating only the new-theme form does not claim that the existing script has been regenerated.

Switching between tabs must preserve script text and its existing selection-editing behavior. A new script generation must not silently attach an older storyboard to the new script as if current. Regeneration replaces the storyboard only after a validated response and records the previous state for undo.

## Persistence and project sources

The V1 local Planner workspace gains optional storyboard data with migration/default handling for older records. Legacy drafts without storyboard fields remain readable. Saving uses the existing draft storage boundary and contains no credentials. Malformed storyboard metadata is discarded independently where safe, preserving valid script and brief content rather than losing an entire workspace or project source.

`PlannerSource` gains optional storyboard metadata. Adopting a script retains the storyboard with its source. Library autosave, duplication, safety revisions, restoration and audio-candidate undo preserve the associated source through their existing boundaries. Storyboards remain outside exported audio Project JSON.

Loading a current project's source explicitly loads its storyboard or clears the working storyboard when the source has none. It cannot retain a storyboard from a different project. Source loading is undoable. Project switching continues to respect the separate working draft; a changed source prop alone must not overwrite unsaved planning work.

## Verification status

Implementation, automated verification, a real provider request and desktop/mobile visual checks are complete. Evidence/log root: `I:/AI/asmr-director-storyboard/2026-10-01`. Full Vitest passes 76 files / 809 tests; one existing opt-in file/test is skipped (`tests.log`). Full ESLint passes (`lint.log`), as does the final full TypeScript check (`types-final.log`). The final TypeScript repair only corrects a new project-library test fixture's type. Next's production Webpack build passes (`build.log`).

Automated coverage includes old V1 migration, temporary empty text, saved reload, malformed storyboard-only recovery, bounded grouping and complete source references, matching fingerprints with invalid mappings, stale-source handling, edit/undo, cancellation and late-response protection, source loading without cross-project leakage, adoption/duplication/revision restoration and existing selected-range script editing. Source retention through adopting, copying and restoring projects is established by automated tests; the browser check did not create or adopt a new audio project.

The production build is native on D: at `.next-storyboard-production`, with only its cache junction directed to `I:/AI/asmr-director-storyboard/2026-10-01/native-cache`. Port 3001 now runs PID 19916 and returns HTTP 200; the previous batch-download PID 4380 has stopped. Batch-download scratch retains `I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads`. The temporary 3002 preview (PID 18584) has stopped; production 3001 remains running.

One actual browser POST used the configured `DeepSeek-v4-pro` provider and generated seven shots with 28 editable shot fields from the unchanged seven-section working script. Editing a visual field and undoing restores the original content; editing a script passage shows the stale indication, and undoing clears it. Reload preserves all seven shots and every saved field. The existing audio project retains its 15 speech units and nine adopted clips; no audio project was created or adopted and no new audio was generated.

The 1768×1252 desktop view and 390×844 / 320×740 narrow views were visually inspected: no document overflow, with the content scrolling inside the Planner. Restoring the desktop viewport and reloading again preserves all seven shots and their fields. ArrowLeft moves from the storyboard tab to the script tab with correct focus; End moves back to the storyboard tab with correct focus. Browser console errors and warnings are empty. Screenshots were viewed through the tool and were not saved as evidence image files. Structured evidence is saved in `browser-verification.json`. `git diff --check` passes, with only CRLF conversion warnings. The first prompt remains text-only and separate, awaiting the user's future official skill. No commit, push or new headphone-quality acceptance.
