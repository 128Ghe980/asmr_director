# V0.1 DSL-First Studio App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished V0.1 AI ASMR Studio prototype where a fixed demo project renders from a validated Timeline DSL into a professional Studio Console UI with storyboard, timeline, clip inspector, and JSON export.

**Architecture:** Create a Next.js app under `apps/web`, keep the ASMR domain model in focused TypeScript modules, validate the project JSON with Zod, render all views from the same mock DSL object, and keep UI state local to the studio surface. The visual direction is Studio Console as the base with restrained Ambient Director atmosphere.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Zod, lucide-react, Vitest, npm.

---

## References

- Next.js official installation docs: https://nextjs.org/docs/app/getting-started/installation
- Next.js `create-next-app` CLI docs: https://nextjs.org/docs/app/api-reference/cli/create-next-app
- shadcn/ui Next.js installation docs, for future component-system alignment: https://ui.shadcn.com/docs/installation/next
- Zod docs: https://zod.dev/
- Zod schema docs: https://zod.dev/api

## Scope Check

This plan implements the V0.1 prototype only:

- It creates the frontend app.
- It defines the ASMR Project JSON and Timeline DSL schema.
- It renders a polished static demo from mock data.
- It exports the current project as JSON.

It does not implement real LLM planning, TTS, SFX generation, audio playback, waveform rendering, user accounts, persistence, billing, or backend APIs.

## File Structure

Create and modify these files:

- Create: `.gitignore`  
  Ignore local generated files, dependencies, build outputs, and visual companion state.

- Create: `apps/web/`  
  Next.js application root created by `create-next-app`.

- Modify: `apps/web/package.json`  
  Add dependencies and test scripts.

- Create: `apps/web/src/lib/asmr/schema.ts`  
  Zod schemas, enum values, and inferred TypeScript types for ASMR Project JSON.

- Create: `apps/web/src/lib/asmr/validate.ts`  
  Small validation helpers and timeline flattening utilities.

- Create: `apps/web/src/lib/asmr/mock-project.ts`  
  The canonical rain-night demo project.

- Create: `apps/web/src/lib/asmr/view-model.ts`  
  Presentation helpers for time ranges, position labels, and track summaries.

- Create: `apps/web/src/lib/asmr/schema.test.ts`  
  Unit tests for schema validation.

- Create: `apps/web/src/lib/asmr/view-model.test.ts`  
  Unit tests for display helpers.

- Modify: `apps/web/src/app/globals.css`  
  Studio Console visual foundation.

- Modify: `apps/web/src/app/layout.tsx`  
  Metadata and app shell defaults.

- Modify: `apps/web/src/app/page.tsx`  
  Render the studio surface.

- Create: `apps/web/src/components/studio/studio-app.tsx`  
  Client component that owns selected clip state and export action.

- Create: `apps/web/src/components/studio/project-header.tsx`  
  Top project context, status, and export button.

- Create: `apps/web/src/components/studio/storyboard-panel.tsx`  
  Director storyboard list from timeline clips.

- Create: `apps/web/src/components/studio/timeline-panel.tsx`  
  Lightweight multi-track timeline from the same DSL.

- Create: `apps/web/src/components/studio/clip-inspector.tsx`  
  Selected clip detail panel.

- Create: `apps/web/src/components/studio/status-badge.tsx`  
  Shared status badge component.

## Task 1: Initialize Repository And Scaffold App

**Files:**
- Create: `.gitignore`
- Create: `apps/web/`

- [ ] **Step 1: Initialize git**

Run:

```powershell
git init
```

Expected:

```text
Initialized empty Git repository in D:/CodexWorkplace/asmr_director/.git/
```

- [ ] **Step 2: Create `.gitignore`**

Create `.gitignore` with exactly this content:

```gitignore
.superpowers/
node_modules/
.next/
out/
dist/
coverage/
.env
.env.*
!.env.example
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
```

- [ ] **Step 3: Scaffold the Next.js app**

Run:

```powershell
npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
```

Expected:

```text
Success! Created web at D:\CodexWorkplace\asmr_director\apps\web
```

- [ ] **Step 4: Verify the scaffold**

Run:

```powershell
npm run lint --prefix apps/web
```

Expected:

```text
No ESLint warnings or errors
```

If the exact success text differs, accept a zero exit code with no lint errors.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .gitignore apps/web
git commit -m "chore: scaffold studio app"
```

Expected: commit succeeds.

## Task 2: Add Runtime Dependencies And Test Script

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install dependencies**

Run:

```powershell
npm install --prefix apps/web zod lucide-react clsx
npm install --prefix apps/web -D vitest
```

Expected: packages install without audit-blocking errors.

- [ ] **Step 2: Add test scripts**

Modify `apps/web/package.json` so its `scripts` object includes:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Keep compatible scripts generated by Next.js. The required script values for this plan are `lint: "eslint"`, `test: "vitest run"`, and `test:watch: "vitest"`.

- [ ] **Step 3: Verify test runner is available**

Run:

```powershell
npm run test --prefix apps/web
```

Expected:

```text
No test files found
```

Vitest may exit with code 1 when no tests exist. This is acceptable for this step because Task 3 adds tests.

- [ ] **Step 4: Commit**

Run:

```powershell
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore: add validation and test dependencies"
```

Expected: commit succeeds.

## Task 3: Define ASMR Project Schema

**Files:**
- Create: `apps/web/src/lib/asmr/schema.ts`
- Create: `apps/web/src/lib/asmr/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `apps/web/src/lib/asmr/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AsmrProjectSchema } from "./schema";

const validProject = {
  project_id: "asmr_demo_001",
  status: "ready_for_preview",
  title: "雨夜睡前陪伴",
  language: "zh",
  duration: 300,
  scene: {
    id: "rainy_night_bedroom",
    name: "雨夜陪伴",
  },
  character: {
    id: "voice_card_001",
    role: "older_sister",
    personality: ["gentle", "mature", "comforting"],
    speech_style: ["soft", "slow", "close"],
  },
  emotion_curve: [
    { start: 0, end: 60, emotion: "gentle_intro" },
    { start: 60, end: 180, emotion: "comforting" },
  ],
  timeline: {
    tracks: [
      {
        track_type: "voice",
        clips: [
          {
            id: "voice_001",
            track: "voice",
            type: "voice",
            start: 12,
            duration: 6,
            text: "你还没睡吗？没关系，我陪你一会儿。",
            emotion: "comforting",
            style: "whisper",
            pace: "slow",
            volume_db: -12,
            fade_in: 0.05,
            fade_out: 0.2,
            position: {
              pan: -0.72,
              distance: "close",
              movement: "static",
            },
            generation: {
              status: "asset_pending",
              model: "mock_tts",
              seed: 12345,
              temperature: 0.7,
              retry_count: 0,
              error: null,
            },
            asset: {
              asset_id: null,
              uri: null,
              duration: null,
            },
          },
        ],
      },
      { track_type: "breath", clips: [] },
      { track_type: "sfx", clips: [] },
      { track_type: "ambience", clips: [] },
      { track_type: "post_processing", clips: [] },
    ],
    mixing: {
      target_lufs: -18,
      binaural: true,
      master_limiter: true,
    },
  },
  exports: [],
};

describe("AsmrProjectSchema", () => {
  it("parses a valid V0.1 project", () => {
    const parsed = AsmrProjectSchema.parse(validProject);
    expect(parsed.project_id).toBe("asmr_demo_001");
    expect(parsed.timeline.tracks[0].track_type).toBe("voice");
  });

  it("rejects invalid pan values", () => {
    const project = structuredClone(validProject);
    project.timeline.tracks[0].clips[0].position.pan = 1.4;
    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });

  it("rejects voice clips without text", () => {
    const project = structuredClone(validProject);
    delete project.timeline.tracks[0].clips[0].text;
    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test --prefix apps/web -- src/lib/asmr/schema.test.ts
```

Expected: FAIL with an import error for `./schema`.

- [ ] **Step 3: Implement schema**

Create `apps/web/src/lib/asmr/schema.ts`:

```ts
import { z } from "zod";

export const ProjectStatusSchema = z.enum([
  "draft",
  "planning_failed",
  "timeline_invalid",
  "ready_for_preview",
  "export_failed",
]);

export const AssetStatusSchema = z.enum([
  "asset_pending",
  "asset_generating",
  "asset_generated",
  "asset_failed",
]);

export const TrackTypeSchema = z.enum([
  "voice",
  "breath",
  "sfx",
  "ambience",
  "post_processing",
]);

export const DistanceSchema = z.enum([
  "far",
  "mid",
  "near",
  "close",
  "very_close",
]);

export const MovementSchema = z.enum([
  "static",
  "approach",
  "recede",
  "left_to_right",
  "right_to_left",
]);

export const PositionSchema = z.object({
  pan: z.number().min(-1).max(1),
  distance: DistanceSchema,
  movement: MovementSchema,
});

export const GenerationSchema = z.object({
  status: AssetStatusSchema,
  model: z.string().min(1),
  seed: z.number().int().nonnegative(),
  temperature: z.number().min(0).max(2).optional(),
  retry_count: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const AssetSchema = z.object({
  asset_id: z.string().nullable(),
  uri: z.string().nullable(),
  duration: z.number().positive().nullable(),
});

const ClipBaseSchema = z.object({
  id: z.string().min(1),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  volume_db: z.number().min(-80).max(12),
  fade_in: z.number().nonnegative(),
  fade_out: z.number().nonnegative(),
  position: PositionSchema,
  generation: GenerationSchema,
  asset: AssetSchema,
});

export const VoiceClipSchema = ClipBaseSchema.extend({
  track: z.literal("voice"),
  type: z.literal("voice"),
  text: z.string().min(1),
  emotion: z.string().min(1),
  style: z.string().min(1),
  pace: z.string().min(1),
});

export const BreathClipSchema = ClipBaseSchema.extend({
  track: z.literal("breath"),
  type: z.literal("breath"),
  breath: z.string().min(1),
});

export const SfxClipSchema = ClipBaseSchema.extend({
  track: z.literal("sfx"),
  type: z.literal("sfx"),
  sfx: z.string().min(1),
});

export const AmbienceClipSchema = ClipBaseSchema.extend({
  track: z.literal("ambience"),
  type: z.literal("ambience"),
  ambience: z.string().min(1),
  loop: z.boolean(),
});

export const TimelineClipSchema = z.discriminatedUnion("type", [
  VoiceClipSchema,
  BreathClipSchema,
  SfxClipSchema,
  AmbienceClipSchema,
]);

export const VoiceTrackSchema = z.object({
  track_type: z.literal("voice"),
  clips: z.array(VoiceClipSchema),
});

export const BreathTrackSchema = z.object({
  track_type: z.literal("breath"),
  clips: z.array(BreathClipSchema),
});

export const SfxTrackSchema = z.object({
  track_type: z.literal("sfx"),
  clips: z.array(SfxClipSchema),
});

export const AmbienceTrackSchema = z.object({
  track_type: z.literal("ambience"),
  clips: z.array(AmbienceClipSchema),
});

export const PostProcessingTrackSchema = z.object({
  track_type: z.literal("post_processing"),
  clips: z.array(z.never()),
});

export const TimelineTrackSchema = z.discriminatedUnion("track_type", [
  VoiceTrackSchema,
  BreathTrackSchema,
  SfxTrackSchema,
  AmbienceTrackSchema,
  PostProcessingTrackSchema,
]);

export const EmotionCurvePointSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
    emotion: z.string().min(1),
  })
  .refine((point) => point.end > point.start, {
    message: "emotion_curve point end must be greater than start",
  });

export const AsmrProjectSchema = z.object({
  project_id: z.string().min(1),
  status: ProjectStatusSchema,
  title: z.string().min(1),
  language: z.string().min(2),
  duration: z.number().positive(),
  scene: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  character: z.object({
    id: z.string().min(1),
    role: z.string().min(1),
    personality: z.array(z.string().min(1)).min(1),
    speech_style: z.array(z.string().min(1)).min(1),
  }),
  emotion_curve: z.array(EmotionCurvePointSchema).min(1),
  timeline: z.object({
    tracks: z.array(TimelineTrackSchema).min(5),
    mixing: z.object({
      target_lufs: z.number().min(-30).max(-10),
      binaural: z.boolean(),
      master_limiter: z.boolean(),
    }),
  }),
  exports: z.array(
    z.object({
      type: z.enum(["project_json", "srt", "mp3", "wav", "stems_wav"]),
      status: z.enum(["not_started", "exporting", "exported", "export_failed"]),
      uri: z.string().nullable(),
    }),
  ),
});

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type TrackType = z.infer<typeof TrackTypeSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
export type AsmrProject = z.infer<typeof AsmrProjectSchema>;
```

- [ ] **Step 4: Run tests to verify schema passes**

Run:

```powershell
npm run test --prefix apps/web -- src/lib/asmr/schema.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/src/lib/asmr/schema.ts apps/web/src/lib/asmr/schema.test.ts
git commit -m "feat: define asmr project schema"
```

Expected: commit succeeds.

## Task 4: Add Mock Project And View Model Helpers

**Files:**
- Create: `apps/web/src/lib/asmr/mock-project.ts`
- Create: `apps/web/src/lib/asmr/validate.ts`
- Create: `apps/web/src/lib/asmr/view-model.ts`
- Create: `apps/web/src/lib/asmr/view-model.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Create `apps/web/src/lib/asmr/view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { flattenClips, formatSeconds, getPositionLabel, getTrackSummary } from "./view-model";

describe("view model helpers", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatSeconds(78.5)).toBe("01:18");
  });

  it("labels left ear positions", () => {
    expect(getPositionLabel({ pan: -0.72, distance: "close", movement: "static" })).toBe("左耳 · close");
  });

  it("flattens clips across tracks in time order", () => {
    const clips = flattenClips(demoProject);
    expect(clips[0].id).toBe("ambience_rain_001");
    expect(clips.some((clip) => clip.id === "voice_003")).toBe(true);
  });

  it("summarizes track clip counts", () => {
    const summary = getTrackSummary(demoProject);
    expect(summary.voice).toBe(4);
    expect(summary.ambience).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test --prefix apps/web -- src/lib/asmr/view-model.test.ts
```

Expected: FAIL with import errors for `./mock-project` and `./view-model`.

- [ ] **Step 3: Add validation helpers**

Create `apps/web/src/lib/asmr/validate.ts`:

```ts
import { AsmrProjectSchema, type AsmrProject, type TimelineClip } from "./schema";

export function parseAsmrProject(input: unknown): AsmrProject {
  return AsmrProjectSchema.parse(input);
}

export function safeParseAsmrProject(input: unknown) {
  return AsmrProjectSchema.safeParse(input);
}

export function getAllClips(project: AsmrProject): TimelineClip[] {
  return project.timeline.tracks.flatMap((track) => track.clips);
}
```

- [ ] **Step 4: Add mock project**

Create `apps/web/src/lib/asmr/mock-project.ts`:

```ts
import { parseAsmrProject } from "./validate";

const baseGeneration = {
  status: "asset_pending" as const,
  model: "mock_tts",
  seed: 12345,
  temperature: 0.7,
  retry_count: 0,
  error: null,
};

const emptyAsset = {
  asset_id: null,
  uri: null,
  duration: null,
};

export const demoProject = parseAsmrProject({
  project_id: "asmr_demo_001",
  status: "ready_for_preview",
  title: "雨夜睡前陪伴",
  language: "zh",
  duration: 210,
  scene: {
    id: "rainy_night_bedroom",
    name: "雨夜陪伴",
  },
  character: {
    id: "voice_card_001",
    role: "older_sister",
    personality: ["gentle", "mature", "comforting"],
    speech_style: ["soft", "slow", "close"],
  },
  emotion_curve: [
    { start: 0, end: 45, emotion: "gentle_intro" },
    { start: 45, end: 130, emotion: "comforting" },
    { start: 130, end: 190, emotion: "sleepy_whisper" },
    { start: 190, end: 210, emotion: "fade_out" },
  ],
  timeline: {
    tracks: [
      {
        track_type: "voice",
        clips: [
          {
            id: "voice_001",
            track: "voice",
            type: "voice",
            start: 16,
            duration: 7.5,
            text: "你还没睡吗？没关系，我陪你一会儿。",
            emotion: "comforting",
            style: "whisper",
            pace: "slow",
            volume_db: -12,
            fade_in: 0.05,
            fade_out: 0.2,
            position: { pan: -0.72, distance: "close", movement: "static" },
            generation: baseGeneration,
            asset: emptyAsset,
          },
          {
            id: "voice_002",
            track: "voice",
            type: "voice",
            start: 58,
            duration: 8.2,
            text: "雨声刚刚好，你不用想太多，慢慢呼吸就好。",
            emotion: "gentle",
            style: "soft",
            pace: "slow",
            volume_db: -13,
            fade_in: 0.08,
            fade_out: 0.24,
            position: { pan: 0.08, distance: "near", movement: "static" },
            generation: { ...baseGeneration, seed: 12346 },
            asset: emptyAsset,
          },
          {
            id: "voice_003",
            track: "voice",
            type: "voice",
            start: 112,
            duration: 7.8,
            text: "我换到你右边，小声一点，不会吵到你。",
            emotion: "sleepy_whisper",
            style: "whisper",
            pace: "slow",
            volume_db: -14,
            fade_in: 0.08,
            fade_out: 0.28,
            position: { pan: 0.78, distance: "very_close", movement: "static" },
            generation: { ...baseGeneration, seed: 12347 },
            asset: emptyAsset,
          },
          {
            id: "voice_004",
            track: "voice",
            type: "voice",
            start: 178,
            duration: 6.8,
            text: "好了，眼睛闭上吧，我就在这里。",
            emotion: "fade_out",
            style: "soft",
            pace: "slow",
            volume_db: -16,
            fade_in: 0.12,
            fade_out: 0.8,
            position: { pan: -0.18, distance: "near", movement: "recede" },
            generation: { ...baseGeneration, seed: 12348 },
            asset: emptyAsset,
          },
        ],
      },
      {
        track_type: "breath",
        clips: [
          {
            id: "breath_001",
            track: "breath",
            type: "breath",
            breath: "soft_breath",
            start: 28,
            duration: 2.4,
            volume_db: -30,
            fade_in: 0.15,
            fade_out: 0.4,
            position: { pan: -0.65, distance: "very_close", movement: "static" },
            generation: { ...baseGeneration, model: "mock_breath", seed: 22001 },
            asset: emptyAsset,
          },
          {
            id: "breath_002",
            track: "breath",
            type: "breath",
            breath: "tiny_laugh",
            start: 126,
            duration: 1.9,
            volume_db: -28,
            fade_in: 0.08,
            fade_out: 0.35,
            position: { pan: 0.72, distance: "close", movement: "static" },
            generation: { ...baseGeneration, model: "mock_breath", seed: 22002 },
            asset: emptyAsset,
          },
        ],
      },
      {
        track_type: "sfx",
        clips: [
          {
            id: "sfx_blanket_001",
            track: "sfx",
            type: "sfx",
            sfx: "blanket_rustle",
            start: 42,
            duration: 3.4,
            volume_db: -25,
            fade_in: 0.2,
            fade_out: 0.6,
            position: { pan: -0.48, distance: "near", movement: "static" },
            generation: { ...baseGeneration, model: "mock_sfx", seed: 33001 },
            asset: emptyAsset,
          },
          {
            id: "sfx_cloth_001",
            track: "sfx",
            type: "sfx",
            sfx: "cloth_rustle",
            start: 98,
            duration: 2.8,
            volume_db: -27,
            fade_in: 0.18,
            fade_out: 0.5,
            position: { pan: 0.44, distance: "near", movement: "left_to_right" },
            generation: { ...baseGeneration, model: "mock_sfx", seed: 33002 },
            asset: emptyAsset,
          },
        ],
      },
      {
        track_type: "ambience",
        clips: [
          {
            id: "ambience_rain_001",
            track: "ambience",
            type: "ambience",
            ambience: "rain_room_tone",
            loop: true,
            start: 0,
            duration: 210,
            volume_db: -31,
            fade_in: 2,
            fade_out: 5,
            position: { pan: 0, distance: "far", movement: "static" },
            generation: { ...baseGeneration, model: "mock_ambience", seed: 44001 },
            asset: emptyAsset,
          },
        ],
      },
      { track_type: "post_processing", clips: [] },
    ],
    mixing: {
      target_lufs: -18,
      binaural: true,
      master_limiter: true,
    },
  },
  exports: [
    { type: "project_json", status: "not_started", uri: null },
    { type: "srt", status: "not_started", uri: null },
    { type: "mp3", status: "not_started", uri: null },
    { type: "stems_wav", status: "not_started", uri: null },
  ],
});
```

- [ ] **Step 5: Add view-model helpers**

Create `apps/web/src/lib/asmr/view-model.ts`:

```ts
import type { AsmrProject, TimelineClip } from "./schema";
import { getAllClips } from "./validate";

export function formatSeconds(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60).toString().padStart(2, "0");
  const rest = (whole % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function formatTimeRange(start: number, duration: number): string {
  return `${formatSeconds(start)}-${formatSeconds(start + duration)}`;
}

export function getPositionLabel(position: TimelineClip["position"]): string {
  const ear = position.pan < -0.35 ? "左耳" : position.pan > 0.35 ? "右耳" : "中间";
  return `${ear} · ${position.distance}`;
}

export function flattenClips(project: AsmrProject): TimelineClip[] {
  return getAllClips(project).sort((a, b) => a.start - b.start);
}

export function getTrackSummary(project: AsmrProject): Record<string, number> {
  return Object.fromEntries(
    project.timeline.tracks.map((track) => [track.track_type, track.clips.length]),
  );
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm run test --prefix apps/web -- src/lib/asmr/schema.test.ts src/lib/asmr/view-model.test.ts
```

Expected: PASS with 7 tests.

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/web/src/lib/asmr
git commit -m "feat: add demo project and timeline helpers"
```

Expected: commit succeeds.

## Task 5: Add Studio Visual Foundation

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Replace global styles**

Modify `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --studio-bg: #080b10;
  --studio-panel: #101620;
  --studio-panel-soft: #131d2a;
  --studio-line: rgba(148, 163, 184, 0.18);
  --studio-text: #e5edf7;
  --studio-muted: #8fa1b7;
  --studio-blue: #38bdf8;
  --studio-violet: #a78bfa;
  --studio-gold: #f8c76c;
  --studio-green: #53d6a2;
}

* {
  box-sizing: border-box;
}

html {
  min-height: 100%;
  background: var(--studio-bg);
}

body {
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 18% 8%, rgba(56, 189, 248, 0.13), transparent 28rem),
    radial-gradient(circle at 84% 14%, rgba(167, 139, 250, 0.10), transparent 26rem),
    linear-gradient(180deg, #0b1018 0%, #080b10 42%, #07090d 100%);
  color: var(--studio-text);
  font-family: Arial, Helvetica, sans-serif;
  font-feature-settings: "tnum";
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  color: inherit;
}

::selection {
  background: rgba(56, 189, 248, 0.28);
}
```

- [ ] **Step 2: Update metadata**

Modify `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI ASMR Studio",
  description: "A director console for editable binaural ASMR timelines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint --prefix apps/web
```

Expected: zero lint errors.

- [ ] **Step 4: Commit**

Run:

```powershell
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx
git commit -m "style: add studio visual foundation"
```

Expected: commit succeeds.

## Task 6: Build Studio Components

**Files:**
- Create: `apps/web/src/components/studio/status-badge.tsx`
- Create: `apps/web/src/components/studio/project-header.tsx`
- Create: `apps/web/src/components/studio/storyboard-panel.tsx`
- Create: `apps/web/src/components/studio/timeline-panel.tsx`
- Create: `apps/web/src/components/studio/clip-inspector.tsx`
- Create: `apps/web/src/components/studio/studio-app.tsx`

- [ ] **Step 1: Add status badge**

Create `apps/web/src/components/studio/status-badge.tsx`:

```tsx
import { clsx } from "clsx";
import type { AssetStatus, ProjectStatus } from "@/lib/asmr/schema";

type StatusBadgeProps = {
  status: AssetStatus | ProjectStatus;
};

const toneByStatus: Record<string, string> = {
  ready_for_preview: "border-sky-300/35 bg-sky-300/10 text-sky-100",
  draft: "border-slate-300/25 bg-slate-300/10 text-slate-200",
  planning_failed: "border-rose-300/40 bg-rose-300/10 text-rose-100",
  timeline_invalid: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  export_failed: "border-rose-300/40 bg-rose-300/10 text-rose-100",
  asset_pending: "border-slate-300/25 bg-slate-300/10 text-slate-200",
  asset_generating: "border-violet-300/35 bg-violet-300/10 text-violet-100",
  asset_generated: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
  asset_failed: "border-rose-300/40 bg-rose-300/10 text-rose-100",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium uppercase tracking-[0.12em]",
        toneByStatus[status],
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
```

- [ ] **Step 2: Add project header**

Create `apps/web/src/components/studio/project-header.tsx`:

```tsx
"use client";

import { Download, Radio, SlidersHorizontal } from "lucide-react";
import type { AsmrProject } from "@/lib/asmr/schema";
import { StatusBadge } from "./status-badge";

type ProjectHeaderProps = {
  project: AsmrProject;
  onExport: () => void;
};

export function ProjectHeader({ project, onExport }: ProjectHeaderProps) {
  return (
    <header className="flex min-h-20 flex-col gap-4 border-b border-white/10 bg-slate-950/60 px-5 py-4 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/90">
            <Radio size={14} />
            AI ASMR Studio
          </span>
          <StatusBadge status={project.status} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-2xl font-semibold tracking-normal text-white">{project.title}</h1>
          <span className="pb-1 text-sm text-slate-400">
            {project.scene.name} · {Math.round(project.duration / 60)} min · {project.language}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300">
          <SlidersHorizontal size={16} />
          LUFS {project.timeline.mixing.target_lufs}
        </div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-300 px-3.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-200"
        >
          <Download size={16} />
          Export JSON
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Add storyboard panel**

Create `apps/web/src/components/studio/storyboard-panel.tsx`:

```tsx
"use client";

import { clsx } from "clsx";
import type { TimelineClip } from "@/lib/asmr/schema";
import { flattenClips, formatTimeRange, getPositionLabel } from "@/lib/asmr/view-model";
import type { AsmrProject } from "@/lib/asmr/schema";
import { StatusBadge } from "./status-badge";

type StoryboardPanelProps = {
  project: AsmrProject;
  selectedClipId: string;
  onSelectClip: (clipId: string) => void;
};

function getClipTitle(clip: TimelineClip): string {
  if (clip.type === "voice") return clip.text;
  if (clip.type === "breath") return clip.breath;
  if (clip.type === "sfx") return clip.sfx;
  return clip.ambience;
}

function getClipMeta(clip: TimelineClip): string {
  if (clip.type === "voice") return `${clip.emotion} · ${clip.style} · ${clip.pace}`;
  if (clip.type === "ambience") return "looping ambience";
  return clip.type;
}

export function StoryboardPanel({ project, selectedClipId, onSelectClip }: StoryboardPanelProps) {
  const clips = flattenClips(project);

  return (
    <section className="min-h-0 rounded-lg border border-white/10 bg-slate-950/48 shadow-2xl shadow-black/20">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
          Director Storyboard
        </h2>
        <p className="mt-1 text-xs text-slate-500">Every audible event is rendered from the Timeline DSL.</p>
      </div>
      <div className="max-h-[calc(100vh-13rem)] space-y-2 overflow-auto p-3">
        {clips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => onSelectClip(clip.id)}
            className={clsx(
              "grid w-full grid-cols-[4.5rem_1fr] gap-3 rounded-md border p-3 text-left transition",
              selectedClipId === clip.id
                ? "border-sky-300/50 bg-sky-300/10"
                : "border-white/8 bg-white/[0.035] hover:border-white/18 hover:bg-white/[0.055]",
            )}
          >
            <div className="text-xs font-medium text-slate-400">
              {formatTimeRange(clip.start, clip.duration)}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-300">
                  {clip.track}
                </span>
                <span className="text-xs text-sky-100">{getPositionLabel(clip.position)}</span>
                <StatusBadge status={clip.generation.status} />
              </div>
              <p className="break-words text-sm leading-6 text-slate-100">{getClipTitle(clip)}</p>
              <p className="mt-1 text-xs text-slate-500">{getClipMeta(clip)}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add timeline panel**

Create `apps/web/src/components/studio/timeline-panel.tsx`:

```tsx
"use client";

import { clsx } from "clsx";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";

type TimelinePanelProps = {
  project: AsmrProject;
  selectedClipId: string;
  onSelectClip: (clipId: string) => void;
};

const trackLabels: Record<string, string> = {
  voice: "Voice",
  breath: "Breath",
  sfx: "SFX",
  ambience: "Room",
  post_processing: "Post",
};

const clipTone: Record<string, string> = {
  voice: "bg-gradient-to-r from-sky-300 to-violet-300",
  breath: "bg-emerald-300",
  sfx: "bg-amber-300",
  ambience: "bg-sky-300/25",
};

function getClipStyle(clip: TimelineClip, duration: number) {
  const left = Math.max(0, (clip.start / duration) * 100);
  const width = Math.max(2, (clip.duration / duration) * 100);
  return {
    left: `${left}%`,
    width: `${Math.min(width, 100 - left)}%`,
  };
}

export function TimelinePanel({ project, selectedClipId, onSelectClip }: TimelinePanelProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/48 p-4 shadow-2xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
            Timeline
          </h2>
          <p className="mt-1 text-xs text-slate-500">Fixed V0.1 tracks, rendered from the same project JSON.</p>
        </div>
        <span className="text-xs text-slate-500">{project.duration}s</span>
      </div>
      <div className="space-y-2">
        {project.timeline.tracks.map((track) => (
          <div key={track.track_type} className="grid grid-cols-[5rem_1fr] items-center gap-3">
            <div className="text-xs font-medium text-slate-400">{trackLabels[track.track_type]}</div>
            <div className="relative h-11 overflow-hidden rounded-md border border-white/10 bg-white/[0.035]">
              <div className="absolute inset-y-0 left-1/4 w-px bg-white/5" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/5" />
              <div className="absolute inset-y-0 left-3/4 w-px bg-white/5" />
              {track.clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => onSelectClip(clip.id)}
                  style={getClipStyle(clip, project.duration)}
                  className={clsx(
                    "absolute top-2 h-7 rounded-[5px] border border-white/20 shadow-lg transition",
                    clipTone[clip.type],
                    selectedClipId === clip.id ? "ring-2 ring-white/80" : "hover:ring-2 hover:ring-white/45",
                  )}
                  aria-label={clip.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add clip inspector**

Create `apps/web/src/components/studio/clip-inspector.tsx`:

```tsx
import type { TimelineClip } from "@/lib/asmr/schema";
import { formatTimeRange, getPositionLabel } from "@/lib/asmr/view-model";
import { StatusBadge } from "./status-badge";

type ClipInspectorProps = {
  clip: TimelineClip;
};

function getPrimaryText(clip: TimelineClip): string {
  if (clip.type === "voice") return clip.text;
  if (clip.type === "breath") return clip.breath;
  if (clip.type === "sfx") return clip.sfx;
  return clip.ambience;
}

export function ClipInspector({ clip }: ClipInspectorProps) {
  return (
    <aside className="rounded-lg border border-white/10 bg-slate-950/48 p-4 shadow-2xl shadow-black/20">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
            Clip Inspector
          </h2>
          <p className="mt-1 text-xs text-slate-500">{clip.id}</p>
        </div>
        <StatusBadge status={clip.generation.status} />
      </div>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-xs uppercase tracking-[0.14em] text-slate-500">Content</div>
          <p className="rounded-md border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-slate-100">
            {getPrimaryText(clip)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <dt className="text-xs text-slate-500">Time</dt>
            <dd className="mt-1 text-slate-100">{formatTimeRange(clip.start, clip.duration)}</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <dt className="text-xs text-slate-500">Position</dt>
            <dd className="mt-1 text-slate-100">{getPositionLabel(clip.position)}</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <dt className="text-xs text-slate-500">Volume</dt>
            <dd className="mt-1 text-slate-100">{clip.volume_db} dB</dd>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <dt className="text-xs text-slate-500">Model</dt>
            <dd className="mt-1 text-slate-100">{clip.generation.model}</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Add studio app**

Create `apps/web/src/components/studio/studio-app.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { AsmrProject } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { ClipInspector } from "./clip-inspector";
import { ProjectHeader } from "./project-header";
import { StoryboardPanel } from "./storyboard-panel";
import { TimelinePanel } from "./timeline-panel";

type StudioAppProps = {
  project: AsmrProject;
};

export function StudioApp({ project }: StudioAppProps) {
  const clips = useMemo(() => flattenClips(project), [project]);
  const [selectedClipId, setSelectedClipId] = useState(clips[0]?.id ?? "");
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? clips[0];

  function exportJson() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.project_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen">
      <ProjectHeader project={project} onExport={exportJson} />
      <div className="mx-auto grid w-full max-w-[1720px] gap-4 p-4 lg:grid-cols-[minmax(24rem,34rem)_1fr] xl:grid-cols-[minmax(26rem,36rem)_1fr_minmax(20rem,24rem)]">
        <StoryboardPanel
          project={project}
          selectedClipId={selectedClip?.id ?? ""}
          onSelectClip={setSelectedClipId}
        />
        <div className="space-y-4">
          <TimelinePanel
            project={project}
            selectedClipId={selectedClip?.id ?? ""}
            onSelectClip={setSelectedClipId}
          />
          <section className="rounded-lg border border-white/10 bg-slate-950/42 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
              Emotion Curve
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {project.emotion_curve.map((point) => (
                <div key={`${point.start}-${point.end}`} className="rounded-md border border-white/10 bg-white/[0.035] p-3">
                  <div className="text-xs text-slate-500">
                    {point.start}s-{point.end}s
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-100">{point.emotion}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
        {selectedClip ? <ClipInspector clip={selectedClip} /> : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Run lint**

Run:

```powershell
npm run lint --prefix apps/web
```

Expected: zero lint errors.

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/web/src/components/studio
git commit -m "feat: build studio console components"
```

Expected: commit succeeds.

## Task 7: Wire Page To Demo Project

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Replace homepage**

Modify `apps/web/src/app/page.tsx`:

```tsx
import { StudioApp } from "@/components/studio/studio-app";
import { demoProject } from "@/lib/asmr/mock-project";

export default function Home() {
  return <StudioApp project={demoProject} />;
}
```

- [ ] **Step 2: Run unit tests**

Run:

```powershell
npm run test --prefix apps/web
```

Expected: PASS with 7 tests.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint --prefix apps/web
```

Expected: zero lint errors.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm run build --prefix apps/web
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/src/app/page.tsx
git commit -m "feat: render v0 studio prototype"
```

Expected: commit succeeds.

## Task 8: Browser Visual Verification

**Files:**
- No required file changes unless verification finds a concrete issue.

- [ ] **Step 1: Start dev server**

Run:

```powershell
npm run dev --prefix apps/web -- --port 3000
```

Expected:

```text
Local: http://localhost:3000
```

- [ ] **Step 2: Open in browser**

Open:

```text
http://localhost:3000
```

Expected:

- First viewport shows `AI ASMR Studio`.
- First viewport shows storyboard and timeline, not a landing page.
- The page reads as Studio Console first, Ambient Director second.

- [ ] **Step 3: Desktop visual checklist**

At desktop width, verify:

- Header, storyboard, timeline, and inspector are visible without incoherent overlap.
- Storyboard rows are scannable and selected state is obvious.
- Timeline tracks have stable dimensions and clip blocks do not resize the layout.
- Ambient glow is subtle and does not reduce text contrast.
- Buttons fit their text.
- JSON export downloads `asmr_demo_001.json`.

- [ ] **Step 4: Mobile visual checklist**

At mobile width, verify:

- Header wraps cleanly.
- Storyboard appears before timeline.
- Clip inspector does not cover content.
- Long Chinese lines wrap inside their containers.
- Timeline remains readable or scrolls without overlapping labels.

- [ ] **Step 5: Fix concrete visual defects**

For each defect, make the smallest CSS or component change that fixes the issue, then run:

```powershell
npm run lint --prefix apps/web
npm run build --prefix apps/web
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/src
git commit -m "polish: verify studio console layout"
```

Expected: commit succeeds if visual fixes were made. If no file changed, record that verification passed without a commit.

## Final Verification

Run:

```powershell
npm run test --prefix apps/web
npm run lint --prefix apps/web
npm run build --prefix apps/web
```

Expected:

- Unit tests pass.
- Lint passes.
- Production build passes.

Open `http://localhost:3000` and confirm:

- The page is a usable ASMR director console.
- It is visually closer to a polished creator tool than a default generated page.
- The UI renders from `demoProject`.
- Export JSON works.
- No real audio generation is implied by the interface; asset states are visibly pending.
