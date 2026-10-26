# Reference-video creative templates

This is part of the existing Audio Quality V1 work. On 2026-10-26 the user requested creative-page templates distilled from existing ASMR videos, including shot descriptions carried into subsequent storyboard generation. No new top-level roadmap stage is added.

## Scope and evidence

The first curated template is based on the user's local `助眠禁止.mp4`. Its on-screen title means “ASMR but cologne is banned”: one presenter addresses the viewer against an alley background, secretly introduces ordinary products, escalates their prices, and returns to the selected products at the end. It is not a “do not fall asleep” scenario.

Eight narrative beats were extracted from frames sampled every two seconds and the video's Chinese/English subtitles. The reference is approximately 64.46 seconds, 720×1280 at 30fps. Audio signal measurements are retained separately; local ASR could not load because of memory pressure. Neither a complete transcription nor specific audible triggers is claimed. Observations and proposed production choices are explicitly distinguished. The source remains read-only and is not distributed with the application. Arbitrary-video upload and automatic analysis are outside this delivery.

## Workflow

Creation settings contain a template selector with the entire catalog and a no-template option. The Reference Templates tab uses collapsed cards, with collapsible prompt, scene, continuity requirements, and beat details. Selecting a template updates settings for the next generation while preserving existing text and nonempty user settings. Loading the authored fourteen-section Chinese example replaces the current draft and is undoable. Frontend copy excludes analysis provenance, implementation caveats, defensive reminders, and developer-facing explanations.

Generation adapts the structure to the current theme and retains the resulting draft's scene. Adoption snapshots the template and section-level directions into the project. Storyboard generation and batch review receive this context. Script downloads also include the template material.

## Contract

`reference-template.ts` defines the versioned snapshot; `creative-templates.ts` supplies curated content and the original example. `PlannerBrief.referenceTemplate` is preserved in working settings, generated-draft settings, and planner source. Editable prompt fields may be temporarily blank in local state, but generation and adoption still validate them.

Adoption stores `videoPlan.referenceTemplate` and `templateDirections`, retained in project JSON, revisions, and both speech workspaces. Directions bind conservatively to current text: unambiguous exact text, complete adjacent merges, or substantial unique split substrings. Changed or ambiguous text falls back to full narrative/template context. Current row numbers never select reference beats. Template context participates in storyboard and review identities; legacy projects without templates keep their previous behavior.

Generated semantic units receive their own start state, main action, and end state. Current project narrative and scene take precedence over the reference's original props and location. Template text cannot override structured output or audio rules.

Shared segmentation and action guidance contains structural instructions without reusable dialogue examples. Openings and character behavior come from the current brief. Draft scene and role editing belongs in the Scene tab; the floating draft-settings panel that covered its own disclosure control is removed.

## Quality boundaries

One coherent location, stable camera axis, visible mouth, one feasible event per shot, and explicit prop handoffs/placement reduce ambiguity. Reference timestamps are structural guidance, never substitute audio durations. Speech shots retain adopted audio; suggested sounds are not generated assets. Silent shots retain existing constraints. Real H3 output still requires inspection for visual defects.

See the [development record](../records/2026-10-26-reference-creative-templates.md) for initial verification and the [release handoff](../records/2026-10-26-reference-template-handoff.md) for the final UI, current service entry point, and publication state. Analysis provenance remains in source metadata and development records, outside the frontend and script downloads.
