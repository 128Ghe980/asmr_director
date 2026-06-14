# V0.2 Project Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project import, browser autosave/restore, reset demo, and visible project dirty/restored state to the V0.2 studio.

**Architecture:** Keep persistence and import parsing in pure helpers under `apps/web/src/lib/asmr/`, tested with Vitest before UI wiring. `StudioApp` owns project state and calls browser storage only from client-side effects. A compact `ProjectControls` component handles paste/import/reset UI and reports import errors without replacing the current project on failure.

**Tech Stack:** Next.js App Router, React client state/effects, TypeScript, Tailwind CSS, Zod, Vitest, browser `localStorage`.

---

## File Structure

- Create: `apps/web/src/lib/asmr/project-persistence.ts`  
  Pure helpers for serialization, import parsing, storage reads, and storage writes.

- Create: `apps/web/src/lib/asmr/project-persistence.test.ts`  
  TDD coverage for parse/import/storage behavior.

- Create: `apps/web/src/components/studio/project-controls.tsx`  
  UI for import JSON, reset demo, and project state indicators.

- Modify: `apps/web/src/components/studio/studio-app.tsx`  
  Load saved project after mount, autosave edits, wire import/reset callbacks, and pass status to controls.

- Modify: `docs/project-archive.md`  
  Record V0.2 persistence progress after implementation succeeds.

## Task 1: Add Persistence Helpers

**Files:**
- Create: `apps/web/src/lib/asmr/project-persistence.test.ts`
- Create: `apps/web/src/lib/asmr/project-persistence.ts`

- [ ] **Step 1: Write failing tests**

Create tests for `parseImportedProject`, `serializeProject`, `loadSavedProject`, and `saveProject`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-persistence.test.ts
```

Expected: FAIL because `./project-persistence` does not exist.

- [ ] **Step 3: Implement minimal helpers**

Implement:

- `PROJECT_STORAGE_KEY`
- `serializeProject(project)`
- `parseImportedProject(text)`
- `loadSavedProject(storage, fallbackProject)`
- `saveProject(storage, project)`
- `clearSavedProject(storage)`

Use the existing schema validation path. Return discriminated union results rather than throwing for user-controlled import text.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-persistence.test.ts
```

Expected: PASS.

## Task 2: Add Project Controls UI

**Files:**
- Create: `apps/web/src/components/studio/project-controls.tsx`

- [ ] **Step 1: Create controlled component**

Props:

- `isDirty: boolean`
- `restoreState: "demo" | "restored"`
- `importError: string | undefined`
- `onImportJson(text: string): void`
- `onResetDemo(): void`

- [ ] **Step 2: Add textarea and buttons**

Use a textarea for pasted JSON, a `Load JSON` button, and a `Reset Demo` button. Keep styling aligned with Studio Console panels.

- [ ] **Step 3: Display import errors**

Show import errors in a compact warning block without disrupting validation panel layout.

## Task 3: Wire Persistence Into StudioApp

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`

- [ ] **Step 1: Load saved project after mount**

Use an effect to load from `window.localStorage`. Track restore state as `demo` or `restored`.

- [ ] **Step 2: Autosave project changes**

Use an effect to save current project after hydration has completed.

- [ ] **Step 3: Wire import**

Parse JSON with `parseImportedProject`. On success, replace current project and clear import error. On failure, keep current project and show error.

- [ ] **Step 4: Wire reset**

Restore the initial demo project, clear localStorage, clear import error, and mark restore state as demo.

- [ ] **Step 5: Render ProjectControls**

Place it near `ValidationPanel` in the center column.

## Task 4: Verify, Document, Commit

**Files:**
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Update archive**

Record the persistence/import/reset behavior and verification results.

- [ ] **Step 2: Run verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: tests, lint, and build pass. The known local SWC warning may appear during build while webpack/WASM succeeds.

- [ ] **Step 3: Browser verification**

Verify:

- Edit text, reload, edited text persists.
- Reset Demo restores original text and survives reload.
- Import valid JSON changes project state.
- Import invalid JSON shows an error and keeps current state.
- Export JSON contains current state.

- [ ] **Step 4: Commit**

Commit:

```powershell
git add docs apps/web/src
git commit -m "feat: persist studio projects locally"
```
