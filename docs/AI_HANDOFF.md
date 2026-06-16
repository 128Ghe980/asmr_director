# AI ASMR Studio Handoff

Last updated: 2026-06-17

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
- `专注编辑` collapses both side regions together; clicking it again restores the prior workspace shape.
- Keeps project-level operations `导出`, `载入`, and `重置` in the workspace header.
- Allows selecting clips from Storyboard or Timeline.
- Allows editing selected clip fields in Inspector.
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

Current status is frontend-only. There is no backend, real audio generation, audio playback, waveform rendering, TTS, SFX generation, cloud persistence, auth, billing, or collaboration.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/components/studio/studio-app.tsx` owns local editable project state and wires export, import, autosave, reset, validation, selected clip state, and director preset application.
- `apps/web/src/components/studio/project-workspace.tsx` composes the C+ workspace shell around the editor panels.
- `apps/web/src/components/studio/project-workspace-header.tsx` shows workspace status, project summary, focus controls, and project-level `导出` / `载入` / `重置` actions.
- `apps/web/src/components/studio/project-rail.tsx` renders the collapsible left project rail.
- `apps/web/src/components/studio/project-details-dock.tsx` renders the collapsible right project details dock.
- `apps/web/src/components/studio/project-workspace-badge.tsx` provides compact workspace badge display helpers.
- `apps/web/src/components/studio/storyboard-panel.tsx` renders chronological clip cards.
- `apps/web/src/components/studio/timeline-panel.tsx` renders fixed track timeline blocks.
- `apps/web/src/components/studio/clip-inspector.tsx` edits selected clip fields, displays field-level validation state, and exposes compact timing actions.
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

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/director-presets.test.ts`
- `apps/web/src/lib/asmr/ui-copy.test.ts`
- `apps/web/src/lib/asmr/project-summary.test.ts`

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
npm.cmd run build --prefix apps/web -- --webpack
```

Latest verified state before this handoff:

- 7 test files passed.
- 55 tests passed.
- lint passed.
- build passed.
- Build may emit the known local warning: `@next/swc-win32-x64-msvc ... is not a valid Win32 application`; webpack/WASM still completes successfully.
- Browser verification passed for the C+ Project Shell: default desktop around 1259px, `专注编辑`, independent left/right collapse, invalid import plus reset, 1024px, and 390px mobile all had no document-level horizontal overflow.
- Export button click was verified with no console error. Codex in-app browser does not support the download event, so download-to-disk could not be confirmed via that event.

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

Recommended next step: **preview layer before real audio**.

Why this next: the C+ Project Shell is now in place and has reserved product space for a preview layer, but the preview experience is still placeholder-only. Before connecting real TTS/SFX/audio generation, the app should make playback state, waveform/status surfaces, and generation slots feel coherent inside the local-first director workflow.

Approved scope:

- Add explicit placeholder playback states without pretending real audio exists.
- Add waveform/status UI surfaces that can later bind to generated audio metadata.
- Add generation slots for clips/tracks so users can see what is pending, ready, failed, or queued.
- Keep state local-first and continue using the single `AsmrProject` source of truth.
- Preserve editing, validation, persistence, import, export, reset, C+ workspace layout, and concise Chinese UI copy.
- Avoid adding backend persistence, auth, collaboration, real generation, or full audio export yet.

Do not jump to real TTS/audio generation yet.

## Initial Product Path

This is the current early roadmap. Treat it as directional, not a rigid release contract.

1. Field-level validation highlighting: completed for selected Clip Inspector fields while keeping the global Validation Panel.
2. Light timeline editing: completed for selected clip start/duration nudges without building a full DAW.
3. Project structure upgrade: completed as the C+ collapsible project workspace with left project rail, top status header, center editor, right project details dock, and focused editing mode.
4. Preview layer before real audio: next; add placeholder playback states, waveform/status surfaces, and generation slots so the workflow feels ready for audio without pretending real audio exists.
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
