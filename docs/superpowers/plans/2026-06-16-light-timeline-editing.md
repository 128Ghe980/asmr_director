# Light Timeline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selected-clip start/duration nudge actions that update the local Timeline DSL and immediately reflect in Inspector, Storyboard, Timeline, validation, and export state.

**Architecture:** Keep timing math in a pure helper in `apps/web/src/lib/asmr/edit-project.ts`, tested with Vitest. `StudioApp` owns the action handler and passes it into `ClipInspector`, which renders compact Timing Actions beside the existing raw numeric fields.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Zod, Vitest.

---

## File Structure

- Modify: `apps/web/src/lib/asmr/edit-project.ts`
  - Add `ClipTimingNudge` and `nudgeClipTiming`.
- Modify: `apps/web/src/lib/asmr/edit-project.test.ts`
  - Add TDD coverage for start/duration nudges, clamps, validation handoff, and missing clip behavior.
- Modify: `apps/web/src/components/studio/studio-app.tsx`
  - Add `handleNudgeClipTiming` and pass it to `ClipInspector`.
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`
  - Add compact Timing Actions controls near Start/Duration.
- Modify after implementation: `docs/AI_HANDOFF.md`
  - Record the new capability, verification, commits, and next recommendation.
- Modify after implementation: `docs/project-archive.md`
  - Archive the light timeline editing progress.

## Task 1: Timing Nudge Helper

**Files:**
- Modify: `apps/web/src/lib/asmr/edit-project.test.ts`
- Modify: `apps/web/src/lib/asmr/edit-project.ts`

- [x] **Step 1: Write failing tests**

Add these imports in `apps/web/src/lib/asmr/edit-project.test.ts`:

```ts
import {
  getClipFieldValidationIssues,
  getProjectValidationIssues,
  nudgeClipTiming,
  updateClipInProject,
} from "./edit-project";
```

Add these tests inside `describe("edit project helpers", () => { ... })`:

```ts
it("nudges clip start by the requested delta", () => {
  const updated = nudgeClipTiming(demoProject, "voice_001", {
    field: "start",
    delta: 0.5,
  });

  const voiceTrack = updated.timeline.tracks.find(
    (track) => track.track_type === "voice",
  );

  expect(voiceTrack?.clips[0].start).toBe(16.5);
});

it("clamps nudged clip start at zero", () => {
  const updated = nudgeClipTiming(demoProject, "ambience_rain_001", {
    field: "start",
    delta: -0.5,
  });

  const ambienceTrack = updated.timeline.tracks.find(
    (track) => track.track_type === "ambience",
  );

  expect(ambienceTrack?.clips[0].start).toBe(0);
});

it("nudges clip duration by the requested delta", () => {
  const updated = nudgeClipTiming(demoProject, "voice_001", {
    field: "duration",
    delta: 0.5,
  });

  const voiceTrack = updated.timeline.tracks.find(
    (track) => track.track_type === "voice",
  );

  expect(voiceTrack?.clips[0].duration).toBe(8);
});

it("clamps nudged clip duration at the minimum editor step", () => {
  const shortened = updateClipInProject(demoProject, "voice_001", {
    duration: 0.2,
  });
  const updated = nudgeClipTiming(shortened, "voice_001", {
    field: "duration",
    delta: -0.5,
  });

  const voiceTrack = updated.timeline.tracks.find(
    (track) => track.track_type === "voice",
  );

  expect(voiceTrack?.clips[0].duration).toBe(0.1);
});

it("lets validation report nudges beyond project duration", () => {
  const updated = nudgeClipTiming(demoProject, "voice_004", {
    field: "duration",
    delta: 30,
  });

  const issues = getProjectValidationIssues(updated);
  const fieldIssues = getClipFieldValidationIssues(
    updated,
    "voice_004",
    issues,
  );

  expect(fieldIssues.duration).toEqual([
    {
      path: "timeline.tracks.0.clips.3.duration",
      message: "clip end must be within project duration",
    },
  ]);
});

it("returns the same project when nudging a missing clip", () => {
  const updated = nudgeClipTiming(demoProject, "missing_clip", {
    field: "start",
    delta: 0.5,
  });

  expect(updated).toBe(demoProject);
});
```

- [x] **Step 2: Run tests to verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: fail because `nudgeClipTiming` is not exported.

- [x] **Step 3: Implement timing nudge helper**

Add to `apps/web/src/lib/asmr/edit-project.ts`:

```ts
const TIMING_STEP_SECONDS = 0.1;

export type ClipTimingNudge =
  | { field: "start"; delta: number }
  | { field: "duration"; delta: number };

function roundToTimingStep(value: number): number {
  return Number(
    (Math.round(value / TIMING_STEP_SECONDS) * TIMING_STEP_SECONDS).toFixed(1),
  );
}

function findClip(project: AsmrProject, clipId: string): TimelineClip | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);

    if (clip) {
      return clip;
    }
  }

  return undefined;
}

export function nudgeClipTiming(
  project: AsmrProject,
  clipId: string,
  nudge: ClipTimingNudge,
): AsmrProject {
  const clip = findClip(project, clipId);

  if (!clip) {
    return project;
  }

  if (nudge.field === "start") {
    return updateClipInProject(project, clipId, {
      start: Math.max(0, roundToTimingStep(clip.start + nudge.delta)),
    });
  }

  return updateClipInProject(project, clipId, {
    duration: Math.max(
      TIMING_STEP_SECONDS,
      roundToTimingStep(clip.duration + nudge.delta),
    ),
  });
}
```

- [x] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: all `edit-project.test.ts` tests pass.

- [x] **Step 5: Commit helper**

Run:

```powershell
git add apps/web/src/lib/asmr/edit-project.ts apps/web/src/lib/asmr/edit-project.test.ts
git commit -m "feat: add clip timing nudges"
```

## Task 2: Inspector Timing Actions UI

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`

- [ ] **Step 1: Wire timing nudge handler**

In `apps/web/src/components/studio/studio-app.tsx`, import `ClipTimingNudge` and `nudgeClipTiming`:

```ts
import {
  getClipFieldValidationIssues,
  getProjectValidationIssues,
  nudgeClipTiming,
  updateClipInProject,
  type ClipPatch,
  type ClipTimingNudge,
} from "@/lib/asmr/edit-project";
```

Add handler:

```ts
function handleNudgeClipTiming(clipId: string, nudge: ClipTimingNudge) {
  setEditableProject((currentProject) =>
    nudgeClipTiming(currentProject, clipId, nudge),
  );
  setImportError(undefined);
}
```

Pass to `ClipInspector`:

```tsx
<ClipInspector
  fieldValidationIssues={selectedClipValidationIssues}
  selectedClip={selectedClip}
  onApplyDirectorPreset={handleApplyDirectorPreset}
  onNudgeClipTiming={handleNudgeClipTiming}
  onUpdateClip={handleUpdateClip}
/>
```

- [ ] **Step 2: Add Timing Actions controls**

In `apps/web/src/components/studio/clip-inspector.tsx`, import `Clock3`, `Minus`, and `Plus` from `lucide-react`, and import `ClipTimingNudge`.

Update props:

```ts
type ClipInspectorProps = {
  fieldValidationIssues: ClipFieldValidationIssues;
  selectedClip: TimelineClip | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onNudgeClipTiming: (clipId: string, nudge: ClipTimingNudge) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};
```

Add this component near `DirectorActionStrip`:

```tsx
function TimingActionStrip({
  onNudge,
}: {
  onNudge: (nudge: ClipTimingNudge) => void;
}) {
  const timingActions = [
    {
      icon: Minus,
      label: "Start -0.5s",
      title: "Move selected clip earlier by 0.5 seconds",
      nudge: { field: "start", delta: -0.5 },
    },
    {
      icon: Plus,
      label: "Start +0.5s",
      title: "Move selected clip later by 0.5 seconds",
      nudge: { field: "start", delta: 0.5 },
    },
    {
      icon: Minus,
      label: "Duration -0.5s",
      title: "Shorten selected clip by 0.5 seconds",
      nudge: { field: "duration", delta: -0.5 },
    },
    {
      icon: Plus,
      label: "Duration +0.5s",
      title: "Lengthen selected clip by 0.5 seconds",
      nudge: { field: "duration", delta: 0.5 },
    },
  ] satisfies Array<{
    icon: LucideIcon;
    label: string;
    title: string;
    nudge: ClipTimingNudge;
  }>;

  return (
    <div className="border-b border-white/[0.06] py-3">
      <div className="mb-2 flex items-center gap-2">
        <Clock3 className="h-3.5 w-3.5 text-studio-gold" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
          Timing Actions
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {timingActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onNudge(action.nudge)}
              title={action.title}
              aria-label={`${action.label}: ${action.title}`}
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition-colors hover:border-sky-300/30 hover:bg-sky-300/12 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 text-studio-gold"
                aria-hidden="true"
              />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Add handler inside `ClipInspector`:

```ts
function nudgeTiming(nudge: ClipTimingNudge) {
  onNudgeClipTiming(selectedClip.id, nudge);
}
```

Render `TimingActionStrip` after optional `DirectorActionStrip` and before editable fields:

```tsx
<TimingActionStrip onNudge={nudgeTiming} />
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
npm.cmd run lint --prefix apps/web
```

Expected: both commands pass.

- [ ] **Step 4: Commit UI**

Run:

```powershell
git add apps/web/src/components/studio/studio-app.tsx apps/web/src/components/studio/clip-inspector.tsx
git commit -m "feat: add inspector timing actions"
```

## Task 3: Verification And Handoff

**Files:**
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: all commands exit 0. The build may emit the known local SWC warning while webpack/WASM still succeeds.

- [ ] **Step 2: Browser verification**

Run or reuse the dev server:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Verify:

- Selecting a voice clip and pressing `Start +0.5s` updates the Time row and Timeline block label.
- Pressing `Duration +0.5s` updates the Time row and Timeline block width/label.
- Pressing `Duration +0.5s` on the final voice clip until it exceeds project duration shows a Duration field-level issue.
- Pressing `Duration -0.5s` until timing is valid clears the field-level issue.
- Desktop and 390px mobile viewports have no document-level horizontal overflow.

- [ ] **Step 3: Update docs**

Update `docs/AI_HANDOFF.md`:

- Add light timeline editing to current capabilities.
- Add latest commit trail entries.
- Move recommended next work to project structure upgrade unless project reality suggests a route adjustment.
- Record latest verification results.

Update `docs/project-archive.md`:

- Add a light timeline editing progress section with design/plan links, implemented behavior, and verification.
- Mark route step 2 as completed and step 3 as next.

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md
git commit -m "docs: record light timeline editing"
```

- [ ] **Step 5: Push branch**

Run:

```powershell
git push
```
