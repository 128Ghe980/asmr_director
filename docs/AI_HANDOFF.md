# AI ASMR Studio Handoff

Last updated: 2026-06-16

Read this first when resuming the project after context compaction or as a new AI agent. This file is the high-signal handoff. For history and rationale, read `docs/project-archive.md`.

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

Current status is frontend-only. There is no backend, real audio generation, audio playback, waveform rendering, TTS, SFX generation, cloud persistence, auth, billing, or collaboration.

## Architecture Map

Core app:

- `apps/web/src/app/page.tsx` renders the studio with `demoProject`.
- `apps/web/src/components/studio/studio-app.tsx` owns local editable project state and wires export, import, autosave, reset, validation, and selected clip state.
- `apps/web/src/components/studio/project-header.tsx` shows project context and Export JSON.
- `apps/web/src/components/studio/storyboard-panel.tsx` renders chronological clip cards.
- `apps/web/src/components/studio/timeline-panel.tsx` renders fixed track timeline blocks.
- `apps/web/src/components/studio/clip-inspector.tsx` edits selected clip fields.
- `apps/web/src/components/studio/validation-panel.tsx` shows live schema issues.
- `apps/web/src/components/studio/project-controls.tsx` handles paste-import, reset, and Demo/Edited/Restored state.

Domain/data:

- `apps/web/src/lib/asmr/schema.ts` defines the Zod schema and TypeScript types for ASMR Project JSON / Timeline DSL.
- `apps/web/src/lib/asmr/mock-project.ts` is the canonical "雨夜睡前陪伴" demo project.
- `apps/web/src/lib/asmr/validate.ts` wraps schema parsing and clip flattening.
- `apps/web/src/lib/asmr/view-model.ts` contains display helpers.
- `apps/web/src/lib/asmr/edit-project.ts` contains immutable clip update helpers and validation issue formatting.
- `apps/web/src/lib/asmr/project-persistence.ts` contains import parsing, JSON serialization, and localStorage helpers.

Tests:

- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/view-model.test.ts`
- `apps/web/src/lib/asmr/edit-project.test.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`

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

- 4 test files passed.
- 24 tests passed.
- lint passed.
- build passed.
- Build may emit the known local warning: `@next/swc-win32-x64-msvc ... is not a valid Win32 application`; webpack/WASM still completes successfully.

Run locally:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

Open:

```text
http://localhost:3000/
```

## Recent Commit Trail

Most recent feature commits:

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

Recommended next step: **V0.2 director action presets**.

Build small action buttons for selected voice clips:

- "更温柔"
- "更贴耳"
- "换左耳"
- "换右耳"
- "加停顿"
- "更小声"

For now these should be deterministic local edits, not real AI regeneration. They should update DSL fields through existing edit helpers, remain schema-validated, autosave, and export correctly.

Why this next: the app already edits raw fields and persists projects. Preset actions will make it feel like an ASMR director tool rather than a form editor.

Suggested implementation shape:

- Add a pure helper in `apps/web/src/lib/asmr/` for applying director presets to a clip.
- Write tests first.
- Add a compact action strip inside or near `ClipInspector`.
- Keep actions disabled or hidden for non-voice clips unless there is a clear deterministic behavior.

## Do Not Do Yet

Do not jump straight into:

- Real TTS.
- Real SFX generation.
- Backend job queues.
- Waveform rendering.
- Full DAW drag/drop timeline.
- User accounts or cloud sync.
- Payment or publishing flows.

Those are later versions. V0.2 should keep proving the editable Timeline DSL and director workflow.

## Working Rules For Future Agents

- Prefer existing schema and helpers over ad hoc object manipulation.
- Keep Storyboard, Timeline, Inspector, Validation Panel, Project Controls, and Export JSON driven by the same `AsmrProject` state.
- Use TDD for behavior changes in `apps/web/src/lib/asmr/`.
- After meaningful UI changes, run browser verification at desktop and mobile widths.
- Preserve the Studio Console visual direction: professional tool first, restrained ASMR atmosphere second.
- Keep docs updated when changing product direction, data contracts, or next-step recommendations.
