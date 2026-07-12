# Product Workflow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local-first multi-project, revision, real-waveform, and quality-check workflow on top of the completed real generation and mix pipeline.

**Architecture:** Keep `AsmrProject` unchanged and store project-library metadata in a versioned browser-storage envelope. Add pure library and quality helpers, add a Node API that analyzes local durable WAV assets, then wire those capabilities into the existing collapsible rail, Preview Layer, and details dock.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Vitest, Tailwind CSS, Lucide React.

## Global Constraints

- Keep the product local-first and keep audio bytes under `D:\CodexWorkplace\asmr_director_runtime`.
- Do not add cloud persistence, accounts, billing, publishing, or collaboration.
- Do not add library, revision, waveform, or runtime-analysis fields to `AsmrProject`.
- Accept only `asset://clip/...` and `asset://mix/...` in the analysis API.
- Keep both side regions independently collapsible and preserve the center Timeline width.
- Use short Chinese UI copy and Lucide icons.
- Retain at most 12 revisions per project and show at most 5 in the dock.

---

### Task 1: Versioned local project library

**Files:**
- Create: `apps/web/src/lib/asmr/project-library.ts`
- Create: `apps/web/src/lib/asmr/project-library.test.ts`
- Modify: `apps/web/src/lib/asmr/project-persistence.ts`
- Modify: `apps/web/src/lib/asmr/project-persistence.test.ts`

**Interfaces:**
- Produces: `ProjectLibrary`, `ProjectLibraryEntry`, `ProjectRevision`, and `ProjectLibrarySummary` types.
- Produces: `loadProjectLibrary(storage, fallbackProject, now?)`, `saveProjectToLibrary(storage, library)`, `updateLibraryProject(library, project, now?)`, `selectLibraryProject(library, projectId)`, `createLibraryProject(library, template, now?)`, `duplicateLibraryProject(library, projectId, now?)`, `deleteLibraryProject(library, projectId)`, `createProjectRevision(library, projectId, now?, label?)`, and `restoreProjectRevision(library, projectId, revisionId, now?)`.
- Consumes: existing `parseImportedProject`, `serializeProject`, and legacy `PROJECT_STORAGE_KEY` behavior.

- [ ] **Step 1: Write failing library tests**

Cover legacy-key migration, invalid-record recovery, current-project selection, new project asset clearing, duplicate IDs, delete-last protection, revision deduplication, 12-item retention, and restore safety revision.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd run test --prefix apps/web -- src/lib/asmr/project-library.test.ts src/lib/asmr/project-persistence.test.ts`

Expected: FAIL because project-library exports and library migration do not exist.

- [ ] **Step 3: Implement the minimal library**

Use a `version: 1` JSON envelope. Validate every stored project with `safeParseAsmrProject`; discard invalid entries. Generate IDs from a sanitized project ID plus a compact UTC timestamp and collision suffix. Clean new-project clips to `asset_pending` with null assets and reset exports to `not_started`.

- [ ] **Step 4: Verify GREEN**

Run the focused test command and expect all library/persistence tests to pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add local project library and revisions`

### Task 2: Real WAV analysis API

**Files:**
- Create: `apps/web/src/lib/asmr/audio-analysis.ts`
- Create: `apps/web/src/lib/asmr/audio-analysis.test.ts`
- Create: `apps/web/src/app/api/assets/analysis/route.ts`
- Create: `apps/web/src/app/api/assets/analysis/route.test.ts`

**Interfaces:**
- Produces: `AudioAnalysis` with `bars`, `duration`, `sampleRate`, `channels`, `peakDbfs`, `rmsDbfs`, and `clippedSampleCount`.
- Produces: `analyzeDecodedPcm(audio, barCount)` and `analyzePcmWav(bytes, barCount)`.
- Route consumes query parameters `uri` and optional `bars` (16 through 160) and returns `{ analysis }`.

- [ ] **Step 1: Write failing analysis tests**

Create deterministic mono and stereo PCM fixtures with `writePcm16MonoWav` / `writePcm16StereoWav`. Assert bar count, duration, channels, sample rate, peak/RMS tolerance, silence handling, and clipping count.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd run test --prefix apps/web -- src/lib/asmr/audio-analysis.test.ts src/app/api/assets/analysis/route.test.ts`

Expected: FAIL because analysis functions and route do not exist.

- [ ] **Step 3: Implement analysis and route**

Decode with `decodePcmWav`, calculate absolute per-window peaks across channels, normalize display bars against the file peak while retaining absolute technical metrics, and clamp silence bars to zero. Resolve only safe local asset URIs through existing asset-store helpers. Return 400 for invalid input, 404 for missing assets, and 422 for unsupported WAV content.

- [ ] **Step 4: Verify GREEN**

Run the focused test command and expect all analysis/route tests to pass.

- [ ] **Step 5: Commit**

Commit message: `feat: analyze real local wav assets`

### Task 3: Product quality report

**Files:**
- Create: `apps/web/src/lib/asmr/product-quality.ts`
- Create: `apps/web/src/lib/asmr/product-quality.test.ts`

**Interfaces:**
- Consumes: `AsmrProject`, schema issue count, current project-mix fingerprint state, and optional `AudioAnalysis` / analysis error.
- Produces: `ProductQualityReport` with ordered `checks`, `passCount`, `warningCount`, `blockerCount`, and `overallTone`.
- Produces: `getProductQualityReport(input)`.

- [ ] **Step 1: Write failing quality-report tests**

Cover schema blockers, missing clip assets, missing mix, stale mix, current stereo mix, mono warning, unavailable analysis warning, near-zero headroom warning, and clipped-sample blocker.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd run test --prefix apps/web -- src/lib/asmr/product-quality.test.ts`

Expected: FAIL because the report helper does not exist.

- [ ] **Step 3: Implement the report**

Use stable check IDs (`schema`, `assets`, `mix`, `analysis`, `channels`, `headroom`). Treat schema errors, missing assets, missing/currently stale mix, and actual clipping as blockers; mono, unavailable analysis, and peak above `-0.5 dBFS` without clipping as warnings.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test; commit as `feat: add project quality report`.

### Task 4: Wire library, revisions, waveform, and quality UI

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Modify: `apps/web/src/components/studio/project-workspace.tsx`
- Modify: `apps/web/src/components/studio/project-rail.tsx`
- Modify: `apps/web/src/components/studio/project-details-dock.tsx`
- Modify: `apps/web/src/components/studio/preview-layer-panel.tsx`
- Replace responsibility in: `apps/web/src/components/studio/preview-waveform-placeholder.tsx`
- Create: `apps/web/src/components/studio/project-quality-panel.tsx`
- Create: `apps/web/src/components/studio/project-version-panel.tsx`

**Interfaces:**
- `StudioApp` owns loaded `ProjectLibrary`, selected project, runtime audio-analysis state, and all library/revision actions.
- `ProjectRail` receives library summaries plus create, duplicate, switch, and delete callbacks.
- `PreviewLayerPanel` receives real waveform analysis state and renders a truthful label.
- `ProjectDetailsDock` receives `ProductQualityReport`, recent revisions, create-version, and restore callbacks.

- [ ] **Step 1: Load the library and preserve autosave**

Replace single-project boot/save calls with library boot and selected-entry updates. Keep storage exceptions non-fatal. End generation and audio playback before switching, deleting, importing-over, resetting, or restoring.

- [ ] **Step 2: Implement project rail actions**

Render compact project rows with selected state, relative update label, and version count. Add icon actions `新建`, `复制`, and contextual delete. Disable deletion when only one project remains.

- [ ] **Step 3: Fetch and render real waveform**

Resolve the preferred durable URI from current mix then selected clip. Fetch `/api/assets/analysis`, guard stale responses with an abort controller, and show loading/unavailable/real labels. Keep deterministic placeholder bars only when no real asset exists.

- [ ] **Step 4: Render quality and version panels**

Show short status rows with pass/warn/block tones. Add `留版本` and up to five `恢复` actions. Keep sections compact and un-nested.

- [ ] **Step 5: Run test, lint, and build**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: zero failed tests, lint exit 0, build exit 0.

- [ ] **Step 6: Commit**

Commit message: `feat: harden local product workflow`

### Task 5: Browser acceptance, records, and branch completion

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Start the app and browser-check the workflow**

Verify desktop and narrow layouts, project create/switch/duplicate/delete, revision create/restore, real waveform on an existing WAV, quality statuses, both side collapses, playback/download, and no console errors.

- [ ] **Step 2: Re-run full verification after any browser fixes**

Run full test, lint, build, and `git diff --check` fresh.

- [ ] **Step 3: Update project truth**

Mark Step 10 complete only if all local acceptance criteria pass. Explicitly record cloud/account/billing/publishing/collaboration as post-roadmap deployment/product expansion rather than implemented capabilities. Update handoff branch/state and archive the decisions and verification evidence.

- [ ] **Step 4: Review and commit records**

Check docs for contradictions with current code, then commit as `docs: record product workflow hardening`.

- [ ] **Step 5: Push the branch**

Push `codex/step10-product-workflow` using the repository-specific SSH-over-443 key if GitHub HTTPS remains unreachable.
