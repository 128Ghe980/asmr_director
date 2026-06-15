# V0.3 Director Action Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Director Actions for selected voice clips so the studio feels like an ASMR director console instead of a raw field editor.

**Architecture:** Implement preset behavior as a pure domain helper in `apps/web/src/lib/asmr/director-presets.ts`, covered by focused Vitest tests. Wire the helper into `StudioApp` and expose a compact action strip in `ClipInspector` only when the selected clip is a voice clip. Existing shared project state will continue driving validation, autosave, restore, import, and export.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, lucide-react, Zod, Vitest.

---

## File Structure

- Create `apps/web/src/lib/asmr/director-presets.ts`: pure preset API and deterministic patch generation.
- Create `apps/web/src/lib/asmr/director-presets.test.ts`: unit tests for all preset behavior and guard cases.
- Modify `apps/web/src/components/studio/studio-app.tsx`: add `handleApplyDirectorPreset` and pass it to the inspector.
- Modify `apps/web/src/components/studio/clip-inspector.tsx`: render the Director Actions strip for voice clips.
- Modify `docs/AI_HANDOFF.md`: record the implemented feature and current verification state after implementation.

## Task 1: Pure Director Preset Helper

**Files:**
- Create: `apps/web/src/lib/asmr/director-presets.test.ts`
- Create: `apps/web/src/lib/asmr/director-presets.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/src/lib/asmr/director-presets.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  applyDirectorPreset,
  type DirectorPreset,
} from "./director-presets";
import { updateClipInProject } from "./edit-project";
import type { AsmrProject, TimelineClip } from "./schema";

function getClip(project: AsmrProject, clipId: string): TimelineClip {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);

    if (clip) {
      return clip;
    }
  }

  throw new Error(`Missing clip ${clipId}`);
}

function apply(preset: DirectorPreset, clipId = "voice_002") {
  return applyDirectorPreset(demoProject, clipId, preset);
}

describe("director presets", () => {
  it("moves only the target voice clip closer", () => {
    const updated = apply("closer", "voice_002");
    const originalFirstVoice = getClip(demoProject, "voice_001");
    const updatedFirstVoice = getClip(updated, "voice_001");
    const updatedTarget = getClip(updated, "voice_002");

    expect(updatedTarget.position.distance).toBe("very_close");
    expect(updatedTarget.position.movement).toBe("static");
    expect(updatedTarget.volume_db).toBe(-14);
    expect(updatedFirstVoice.position).toEqual(originalFirstVoice.position);
    expect(updated).not.toBe(demoProject);
  });

  it("sets left and right ear pan values inside the schema range", () => {
    const left = getClip(apply("left-ear"), "voice_002");
    const right = getClip(apply("right-ear"), "voice_002");

    expect(left.position.pan).toBeLessThan(0);
    expect(left.position.pan).toBeGreaterThanOrEqual(-1);
    expect(left.position.distance).toBe("very_close");
    expect(right.position.pan).toBeGreaterThan(0);
    expect(right.position.pan).toBeLessThanOrEqual(1);
    expect(right.position.distance).toBe("very_close");
    expect(Math.abs(left.position.pan)).toBe(Math.abs(right.position.pan));
  });

  it("makes a voice clip softer without radical spatial changes", () => {
    const updated = getClip(apply("softer"), "voice_002");

    expect(updated.emotion).toBe("gentle");
    expect(updated.style).toBe("soft whisper");
    expect(updated.pace).toBe("slow");
    expect(updated.volume_db).toBe(-15);
    expect(updated.position.pan).toBe(0.08);
  });

  it("lowers volume and clamps at the lower schema bound", () => {
    const quietProject = updateClipInProject(demoProject, "voice_002", {
      volume_db: -79,
    });
    const updated = applyDirectorPreset(quietProject, "voice_002", "quieter");
    const updatedTarget = getClip(updated, "voice_002");

    expect(updatedTarget.volume_db).toBe(-80);
  });

  it("adds a pause marker without extending beyond project duration", () => {
    const nearEndProject = updateClipInProject(demoProject, "voice_004", {
      start: 204,
      duration: 6,
    });
    const updated = applyDirectorPreset(nearEndProject, "voice_004", "add-pause");
    const updatedTarget = getClip(updated, "voice_004");

    expect(updatedTarget.text.endsWith(" ...")).toBe(true);
    expect(updatedTarget.duration).toBe(6);
  });

  it("returns the same project when the target clip is missing", () => {
    const updated = applyDirectorPreset(demoProject, "missing_clip", "closer");

    expect(updated).toBe(demoProject);
  });

  it("returns the same project when the target clip is not a voice clip", () => {
    const updated = applyDirectorPreset(demoProject, "breath_001", "closer");

    expect(updated).toBe(demoProject);
  });

  it("does not mutate the original project", () => {
    const originalTarget = getClip(demoProject, "voice_002");
    const updated = apply("right-ear", "voice_002");
    const updatedTarget = getClip(updated, "voice_002");

    expect(originalTarget.position.pan).toBe(0.08);
    expect(updatedTarget.position.pan).not.toBe(originalTarget.position.pan);
  });
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/director-presets.test.ts
```

Expected: FAIL because `./director-presets` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Create `apps/web/src/lib/asmr/director-presets.ts` with this content:

```ts
import { updateClipInProject, type ClipPatch } from "./edit-project";
import type { AsmrProject, TimelineClip } from "./schema";

export type DirectorPreset =
  | "softer"
  | "closer"
  | "left-ear"
  | "right-ear"
  | "add-pause"
  | "quieter";

const MIN_VOLUME_DB = -80;
const MAX_VOLUME_DB = 12;
const LEFT_EAR_PAN = -0.82;
const RIGHT_EAR_PAN = 0.82;
const PAUSE_SECONDS = 0.5;
const PAUSE_MARKER = " ...";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampVolume(value: number): number {
  return clamp(value, MIN_VOLUME_DB, MAX_VOLUME_DB);
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

function preserveLateralMovement(
  movement: TimelineClip["position"]["movement"],
): TimelineClip["position"]["movement"] {
  return movement === "left_to_right" || movement === "right_to_left"
    ? movement
    : "static";
}

function getAddPauseDuration(project: AsmrProject, clip: TimelineClip): number {
  const proposedDuration = clip.duration + PAUSE_SECONDS;
  const maxDuration = project.duration - clip.start;

  return proposedDuration <= maxDuration ? proposedDuration : clip.duration;
}

function buildPresetPatch(
  project: AsmrProject,
  clip: TimelineClip,
  preset: DirectorPreset,
): ClipPatch | undefined {
  if (clip.type !== "voice") {
    return undefined;
  }

  switch (preset) {
    case "softer":
      return {
        emotion: "gentle",
        style: "soft whisper",
        pace: "slow",
        volume_db: clampVolume(clip.volume_db - 2),
      };
    case "closer":
      return {
        volume_db: clampVolume(clip.volume_db - 1),
        position: {
          distance: "very_close",
          movement: preserveLateralMovement(clip.position.movement),
        },
      };
    case "left-ear":
      return {
        position: {
          pan: LEFT_EAR_PAN,
          distance: "very_close",
          movement: "static",
        },
      };
    case "right-ear":
      return {
        position: {
          pan: RIGHT_EAR_PAN,
          distance: "very_close",
          movement: "static",
        },
      };
    case "add-pause":
      return {
        text: clip.text.endsWith(PAUSE_MARKER)
          ? clip.text
          : `${clip.text}${PAUSE_MARKER}`,
        duration: getAddPauseDuration(project, clip),
      };
    case "quieter":
      return {
        volume_db: clampVolume(clip.volume_db - 3),
      };
  }
}

export function applyDirectorPreset(
  project: AsmrProject,
  clipId: string,
  preset: DirectorPreset,
): AsmrProject {
  const clip = findClip(project, clipId);

  if (!clip || clip.type !== "voice") {
    return project;
  }

  const patch = buildPresetPatch(project, clip, preset);

  if (!patch) {
    return project;
  }

  return updateClipInProject(project, clipId, patch);
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/director-presets.test.ts
```

Expected: PASS with 1 test file and 8 tests passing.

- [ ] **Step 5: Run the existing ASMR lib tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr
```

Expected: PASS with all ASMR lib tests passing.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add apps/web/src/lib/asmr/director-presets.ts apps/web/src/lib/asmr/director-presets.test.ts
git commit -m "feat: add director preset helper"
```

## Task 2: Clip Inspector Director Actions UI

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`

- [ ] **Step 1: Wire the preset helper into StudioApp**

Modify `apps/web/src/components/studio/studio-app.tsx`:

```ts
import {
  applyDirectorPreset,
  type DirectorPreset,
} from "@/lib/asmr/director-presets";
```

Add this handler near `handleUpdateClip`:

```ts
function handleApplyDirectorPreset(clipId: string, preset: DirectorPreset) {
  setEditableProject((currentProject) =>
    applyDirectorPreset(currentProject, clipId, preset),
  );
  setImportError(undefined);
}
```

Pass the handler into `ClipInspector`:

```tsx
<ClipInspector
  selectedClip={selectedClip}
  onApplyDirectorPreset={handleApplyDirectorPreset}
  onUpdateClip={handleUpdateClip}
/>
```

- [ ] **Step 2: Add the Director Actions props and imports**

Modify the top of `apps/web/src/components/studio/clip-inspector.tsx`:

```ts
"use client";

import {
  Ear,
  Heart,
  MoveLeft,
  MoveRight,
  Pause,
  Volume1,
  type LucideIcon,
} from "lucide-react";

import type { DirectorPreset } from "@/lib/asmr/director-presets";
import type { ClipPatch } from "@/lib/asmr/edit-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { formatTimeRange, getPositionLabel } from "@/lib/asmr/view-model";
```

Update the props type:

```ts
type ClipInspectorProps = {
  selectedClip: TimelineClip | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};
```

- [ ] **Step 3: Add compact action button helpers**

Add these definitions below `movementOptions`:

```ts
type DirectorAction = {
  icon: LucideIcon;
  label: string;
  preset: DirectorPreset;
  title: string;
};

const directorActions: DirectorAction[] = [
  {
    icon: Heart,
    label: "Softer",
    preset: "softer",
    title: "Make this voice delivery softer",
  },
  {
    icon: Ear,
    label: "Closer",
    preset: "closer",
    title: "Move this voice closer to the listener",
  },
  {
    icon: MoveLeft,
    label: "Left",
    preset: "left-ear",
    title: "Place this voice in the left ear",
  },
  {
    icon: MoveRight,
    label: "Right",
    preset: "right-ear",
    title: "Place this voice in the right ear",
  },
  {
    icon: Pause,
    label: "Pause",
    preset: "add-pause",
    title: "Add a readable performance pause",
  },
  {
    icon: Volume1,
    label: "Quiet",
    preset: "quieter",
    title: "Lower this voice volume",
  },
];
```

Add this component below `ReadOnlyRow`:

```tsx
function DirectorActionStrip({
  onApplyPreset,
}: {
  onApplyPreset: (preset: DirectorPreset) => void;
}) {
  return (
    <div className="border-b border-white/[0.06] py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
          Director Actions
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {directorActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.preset}
              type="button"
              onClick={() => onApplyPreset(action.preset)}
              title={action.title}
              aria-label={action.title}
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition-colors hover:border-sky-300/30 hover:bg-sky-300/12 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-studio-gold" aria-hidden="true" />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the strip for voice clips only**

Update the `ClipInspector` function signature:

```ts
export function ClipInspector({
  selectedClip,
  onApplyDirectorPreset,
  onUpdateClip,
}: ClipInspectorProps) {
```

Add this helper inside the component after `updateClip`:

```ts
function applyPreset(preset: DirectorPreset) {
  if (!selectedClip) {
    return;
  }

  onApplyDirectorPreset(selectedClip.id, preset);
}
```

Render the strip above the voice-specific fields:

```tsx
{selectedClip.type === "voice" ? (
  <DirectorActionStrip onApplyPreset={applyPreset} />
) : null}
```

- [ ] **Step 5: Run type/lint feedback for the changed UI**

Run:

```powershell
npm.cmd run lint --prefix apps/web
```

Expected: PASS with no lint errors.

- [ ] **Step 6: Run the unit test suite**

Run:

```powershell
npm.cmd run test --prefix apps/web
```

Expected: PASS with the new director preset tests included.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add apps/web/src/components/studio/studio-app.tsx apps/web/src/components/studio/clip-inspector.tsx
git commit -m "feat: add director action buttons"
```

## Task 3: Verification, Browser Check, and Handoff Update

**Files:**
- Modify: `docs/AI_HANDOFF.md`

- [ ] **Step 1: Run full local verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected:

- Vitest passes all test files.
- ESLint exits 0.
- Next build exits 0.
- The known local SWC warning may appear; it is acceptable only if the build completes successfully with webpack/WASM fallback.

- [ ] **Step 2: Start or reuse the local dev server**

Check whether the app is already running at `http://localhost:3000/`:

```powershell
try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/).StatusCode } catch { "not running" }
```

If not running, start it:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

Expected: Next dev server serves `http://localhost:3000/`.

- [ ] **Step 3: Browser verify the Director Actions**

Use the in-app Browser when available.

Verify:

- a selected voice clip shows `Director Actions`
- clicking `Closer` changes `Distance` to `very_close`
- clicking `Left` changes `Pan` to a negative value
- clicking `Right` changes `Pan` to a positive value
- clicking `Pause` appends ` ...` to the Text field
- selecting a breath or sfx clip hides `Director Actions`
- after clicking a preset and refreshing, localStorage restores the edited project
- desktop width has no document-level horizontal overflow
- mobile width around 390px has no document-level horizontal overflow

- [ ] **Step 4: Update AI_HANDOFF**

In `docs/AI_HANDOFF.md`, update:

- Current State: add that voice clips now support Director Actions.
- Architecture Map: add `apps/web/src/lib/asmr/director-presets.ts`.
- Tests: add `apps/web/src/lib/asmr/director-presets.test.ts`.
- Current Verification: update test file and test counts based on the fresh run.
- Recent Commit Trail: add the feature commits from this branch.
- Recommended Next Work: replace active V0.3 implementation text with field-level validation highlighting as the next recommended step.

- [ ] **Step 5: Re-run document checks**

Run:

```powershell
$pattern = "TB" + "D|FIX" + "ME|implement " + "later|fill in " + "details"
rg -n $pattern docs/AI_HANDOFF.md docs/superpowers/specs/2026-06-16-v0-3-director-action-presets-design.md docs/superpowers/plans/2026-06-16-v0-3-director-action-presets.md
git diff --check
```

Expected:

- `rg` exits 1 with no matches.
- `git diff --check` exits 0. CRLF warnings are acceptable on Windows if there are no whitespace errors.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add docs/AI_HANDOFF.md
git commit -m "docs: record director action presets"
```

## Completion Criteria

- `director-presets.ts` is covered by failing-then-passing tests.
- `ClipInspector` shows Director Actions only for voice clips.
- All six presets update the shared project state deterministically.
- Existing validation, autosave, restore, import, and export paths continue to use the same `AsmrProject` state.
- `npm.cmd run test --prefix apps/web` passes.
- `npm.cmd run lint --prefix apps/web` passes.
- `npm.cmd run build --prefix apps/web -- --webpack` exits 0.
- Browser verification confirms desktop/mobile layout and the main preset interactions.
- Handoff docs reflect the implemented feature and current next step.
