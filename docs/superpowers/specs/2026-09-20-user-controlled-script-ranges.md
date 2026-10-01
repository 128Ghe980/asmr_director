# User-controlled script ranges and engineering workspace

Date: 2026-09-20

Status: Implemented and technically verified; production workbench updated. No new real-model generation or listening acceptance is claimed.
Chinese version: [用户指定文本范围与工程工作区](2026-09-20-user-controlled-script-ranges.zh.md)

## User decision and roadmap scope

The user identified that automatic paragraphs were determining the size of edits and regeneration, while whole-paragraph audio prevented independent waits between sentences. They requested choosing their own text ranges, editing during generation, and a substantial engineering-page layout change: two independently scrolling editing panels above the timeline, with frequently used sound controls first.

This is a user-approved correction to the existing Planner and engineering workflow. It does not add another numbered roadmap step or complete Audio Quality V1. The accepted original-D spatial processing and the requirement to deliver every completed original recording remain unchanged.

## Editing contract

- A selection inside a paragraph determines the text to rewrite or turn into an independent generation unit. A cursor can also define a split boundary. Boundaries use textarea UTF-16 offsets, reject invalid ranges and do not split surrogate pairs. Blank-only ranges do not create empty spoken clips.
- Planner and engineering support manual text changes, insertion, deletion, splitting and merging. Planner keeps temporarily empty local paragraphs so clearing text does not destroy a draft; adopting a project and calling the model still require valid complete input.
- AI range rewriting returns replacement text for the selected span. The application preserves the original prefix, suffix and unaffected paragraph metadata; surrounding text is context, not permission to rewrite it. Engineering reuses the Planner provider endpoint with bounded context around the selected clip.
- Editing during an in-flight request cancels the affected request. Request identity, source text, project and selection context protect against late responses replacing newer work. Editing and generation have undo/revision recovery through the existing project mechanisms.
- The current selection is within one editable paragraph or clip. This implementation does not claim a continuous native text selection across multiple textarea controls; adjacent paragraphs can be merged and then selected.

## Audio assets and user-defined generation units

Selecting **Generate selected audio** first turns the selection into independent timeline voice clips, then submits only the selected clip. Selecting the complete clip needs no extra split. Internal long-text model groups are a separate generation detail; the UI calls that mode long-text continuous generation and labels internal groups explicitly.

Existing audio for unaffected clips remains attached. Editing a clip's words, splitting a recorded clip or merging recorded clips invalidates the involved current audio binding and marks those clips for regeneration. There is no reliable word-level audio alignment for arbitrary user boundaries, so proportional text lengths are used only to arrange provisional clip timing, never to claim an exact audio cut. New candidate adoption is still explicit.

The previous project state is retained in revisions before edits involving recorded material. Undo can restore the prior project; original recordings and underlying assets are not deleted. A late candidate for an old range must not be adopted into the edited project. The last valid saved engineering project remains intact while an input is temporarily invalid.

## Waits and timeline behavior

The optional voice-clip `pause_after` field records the user's wait before the next voice clip. New projects compiled from Planner also carry their short/medium/long planned waits into this field, so real generated duration does not change those waits. Older saved projects without this field retain their existing behavior. The editor displays the wait after the actual adopted audio duration when it is available, falling back to provisional duration before generation.

When a user-controlled clip receives audio, its timeline duration follows the real audio length. Following time is shifted for both longer and shorter results so the next voice begins at `clip.start + actual audio duration + pause_after`. This preserves the requested wait instead of consuming it when speech grows or adding unrequested silence when speech shrinks. Setting a wait reuses existing speech assets; it does not generate new TTS.

Time shifts move following cues without cutting their audio. Non-looping clips preserve their full duration; looping ambience and emotion regions adjust their spans where appropriate. Splitting initially uses zero internal waits and carries the existing final wait onto the last new piece; each boundary can then be edited independently. Project bounds are fitted to retained material.

## Workspace layout

- The engineering top area has the script editor on the left and sound/generation controls on the right. Both scroll inside their own panels; the timeline occupies the lower full-width area. Emotion and validation information is folded below it.
- The left panel contains direct text editing, selected-range rewriting/generation, split/merge/insert/delete, waits and undo. Selecting a timeline clip selects its corresponding editor card.
- The right panel shows a short current-range summary instead of a second textarea. Reference voice, generation/cancel and candidate preview/adoption come first. Current audio and all original recordings remain accessible. Original history is collapsed initially; available originals are revealed once during an active generation without collapsing a user's preview when the task ends.
- Space, distance, movement, volume and pan controls remain available, including fixed-distance orbit and orbit approach. Time nudges, expression shortcuts, engine settings and technical provenance use disclosures. Invalid folded timing/expression fields expose their errors.
- The project details dock starts collapsed and contains project playback, export, history and metadata when opened. Candidate undo, recording downloads and playback controls have not been removed.

## Verification and closeout

Evidence directory: `I:/AI/asmr-director-range-editing/2026-09-20`. `verification.json` records the structured checks and limitations; `typecheck.log` records TypeScript validation alongside the logs below.

Targeted checks:

- Clip inspector and voice-generation panel: 2 files / 43 tests passed, including external text editing, compact ordering, D orbit controls, original availability, playback, adoption and undo. Their ESLint checks passed.
- Studio voice-candidate workflow: 11 tests passed after opening the appropriate disclosures as a user would. Coverage retains cancellation/project-switch originals and verifies text-edit invalidation, revision recovery, late-generation isolation and adoption-check races. ESLint passed.
- Other implementation agents reported passing targeted batches of 61, 41 and 12 tests for range, Planner, timing and rewrite work. These overlapping batches are not a full-suite total.

Final integrated checks passed: 62 Vitest files / 629 tests; one existing opt-in file/test was skipped (`tests-final.log`). Full ESLint (`lint.log`) and the final Planner-file lint (`lint-planner-final.log`), `tsc --noEmit` and the final production Webpack build (`build-final.log`) passed. The existing Windows SWC warning still uses the WASM fallback; this change adds no new warning category.

Browser checks on the isolated port-3002 origin used a sample project: selecting the six characters `你还没睡吗？` split the intended range while retaining all other text; setting a 1.7-second wait shifted the timeline; reload restored the project; the rewrite panel displayed the exact selected target. Both desktop panels had internal `overflow: auto` (client/scroll heights 353/1231 and 420/635), and the 390px mobile viewport had a 380px page with no horizontal overflow. These were UI interactions, not a real LLM rewrite or TTS run.

The production workbench on port 3001 was upgraded from PID 14524 via intermediate PID 30540 to **PID 19292**, serving `ASMR_NEXT_DIST_DIR=.next-spatial-build`; the temporary port-3002 preview was stopped. A read-only browser recheck on 3001 confirmed the new two-panel layout and lower timeline, the restored soft Chinese reference voice, and the user's existing `深夜回家，小安陪你吃碗热汤面` project with six sections and 4:50 duration intact. Browser errors and warnings were empty. Mutating browser tests ran only on the separate port-3002 sample-project origin; the user's production project was not rewritten, split or cleared for testing.

These results complete the technical checks for this interaction revision. They do not establish new real-model speech quality, successful real LLM range rewriting or headphone listening acceptance. Audio Quality V1 remains in progress.

The user did not request a commit or push for this change; the current work is not described as pushed. Keep new caches and evidence on I: where possible. Do not reset browser projects, remove old recordings or roll back the accepted D renderer or original-audio delivery policy while integrating this work.

## Related records

- [Roadmap](../../ROADMAP.md)
- [Recovery handoff](../../AI_HANDOFF.md)
- [Project archive](../../project-archive.md)
- [Complete original audio delivery](2026-09-20-audible-generation-and-performance.md)
- [Original-D product integration](2026-09-14-spatial-d-product-integration.md)
