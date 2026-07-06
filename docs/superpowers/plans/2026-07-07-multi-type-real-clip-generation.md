# Multi-Type Real Clip Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Completed on 2026-07-07. Breath and SFX were verified end-to-end through the workbench UI; ambience is supported by the same local procedural renderer.

**Goal:** Extend selected-clip real generation beyond voice so breath, SFX, and ambience clips can generate playable local WAV assets through the same `asset://clip/...` project contract.

**Architecture:** Keep GPT-SoVITS for voice. Add a local procedural WAV renderer for non-voice clips, then route `generateLocalClip` by clip type. Reuse the existing API route, local asset store, browser bridge, project commit logic, and playback resolver.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Node runtime, Vitest, 32 kHz mono 16-bit PCM WAV, existing ASMR Timeline DSL.

## Global Constraints

- Current roadmap source is `docs/ROADMAP.md`; this work is Step 8 only.
- Do not add project mix/export; that is Step 9.
- Do not download new model runtimes, model weights, or sound libraries.
- Do not commit generated WAVs, local runtime files, model caches, or reference audio.
- Project JSON may store only durable `asset://clip/...` references and final asset metadata.
- Runtime jobs, local absolute paths, browser `blob:` URLs, and `data:audio` URLs must not be serialized into `AsmrProject`.
- Preserve clip-level regeneration: generating one selected clip mutates only that clip.
- Keep voice generation on GPT-SoVITS.
- Use TDD for all behavior changes in `apps/web/src/lib/asmr/`.

---

## File Structure

- Create `apps/web/src/lib/asmr/procedural-audio.ts`: deterministic procedural WAV renderer for `breath`, `sfx`, and `ambience`.
- Create `apps/web/src/lib/asmr/procedural-audio.test.ts`: WAV, determinism, and type behavior tests.
- Modify `apps/web/src/lib/asmr/local-clip-generation.ts`: add `generateLocalClip`, route voice to GPT-SoVITS and non-voice to procedural renderer.
- Modify `apps/web/src/lib/asmr/local-clip-generation.test.ts`: cover non-voice generation and preserve voice behavior.
- Modify `apps/web/src/app/api/generation/clip/route.ts`: call `generateLocalClip`.
- Modify `apps/web/src/lib/asmr/generation-view.test.ts`: document non-voice generated asset preview behavior.
- Modify docs after implementation: `docs/ROADMAP.md`, `docs/AI_HANDOFF.md`, `docs/project-archive.md`.

## Task 1: Procedural WAV Renderer

**Files:**
- Create: `apps/web/src/lib/asmr/procedural-audio.ts`
- Create: `apps/web/src/lib/asmr/procedural-audio.test.ts`

**Interfaces:**
- Produces `canRenderProceduralClip(clip: TimelineClip): clip is ProceduralClip`
- Produces `renderProceduralClipWav(input: RenderProceduralClipInput): Uint8Array`
- Produces `writePcm16MonoWav(samples: Float32Array, sampleRate: number): Uint8Array`

- [x] **Step 1: Write failing tests**

Add tests that assert:

```ts
const wav = renderProceduralClipWav({ clip: breathClip, sampleRate: 32000 });
expect(new TextDecoder("ascii").decode(wav.slice(0, 4))).toBe("RIFF");
expect(new TextDecoder("ascii").decode(wav.slice(8, 12))).toBe("WAVE");
expect(wav.byteLength).toBe(44 + Math.ceil(breathClip.duration * 32000) * 2);
```

Also test same clip + same seed produces identical bytes, different seed produces different bytes, and voice clips are rejected.

- [x] **Step 2: Run the failing test**

Run:

```powershell
npm.cmd run test --prefix apps/web -- procedural-audio
```

Expected: FAIL because `procedural-audio.ts` does not exist.

- [x] **Step 3: Implement renderer**

Implement:

```ts
export type ProceduralClip = Extract<
  TimelineClip,
  { type: "breath" | "sfx" | "ambience" }
>;

export type RenderProceduralClipInput = {
  clip: TimelineClip;
  sampleRate?: number;
};

export function canRenderProceduralClip(
  clip: TimelineClip,
): clip is ProceduralClip;

export function renderProceduralClipWav({
  clip,
  sampleRate = 32000,
}: RenderProceduralClipInput): Uint8Array;

export function writePcm16MonoWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array;
```

Renderer requirements:

- Use a deterministic xorshift / LCG PRNG seeded from `clip.id`, `clip.type`, and `clip.generation.seed`.
- Clamp samples to `[-1, 1]`.
- Apply `fade_in` and `fade_out`, with a minimum safety fade of `0.01s`.
- Apply clip `volume_db` as linear gain, but cap preview gain so samples do not clip.
- `breath`: soft noise with sine swell envelopes.
- `sfx`: friction noise for rubbing/cloth/blanket; decaying impulses for tapping labels.
- `ambience`: continuous rain bed plus sparse droplets.

- [x] **Step 4: Run renderer tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- procedural-audio
```

Expected: PASS.

## Task 2: General Local Clip Generation

**Files:**
- Modify: `apps/web/src/lib/asmr/local-clip-generation.ts`
- Modify: `apps/web/src/lib/asmr/local-clip-generation.test.ts`

**Interfaces:**
- Produces `generateLocalClip(input: GenerateLocalClipInput): Promise<GeneratedAssetResult>`
- Keeps `generateLocalVoiceClip(input: GenerateLocalClipInput): Promise<GeneratedAssetResult>` as a compatibility wrapper.

- [x] **Step 1: Write failing tests**

Add tests that:

```ts
await expect(
  generateLocalClip({ project: demoProject, clipId: "breath_001", config, now }),
).resolves.toMatchObject({
  uri: expect.stringMatching(/^asset:\/\/clip\/breath_001_/),
  duration: expect.any(Number),
});
```

Assert the saved file exists and starts with `RIFF`. Add the same for one SFX clip. Preserve the existing voice test that proves GPT-SoVITS fetch is used for `voice_001`.

- [x] **Step 2: Run local generation tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- local-clip-generation
```

Expected: FAIL because `generateLocalClip` does not exist or non-voice clips still fail.

- [x] **Step 3: Implement routing**

Update `local-clip-generation.ts`:

```ts
export type GenerateLocalClipInput = {
  project: AsmrProject;
  clipId: string;
  config: LocalRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function generateLocalClip(input: GenerateLocalClipInput) {
  const clip = flattenClips(input.project).find(
    (candidate) => candidate.id === input.clipId,
  );

  if (!clip) {
    throw new Error("Clip not found");
  }

  if (canRenderProceduralClip(clip)) {
    const wav = renderProceduralClipWav({ clip });
    return saveClipAsset({
      config: input.config,
      clipId: input.clipId,
      wav,
      duration: clip.duration,
      now: input.now,
    });
  }

  if (clip.type === "voice") {
    const voicePack = await loadVoicePack(input.config);
    const request = buildGptSovitsRequest(clip, voicePack);
    const wav = await requestGptSovitsWav({
      endpoint: voicePack.endpoint || input.config.gptSovitsBaseUrl,
      request,
      fetchImpl: input.fetchImpl,
    });

    return saveClipAsset({
      config: input.config,
      clipId: input.clipId,
      wav,
      duration: clip.duration,
      now: input.now,
    });
  }

  throw new Error("Unsupported clip type");
}
```

Keep `generateLocalVoiceClip` as:

```ts
export async function generateLocalVoiceClip(input: GenerateLocalClipInput) {
  return generateLocalClip(input);
}
```

- [x] **Step 4: Run local generation tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- local-clip-generation procedural-audio
```

Expected: PASS.

## Task 3: API Route and Preview Behavior

**Files:**
- Modify: `apps/web/src/app/api/generation/clip/route.ts`
- Modify: `apps/web/src/lib/asmr/generation-view.test.ts`

**Interfaces:**
- API route calls `generateLocalClip`.
- Existing selected clip preview accepts `asset://clip/...` for every clip type.

- [x] **Step 1: Write failing tests**

In `generation-view.test.ts`, add a non-voice selected clip test:

```ts
const project = markClipGenerated(demoProject, "sfx_blanket_001", {
  asset_id: "sfx_blanket_001_20260707T000000000Z_test",
  uri: "asset://clip/sfx_blanket_001_20260707T000000000Z_test",
  duration: 3,
});

const view = getGenerationView({
  project,
  selectedClip: findClip(project, "sfx_blanket_001"),
  runtimeState: emptyGenerationRuntimeState,
  selectedClipHasValidationIssues: false,
});

expect(view.selectedClipPreview).toMatchObject({
  canPlay: true,
  uri: "asset://clip/sfx_blanket_001_20260707T000000000Z_test",
});
```

- [x] **Step 2: Run preview tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- generation-view
```

Expected: this may already PASS because Step 7 generalized `asset://clip/...`; if it passes, keep the test as regression coverage.

- [x] **Step 3: Update API route**

Change:

```ts
import { generateLocalVoiceClip } from "@/lib/asmr/local-clip-generation";
```

to:

```ts
import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
```

and call `generateLocalClip`.

- [x] **Step 4: Run route-adjacent tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- local-generation-bridge local-clip-generation generation-view playback-asset-resolver
```

Expected: PASS.

## Task 4: Documentation and Browser Verification

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

- [x] **Step 1: Update docs**

Record:

- Step 8 implementation path.
- Supported non-voice types.
- Procedural provider limitations.
- Generated asset examples from manual verification.
- Next roadmap remains Step 8 until at least two non-voice classes are verified.

- [x] **Step 2: Run full verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: all exit 0. Build may still print the known SWC native warning.

- [x] **Step 3: Browser/API verification**

With `npm.cmd run dev --prefix apps/web -- --port 3000 --webpack` running:

1. Generate `breath_001` from the workbench.
2. Confirm Project JSON/localStorage contains `asset://clip/breath_001_...`.
3. Fetch `/api/assets/clip/<assetId>` and confirm `audio/wav`, byte length > 44, header `RIFF`.
4. Repeat for one SFX clip.
5. If runtime cost is acceptable, repeat for `ambience_rain_001`.

- [x] **Step 4: Commit**

Commit message:

```bash
git add apps/web/src/lib/asmr/procedural-audio.ts apps/web/src/lib/asmr/procedural-audio.test.ts apps/web/src/lib/asmr/local-clip-generation.ts apps/web/src/lib/asmr/local-clip-generation.test.ts apps/web/src/app/api/generation/clip/route.ts apps/web/src/lib/asmr/generation-view.test.ts docs/ROADMAP.md docs/AI_HANDOFF.md docs/project-archive.md docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.md docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.zh.md docs/superpowers/plans/2026-07-07-multi-type-real-clip-generation.md
git commit -m "feat: generate non-voice clip assets"
```
