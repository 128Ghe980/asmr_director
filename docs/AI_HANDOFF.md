# AI ASMR Studio Handoff

Last updated: 2026-06-16

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
- Shows Studio Console UI: Project Header, Storyboard, Timeline, Emotion Curve, Clip Inspector, Validation Panel, Project Controls.
- Allows selecting clips from Storyboard or Timeline.
- Allows editing selected clip fields in Inspector.
- Syncs edits across Storyboard, Timeline, Inspector, Validation Panel, and Export JSON.
- Validates current project live via Zod schema.
- Exports current project JSON.
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

Current status is frontend-only. There is no backend, real audio generation, audio playback, waveform rendering, TTS, SFX generation, cloud persistence, auth, billing, or collaboration.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/components/studio/studio-app.tsx` owns local editable project state and wires export, import, autosave, reset, validation, selected clip state, and director preset application.
- `apps/web/src/components/studio/project-header.tsx` shows project context and Export JSON.
- `apps/web/src/components/studio/storyboard-panel.tsx` renders chronological clip cards.
- `apps/web/src/components/studio/timeline-panel.tsx` renders fixed track timeline blocks.
- `apps/web/src/components/studio/clip-inspector.tsx` edits selected clip fields, displays field-level validation state, and exposes compact timing actions.
- `apps/web/src/components/studio/validation-panel.tsx` shows live schema issues.
- `apps/web/src/components/studio/project-controls.tsx` handles paste-import, reset, and Demo/Edited/Restored state.

Domain/data:

- `apps/web/src/lib/asmr/schema.ts` defines the Zod schema and TypeScript types for ASMR Project JSON / Timeline DSL.
- `apps/web/src/lib/asmr/mock-project.ts` is the canonical "雨夜睡前陪伴" demo project.
- `apps/web/src/lib/asmr/validate.ts` wraps schema parsing and clip flattening.
- `apps/web/src/lib/asmr/view-model.ts` contains display helpers.
- `apps/web/src/lib/asmr/ui-copy.ts` contains shared Chinese UI labels and validation-message translations.
- `apps/web/src/lib/asmr/edit-project.ts` contains immutable clip update helpers, selected-clip timing nudges, validation issue formatting, and selected-clip field issue mapping.
- `apps/web/src/lib/asmr/project-persistence.ts` contains import parsing, JSON serialization, and localStorage helpers.
- `apps/web/src/lib/asmr/director-presets.ts` contains deterministic Director Action preset behavior for voice clips.

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/director-presets.test.ts`
- `apps/web/src/lib/asmr/ui-copy.test.ts`

Docs:

- `docs/project-archive.md` is the running project archive.
- `docs/asmr导演早期设计.md` is the original product/technical vision.
- `docs/superpowers/specs/` contains approved specs.
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
npm.cmd run build --prefix apps/web -- --webpack
```

Latest verified state before this handoff:

- 6 test files passed.
- 51 tests passed.
- lint passed.
- build passed.
- Build may emit the known local warning: `@next/swc-win32-x64-msvc ... is not a valid Win32 application`; webpack/WASM still completes successfully.
- Browser verification passed via local Chrome CDP fallback. Verified: core visible UI copy and button labels are Chinese, old English control labels are absent, schema errors render in Chinese, and desktop 1440px plus mobile 390px viewports have no document-level horizontal overflow.

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

Recommended next step: **project structure upgrade**.

Why this next: the app can now edit raw fields, apply director intent presets, persist/import projects, show field-level validation feedback, and perform small timing operations without raw number entry. The next layer should make the app feel like a durable project workspace rather than a single embedded demo.

Suggested scope:

- Add a clearer project shell for current project metadata, status, and future project-list affordances.
- Keep state local-first and continue using the single `AsmrProject` source of truth.
- Preserve the current Studio Console layout while making room for future project list/import/export workflows.
- Avoid adding backend persistence, auth, collaboration, or real generation yet.

Do not jump to real TTS/audio generation yet.

## Initial Product Path

This is the current early roadmap. Treat it as directional, not a rigid release contract.

1. Field-level validation highlighting: completed for selected Clip Inspector fields while keeping the global Validation Panel.
2. Light timeline editing: completed for selected clip start/duration nudges without building a full DAW.
3. Project structure upgrade: next; add a clearer project shell, metadata, and room for a future project list while keeping local-first state.
4. Preview layer before real audio: add placeholder playback states, waveform/status surfaces, and generation slots so the workflow feels ready for audio without pretending real audio exists.
5. Real generation chain: only after the director workflow feels stable, introduce real TTS/SFX generation, listening, regeneration, and export.

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
- Waveform rendering.
- Full DAW drag/drop timeline.
- User accounts or cloud sync.
- Payment or publishing flows.

Those are later versions. The near-term path should keep proving the editable Timeline DSL and director workflow.

## Working Rules For Future Agents

- Prefer existing schema and helpers over ad hoc object manipulation.
- Keep Storyboard, Timeline, Inspector, Validation Panel, Project Controls, and Export JSON driven by the same `AsmrProject` state.
- Use TDD for behavior changes in `apps/web/src/lib/asmr/`.
- After meaningful UI changes, run browser verification at desktop and mobile widths.
- Preserve the Studio Console visual direction: professional tool first, restrained ASMR atmosphere second.
- Keep docs updated when changing product direction, data contracts, or next-step recommendations.
- Treat roadmap questions as document-synchronized and project-synchronized work: check `Recommended Next Work`, `Initial Product Path`, `Next Work Protocol`, and current repo/app reality before recommending the next task.
