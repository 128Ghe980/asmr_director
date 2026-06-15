# Field-Level Validation Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show selected-clip schema validation issues directly on matching `ClipInspector` fields while keeping the global `ValidationPanel`.

**Architecture:** Add a pure ASMR domain helper that maps existing validation issue paths to selected-clip field keys. `StudioApp` computes the field issue map and passes it to `ClipInspector`, which renders accessible field error states.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Zod, Vitest.

---

## File Structure

- Modify: `apps/web/src/lib/asmr/edit-project.ts`
  - Add `ClipFieldValidationKey`, `ClipFieldValidationIssues`, and `getClipFieldValidationIssues`.
- Modify: `apps/web/src/lib/asmr/edit-project.test.ts`
  - Add tests for selected clip duration, ignored other clip issues, nested `position.pan`, and unsupported paths.
- Modify: `apps/web/src/components/studio/studio-app.tsx`
  - Compute selected clip field issues from existing project issues and pass them to `ClipInspector`.
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`
  - Render error styling, `aria-invalid`, `aria-describedby`, and compact field-level messages.

## Task 1: Domain Helper

**Files:**
- Modify: `apps/web/src/lib/asmr/edit-project.test.ts`
- Modify: `apps/web/src/lib/asmr/edit-project.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to `apps/web/src/lib/asmr/edit-project.test.ts`:

```ts
it("maps validation issues to fields on the selected clip", () => {
  const updated = updateClipInProject(demoProject, "voice_004", {
    start: 208,
    duration: 12,
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

it("ignores validation issues for other clips", () => {
  const updated = updateClipInProject(demoProject, "voice_004", {
    start: 208,
    duration: 12,
  });

  const issues = getProjectValidationIssues(updated);
  const fieldIssues = getClipFieldValidationIssues(
    updated,
    "voice_001",
    issues,
  );

  expect(fieldIssues).toEqual({});
});

it("maps nested position issues to nested field keys", () => {
  const updated = updateClipInProject(demoProject, "voice_001", {
    position: { pan: 1.4 },
  });

  const issues = getProjectValidationIssues(updated);
  const fieldIssues = getClipFieldValidationIssues(
    updated,
    "voice_001",
    issues,
  );

  expect(fieldIssues["position.pan"]).toEqual([
    {
      path: "timeline.tracks.0.clips.0.position.pan",
      message: "Too big: expected number to be <=1",
    },
  ]);
});

it("ignores unsupported paths for the selected clip", () => {
  const fieldIssues = getClipFieldValidationIssues(demoProject, "voice_001", [
    {
      path: "timeline.tracks.0.clips.0.generation.status",
      message: "unsupported status",
    },
    {
      path: "project",
      message: "project issue",
    },
  ]);

  expect(fieldIssues).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: fail because `getClipFieldValidationIssues` is not exported.

- [ ] **Step 3: Implement helper**

Add to `apps/web/src/lib/asmr/edit-project.ts`:

```ts
export type ClipFieldValidationKey =
  | "text"
  | "emotion"
  | "style"
  | "pace"
  | "breath"
  | "sfx"
  | "ambience"
  | "loop"
  | "start"
  | "duration"
  | "volume_db"
  | "position.pan"
  | "position.distance"
  | "position.movement";

export type ClipFieldValidationIssues = Partial<
  Record<ClipFieldValidationKey, ProjectValidationIssue[]>
>;

const clipFieldValidationKeys = new Set<ClipFieldValidationKey>([
  "text",
  "emotion",
  "style",
  "pace",
  "breath",
  "sfx",
  "ambience",
  "loop",
  "start",
  "duration",
  "volume_db",
  "position.pan",
  "position.distance",
  "position.movement",
]);

function getClipPathPrefix(
  project: AsmrProject,
  clipId: string,
): string | undefined {
  for (const [trackIndex, track] of project.timeline.tracks.entries()) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);

    if (clipIndex >= 0) {
      return `timeline.tracks.${trackIndex}.clips.${clipIndex}`;
    }
  }

  return undefined;
}

function getClipFieldValidationKey(
  relativePath: string,
): ClipFieldValidationKey | undefined {
  return clipFieldValidationKeys.has(relativePath as ClipFieldValidationKey)
    ? (relativePath as ClipFieldValidationKey)
    : undefined;
}

export function getClipFieldValidationIssues(
  project: AsmrProject,
  clipId: string,
  issues: ProjectValidationIssue[],
): ClipFieldValidationIssues {
  const clipPathPrefix = getClipPathPrefix(project, clipId);

  if (!clipPathPrefix) {
    return {};
  }

  return issues.reduce<ClipFieldValidationIssues>((fieldIssues, issue) => {
    const clipPath = `${clipPathPrefix}.`;

    if (!issue.path.startsWith(clipPath)) {
      return fieldIssues;
    }

    const relativePath = issue.path.slice(clipPath.length);
    const fieldKey = getClipFieldValidationKey(relativePath);

    if (!fieldKey) {
      return fieldIssues;
    }

    fieldIssues[fieldKey] = [...(fieldIssues[fieldKey] ?? []), issue];
    return fieldIssues;
  }, {});
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: all `edit-project.test.ts` tests pass.

- [ ] **Step 5: Commit helper**

Run:

```powershell
git add apps/web/src/lib/asmr/edit-project.ts apps/web/src/lib/asmr/edit-project.test.ts
git commit -m "feat: map validation issues to clip fields"
```

## Task 2: Inspector UI

**Files:**
- Modify: `apps/web/src/components/studio/studio-app.tsx`
- Modify: `apps/web/src/components/studio/clip-inspector.tsx`

- [ ] **Step 1: Compute selected clip field issues**

In `apps/web/src/components/studio/studio-app.tsx`, import `getClipFieldValidationIssues` and compute:

```ts
const selectedClipValidationIssues = useMemo(
  () =>
    activeClipId
      ? getClipFieldValidationIssues(editableProject, activeClipId, validationIssues)
      : {},
  [activeClipId, editableProject, validationIssues],
);
```

Pass it to `ClipInspector`:

```tsx
<ClipInspector
  fieldValidationIssues={selectedClipValidationIssues}
  selectedClip={selectedClip}
  onApplyDirectorPreset={handleApplyDirectorPreset}
  onUpdateClip={handleUpdateClip}
/>
```

- [ ] **Step 2: Add field error rendering**

In `apps/web/src/components/studio/clip-inspector.tsx`, import:

```ts
import type {
  ClipFieldValidationIssues,
  ClipFieldValidationKey,
  ClipPatch,
  ProjectValidationIssue,
} from "@/lib/asmr/edit-project";
```

Add `fieldValidationIssues` to props:

```ts
type ClipInspectorProps = {
  fieldValidationIssues: ClipFieldValidationIssues;
  selectedClip: TimelineClip | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};
```

Add helpers:

```tsx
function FieldError({
  id,
  issues,
}: {
  id: string;
  issues: ProjectValidationIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <p id={id} className="mt-2 text-xs leading-5 text-amber-100">
      {issues.map((issue) => issue.message).join(" ")}
    </p>
  );
}

function controlClassName(extra = "", hasError = false) {
  return [
    "w-full rounded-md border px-3 py-2 text-sm text-studio-text outline-none transition",
    hasError
      ? "border-amber-300/55 bg-amber-300/[0.075] focus:border-amber-200/80 focus:ring-2 focus:ring-amber-300/20"
      : "border-white/[0.08] bg-black/20 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20",
    extra,
  ].join(" ");
}
```

Inside `ClipInspector`, add:

```ts
function getFieldIssues(field: ClipFieldValidationKey): ProjectValidationIssue[] {
  return fieldValidationIssues[field] ?? [];
}

function hasFieldIssues(field: ClipFieldValidationKey): boolean {
  return getFieldIssues(field).length > 0;
}

function getFieldErrorId(field: ClipFieldValidationKey): string {
  return `clip-${selectedClip.id}-${field.replaceAll(".", "-")}-error`;
}

function getFieldControlProps(field: ClipFieldValidationKey) {
  return hasFieldIssues(field)
    ? {
        "aria-describedby": getFieldErrorId(field),
        "aria-invalid": true,
      }
    : {};
}
```

For every editable input/select/textarea, pass `hasFieldIssues(field)` into `controlClassName`, spread `getFieldControlProps(field)`, and render:

```tsx
<FieldError
  id={getFieldErrorId("duration")}
  issues={getFieldIssues("duration")}
/>
```

Use each field's matching key.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/edit-project.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit UI**

Run:

```powershell
git add apps/web/src/components/studio/studio-app.tsx apps/web/src/components/studio/clip-inspector.tsx
git commit -m "feat: highlight invalid inspector fields"
```

## Task 3: Verification And Documentation

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

Run the dev server if needed:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Verify in browser:

- Invalid selected voice duration highlights the Duration field and shows inline error.
- Invalid selected voice pan highlights the Pan field and shows inline error.
- Restoring valid values removes the inline field errors.
- Global `ValidationPanel` still lists project issues.
- Desktop and 390px mobile viewports have no document-level horizontal overflow.

- [ ] **Step 3: Update docs**

Update `docs/AI_HANDOFF.md` and `docs/project-archive.md`:

- Add field-level validation highlighting to current capabilities.
- Add latest commit trail entries.
- Move recommended next work to light timeline editing unless project reality indicates another route adjustment.
- Record verification results.

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add docs/AI_HANDOFF.md docs/project-archive.md
git commit -m "docs: record field validation highlighting"
```

- [ ] **Step 5: Push branch**

Run:

```powershell
git push
```
