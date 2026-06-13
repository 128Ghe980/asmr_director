# V0.2 Editing Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first V0.2 editing loop so selected clips can be edited in the Inspector, reflected across the studio UI, validated live, and exported as updated JSON.

**Architecture:** Keep source-of-truth project state in `StudioApp`. Add pure helpers under `apps/web/src/lib/asmr/` for immutable clip updates and project validation summaries. Keep UI components controlled and presentational so Storyboard, Timeline, Inspector, and export all read the same project object.

**Tech Stack:** Next.js App Router, React client state, TypeScript, Tailwind CSS, Zod, Vitest.

---

## File Structure

- Create: `apps/web/src/lib/asmr/edit-project.ts`  
  Pure immutable project update helpers.

- Create: `apps/web/src/lib/asmr/edit-project.test.ts`  
  TDD coverage for updating clip fields and validation summaries.

- Modify: `apps/web/src/components/studio/studio-app.tsx`  
  Own local project state, compute validation issues, pass editing callbacks, export current state.

- Modify: `apps/web/src/components/studio/clip-inspector.tsx`  
  Render controlled edit fields for selected clip and call `onUpdateClip`.

- Create: `apps/web/src/components/studio/validation-panel.tsx`  
  Compact validation status panel for project validity or issue list.

- Modify: `docs/project-archive.md`  
  Add a short V0.2 progress note after implementation succeeds.

## Task 1: Add Pure Editing Helpers

**Files:**
- Create: `apps/web/src/lib/asmr/edit-project.test.ts`
- Create: `apps/web/src/lib/asmr/edit-project.ts`

- [ ] **Step 1: Write failing tests**

Create tests that import `demoProject`, `updateClipInProject`, and `getProjectValidationIssues`. Cover voice text updates, nested position updates, missing clip ids, and validation errors.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: FAIL because `./edit-project` does not exist.

- [ ] **Step 3: Implement minimal helpers**

Implement:

- `ClipPatch`
- `updateClipInProject(project, clipId, patch)`
- `getProjectValidationIssues(project)`

The update helper should clone only the updated track and clip path. The validation helper should return an array of `{ path, message }`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: PASS.

## Task 2: Wire Local Project State

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Create: `apps/web/src/components/studio/validation-panel.tsx`

- [ ] **Step 1: Change StudioApp state**

Use `useState(() => initialProject)` and render all panels from `project`.

- [ ] **Step 2: Add update callback**

Add `handleUpdateClip(clipId, patch)` that calls `setProject((current) => updateClipInProject(current, clipId, patch))`.

- [ ] **Step 3: Export current project**

Make export use local `project`, not initial props.

- [ ] **Step 4: Add validation panel**

Render project validity under the timeline area with `getProjectValidationIssues(project)`.

## Task 3: Make Inspector Editable

**Files:**
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`

- [ ] **Step 1: Add editing props**

Accept `onUpdateClip: (clipId, patch) => void`.

- [ ] **Step 2: Add shared controls**

Add inputs/selects for `start`, `duration`, `volume_db`, `pan`, `distance`, and `movement`.

- [ ] **Step 3: Add type-specific controls**

Add text inputs for voice/breath/sfx/ambience fields and checkbox for ambience `loop`.

- [ ] **Step 4: Preserve compact Studio Console styling**

Use existing border, panel, text, and spacing tokens. Keep controls readable on mobile and desktop.

## Task 4: Verify And Commit

**Files:**
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Update archive**

Record that V0.2 editing loop has started and list implemented pieces.

- [ ] **Step 2: Run verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: tests, lint, and build pass. The known local SWC warning may appear during build while webpack/WASM succeeds.

- [ ] **Step 3: Browser verification**

Open `http://localhost:3000` and verify:

- Editing voice text updates Storyboard and Inspector.
- Editing time changes Timeline block position or width.
- Invalid time values show validation errors without crashing.
- Export button still works.

- [ ] **Step 4: Commit**

Commit the docs and code:

```powershell
git add docs apps/web/src
git commit -m "feat: add v0 editing loop"
```
