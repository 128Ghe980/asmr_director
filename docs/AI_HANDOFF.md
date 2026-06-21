# AI ASMR Studio Handoff

Last updated: 2026-06-21

Read this first when resuming the project after context compaction or as a new AI agent. This file is the high-signal handoff. For history and rationale, read `docs/project-archive.md`.

## Workspace Location

Current Codex desktop workspace path for this repo:

- `D:\CodexWorkplace\asmr_director`

This is a local recovery hint, not a portable project requirement. In other environments, treat the repository root as the source of truth.

## Product North Star

This project is an **AI ASMR director console**, not a generic AI ASMR generator.

The user should receive an editable sound project: structured timeline, storyboard, emotional beats, binaural positioning, generation metadata, validation, import/export, and eventually local regeneration. The durable product moat is the director layer and Timeline DSL, not a specific TTS or SFX model.

## Current State

The app is a Next.js frontend prototype at `apps/web`.

Current user-facing capabilities:

- Renders the "雨夜睡前陪伴" demo project from a validated ASMR Project JSON / Timeline DSL.
- Shows the C+ Project Shell: collapsible left project rail, top workspace status/action bar, center editor, and right project details dock.
- Lets the left project rail and right project details dock collapse independently.
- `专注编辑` collapses both side regions together; when both sides are collapsed, clicking it again expands both sides.
- Keeps project-level operations `导出`, `载入`, and `重置` in the workspace header.
- Shows the approved C hybrid lightweight preview layer in the right project details dock before real audio integration.
- The preview layer includes a disabled play button, fake waveform/status strip, clip/real-audio/pending/previewable counts, and project/track generation slots.
- Preview-layer data comes from a pure derived generation summary helper; it does not change the `AsmrProject` schema and does not change exported JSON.
- Allows selecting clips from Storyboard or Timeline.
- Shows lightweight generation-status dots on Timeline clips.
- Allows editing selected clip fields in Inspector.
- Shows the selected clip's `素材槽` in Inspector.
- Syncs edits across Storyboard, Timeline, Inspector, Validation Panel, Project Details Dock, workspace summaries, and Export JSON.
- Validates current project live via Zod schema.
- Exports current project JSON from the workspace header.
- Autosaves current project to browser `localStorage`.
- Restores saved project on reload.
- Imports pasted JSON if schema-valid.
- Rejects invalid import JSON without replacing current project.
- Resets to the built-in demo project.
- Uses Chinese-first interface copy with short, clear button names while keeping technical abbreviations such as `ASMR`, `JSON`, `dB`, `LUFS`, and `seed`.
- Shows voice-only Director Actions in Clip Inspector: 更柔, 更近, 左耳, 右耳, 停顿, 降低.
- Applies Director Actions as deterministic local Timeline DSL edits through a tested pure helper.
- Highlights selected Clip Inspector fields when their schema validation issues map to editable inputs.
- Shows compact inline field messages while keeping the global Validation Panel as the full issue list.
- Shows compact Timing Actions for the selected clip: 开始 -0.5秒, 开始 +0.5秒, 时长 -0.5秒, 时长 +0.5秒.
- Applies Timing Actions as deterministic local Timeline DSL edits through a tested pure helper.

Current status is frontend-only. There is no backend, real audio generation, audio playback, real audio-backed waveform rendering, TTS, SFX generation, cloud persistence, auth, billing, or collaboration.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/components/studio/studio-app.tsx` owns local editable project state and wires export, import, autosave, reset, validation, selected clip state, and director preset application.
- `apps/web/src/components/studio/project-workspace.tsx` composes the C+ workspace shell around the editor panels.
- `apps/web/src/components/studio/project-workspace-header.tsx` shows workspace status, project summary, focus controls, and project-level `导出` / `载入` / `重置` actions.
- `apps/web/src/components/studio/project-rail.tsx` renders the collapsible left project rail.
- `apps/web/src/components/studio/project-details-dock.tsx` renders the collapsible right project details dock and hosts the preview layer surface.
- `apps/web/src/components/studio/project-workspace-badge.tsx` provides compact workspace badge display helpers.
- `apps/web/src/components/studio/preview-layer-panel.tsx` renders the lightweight preview layer: disabled playback control, fake waveform/status strip, preview counts, and generation slots.
- `apps/web/src/components/studio/preview-waveform-placeholder.tsx` renders the non-audio waveform placeholder.
- `apps/web/src/components/studio/generation-slot-list.tsx` renders project/track/clip asset slot summaries.
- `apps/web/src/components/studio/storyboard-panel.tsx` renders chronological clip cards.
- `apps/web/src/components/studio/timeline-panel.tsx` renders fixed track timeline blocks and compact generation-status dots.
- `apps/web/src/components/studio/clip-inspector.tsx` edits selected clip fields, displays field-level validation state, exposes compact timing actions, and shows the selected clip `素材槽`.
- `apps/web/src/components/studio/validation-panel.tsx` shows live schema issues.
- The former `project-header.tsx` and `project-controls.tsx` have been deleted; do not reintroduce project-level actions there.

Domain/data:

- `apps/web/src/lib/asmr/schema.ts` defines the Zod schema and TypeScript types for ASMR Project JSON / Timeline DSL.
- `apps/web/src/lib/asmr/mock-project.ts` is the canonical "雨夜睡前陪伴" demo project.
- `apps/web/src/lib/asmr/validate.ts` wraps schema parsing and clip flattening.
- `apps/web/src/lib/asmr/view-model.ts` contains display helpers.
- `apps/web/src/lib/asmr/ui-copy.ts` contains shared Chinese UI labels and validation-message translations.
- `apps/web/src/lib/asmr/edit-project.ts` contains immutable clip update helpers, selected-clip timing nudges, validation issue formatting, and selected-clip field issue mapping.
- `apps/web/src/lib/asmr/project-persistence.ts` contains import parsing, JSON serialization, and localStorage helpers.
- `apps/web/src/lib/asmr/director-presets.ts` contains deterministic Director Action preset behavior for voice clips.
- `apps/web/src/lib/asmr/project-summary.ts` derives project-level summary metrics for the workspace shell.
- `apps/web/src/lib/asmr/generation-summary.ts` derives preview-layer generation counts and asset slots from `AsmrProject` without mutating the schema or export contract.

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/director-presets.test.ts`
- `apps/web/src/lib/asmr/ui-copy.test.ts`
- `apps/web/src/lib/asmr/project-summary.test.ts`
- `apps/web/src/lib/asmr/generation-summary.test.ts`

Docs:

- `docs/project-archive.md` is the running project archive.
- `docs/asmr导演早期设计.md` is the original product/technical vision.
- `docs/superpowers/specs/` contains approved specs.
- Starting 2026-06-17, approved specs should include a Chinese companion file named `*.zh.md` for user review and context recovery.
- `docs/superpowers/plans/` contains implementation plans.

## Data Model Facts

Fixed timeline tracks:

- `voice`
- `breath`
- `sfx`
- `ambience`
- `post_processing`

Important validation rules:

- Timeline must contain exactly one of each fixed track.
- `position.pan` must be between `-1` and `1`.
- Clip `duration` must be positive.
- Clip start/end must be within project duration.
- Emotion curve points must have `end > start`.
- Emotion curve start/end must be within project duration.

localStorage key:

- `ai-asmr-studio:v0:project`

## Current Verification

Use these commands from repo root:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web
```

Latest verified state before this handoff:

- `npm.cmd run test --prefix apps/web`: 8 test files passed, 62 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed.
- `npm.cmd run build --prefix apps/web`: passed.
- Browser verification used the production server `npm.cmd run start --prefix apps/web -- --port 3011` to avoid a stale dev-HMR websocket after an abnormal shutdown.
- Browser verification passed for 1440x1000 desktop, `专注编辑`, independent left/right collapse, Inspector `素材槽`, field-level validation, invalid import, reset, export download, and 390x900 mobile overflow.

Run locally:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Open:

```text
http://localhost:3000/
```

## Recent Commit Trail

Most recent feature commits:

- `44b9abf fix: expose timeline generation status accessibly`
- `04e3ce4 feat: show lightweight generation status`
- `59f373e feat: wire preview layer into project shell`
- `91cca6e feat: add preview layer components`
- `ad85af5 fix: align preview summary public types`
- `8dbd589 fix: refine preview generation summary`
- `b34b2c4 feat: derive preview generation summary`
- `1fffef3 docs: plan preview layer implementation`
- `f74568c docs: design preview layer before real audio`
- `baf2f30 fix: avoid nested workspace columns at lg`
- `1894673 feat: wire studio into project workspace`
- `6a06d17 fix: stabilize workspace aria controls`
- `c49a733 fix: expose workspace control states`
- `b29129f feat: add collapsible project workspace shell`
- `42232a1 feat: add project workspace side panels`
- `9411f29 fix: mark edited projects as locally saved`
- `f124766 feat: add project workspace summary`
- `c0e9860 docs: plan project structure upgrade`
- `f2cd8f8 docs: design project structure upgrade`
- `154f973 feat: localize studio ui copy`
- `6dbee1a feat: add inspector timing actions`
- `26ec01d feat: add clip timing nudges`
- `f716786 docs: plan light timeline editing`
- `f9f0384 docs: design light timeline editing`
- `a8cfacc fix: stabilize inspector field error ids`
- `cbfee19 feat: highlight invalid inspector fields`
- `c85d2fd feat: map validation issues to clip fields`
- `5d2d845 docs: plan field validation highlighting`
- `381cbcb docs: design field validation highlighting`
- `e67f0cb fix: make pause preset idempotent`
- `8026b27 docs: record director presets implementation`
- `766c637 fix: include visible director action labels`
- `aaca380 feat: add director action buttons`
- `a1cdbf0 feat: add director preset helper`
- `bee8085 docs: plan director action presets`
- `e8f585e docs: design director action presets`
- `b207728 feat: persist studio projects locally`
- `fc3644e feat: add project persistence helpers`
- `303a8f8 docs: plan v0 project persistence`
- `8d6b4c1 feat: add v0 editing loop`
- `4e5a75c feat: add clip editing helpers`
- `5b29542 docs: plan v0 editing loop`
- `14fbdc5 docs: archive studio project decisions`

Earlier V0.1 foundation:

- `7a97e73 docs: add v0 studio planning artifacts`
- `11e96bc fix: validate timeline ranges`
- `0b169d4 polish: verify studio console layout`
- `745350d feat: render v0 studio prototype`
- `22a98e3 feat: build studio console components`
- `4a5943f style: add studio visual foundation`
- `1854c4a feat: add demo project and timeline helpers`
- `a7caffb feat: define asmr project schema`

## Recommended Next Work

Recommended next step: **real generation integration design**.

Why this next: preview and asset-slot surfaces are now stable. The next step should decide the real generation integration shape before any service wiring: local-only queued state vs backend job model vs mock generation bridge. This is a design task for the generation contract and state model, not a direct jump into real TTS/SFX/ambience services.

Approved scope:

- Decide whether generation state remains local-only, becomes backend job-driven, or first routes through a mock generation bridge.
- Define how generated asset metadata should connect to preview-layer slots without breaking the `AsmrProject` export contract.
- Decide the boundary between durable project data, ephemeral queued/job state, and eventual generated file references.
- Preserve the existing preview layer, Timeline status signals, Inspector `素材槽`, validation, persistence, import, export, reset, C+ workspace layout, independent side collapse, and concise Chinese UI copy.
- Avoid adding backend persistence, auth, collaboration, real generation, or full audio export during the design step.

Do not jump directly to real TTS/SFX/ambience generation yet.

## Initial Product Path

This is the current early roadmap. Treat it as directional, not a rigid release contract.

1. Field-level validation highlighting: completed for selected Clip Inspector fields while keeping the global Validation Panel.
2. Light timeline editing: completed for selected clip start/duration nudges without building a full DAW.
3. Project structure upgrade: completed as the C+ collapsible project workspace with left project rail, top status header, center editor, right project details dock, and focused editing mode.
4. Preview layer before real audio: completed as the C hybrid lightweight preview layer with disabled playback, fake waveform/status strip, preview counts, generation slots, Timeline status dots, and Inspector `素材槽`.
5. Real generation chain: next design target; first design the generation integration contract and state model, then later introduce real TTS/SFX/ambience generation, listening, regeneration, and export.

The key sequencing rule: keep strengthening the editable Timeline DSL and director workflow before connecting expensive or brittle audio generation.

## Next Work Protocol

When the user asks "what next?", "what should we do now?", "理论上下一步是什么？", or any equivalent roadmap question, do not answer from fresh intuition alone.

First read this file, then do a fresh project reality check before recommending work. At minimum, check current git status/recent commits and inspect the relevant files or app behavior when the route depends on implementation details.

Answer from `Recommended Next Work`, `Initial Product Path`, and current project reality using this shape:

```text
Documented path points to:
Current project reality check:
Already done:
Recommended next step:
Route adjustment needed?:
Why not the other options yet:
Needed doc/plan/implementation step:
```

If the documented path feels stale, conflicts with current implementation, or the implementation work reveals a design gap, say that explicitly and propose a documentation update before changing direction. Do not silently replace the roadmap with a newly invented one, and do not blindly follow stale roadmap steps when current project facts show they need revision.

## Do Not Do Yet

Do not jump straight into:

- Real TTS.
- Real SFX generation.
- Backend job queues.
- Real waveform rendering from generated audio.
- Full DAW drag/drop timeline.
- User accounts or cloud sync.
- Payment or publishing flows.

Those are later versions. The near-term path should keep proving the editable Timeline DSL and director workflow.

## Working Rules For Future Agents

- Prefer existing schema and helpers over ad hoc object manipulation.
- Keep Project Workspace, Storyboard, Timeline, Inspector, Validation Panel, Project Details Dock, and Export JSON driven by the same `AsmrProject` state.
- Use TDD for behavior changes in `apps/web/src/lib/asmr/`.
- After meaningful UI changes, run browser verification at desktop and mobile widths.
- Preserve the Studio Console visual direction: professional tool first, restrained ASMR atmosphere second.
- Keep docs updated when changing product direction, data contracts, or next-step recommendations.
- For new approved specs, keep the English spec and add a Chinese companion `*.zh.md` version.
- Treat roadmap questions as document-synchronized and project-synchronized work: check `Recommended Next Work`, `Initial Product Path`, `Next Work Protocol`, and current repo/app reality before recommending the next task.
