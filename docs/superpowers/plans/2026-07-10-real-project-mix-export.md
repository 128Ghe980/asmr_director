# Real Project Mix Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Roadmap Step 9 so generated `asset://clip/...` files are mixed into a real `asset://mix/...` WAV that can be previewed and downloaded from the workbench.

**Architecture:** Keep Step 9 local-first. Add focused pure helpers for mix readiness, fingerprints, WAV decode/render, and project export state; extend the local runtime asset store and API routes for `asset://mix/...`; then wire the existing bridge/runtime/view/UI boundaries to run a project mix job without persisting runtime state.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Node `fs/promises`, existing ASMR Project JSON schema, existing local runtime under `D:\CodexWorkplace\asmr_director_runtime`.

## Global Constraints

- Do not add MP3, stems, cloud persistence, auth, billing, publishing, collaboration, or real waveform extraction.
- Do not auto-generate missing clips; project mix requires every audio-bearing clip to have `asset://clip/...`.
- Do not persist runtime job IDs, progress, local paths, `blob:` URLs, or `data:audio` URLs into Project JSON.
- Keep implementation details inside Roadmap Step 9; do not create new roadmap gates for bridge/API/adapter cleanup.
- Use TDD for behavior changes in `apps/web/src/lib/asmr/`.
- Preserve short Chinese UI copy.
- Keep existing selected-clip generation behavior working.

---

### Task 1: Runtime Config, Mix Asset Store, And Playback URI

**Files:**
- Modify: `apps/web/src/lib/asmr/local-runtime-config.ts`
- Modify: `apps/web/src/lib/asmr/local-runtime-config.test.ts`
- Modify: `apps/web/src/lib/asmr/local-asset-store.ts`
- Modify: `apps/web/src/lib/asmr/local-asset-store.test.ts`
- Modify: `apps/web/src/lib/asmr/playback-asset-resolver.ts`
- Modify: `apps/web/src/lib/asmr/playback-asset-resolver.test.ts`

**Interfaces:**
- Produces: `LocalRuntimeConfig["mixAssetRoot"]`
- Produces: `resolveMixAssetPath(assetId: string, config: LocalRuntimeConfig): string`
- Produces: `saveMixAsset({ config, projectId, exportType, wav, duration, now? }): Promise<GeneratedAssetResult>`
- Produces: `isLocalMixAssetUri(uri: string | null | undefined): boolean`
- Produces: `resolvePlayableAssetUri("asset://mix/<id>") === "/api/assets/mix/<id>"`

- [ ] **Step 1: Write failing runtime config tests**

Add assertions to `apps/web/src/lib/asmr/local-runtime-config.test.ts`:

```ts
expect(config.mixAssetRoot).toBe(
  path.join(
    "D:\\CodexWorkplace\\asmr_director_runtime",
    "assets",
    "mixes",
    "app",
  ),
);
```

And in override test:

```ts
const config = getLocalRuntimeConfig({
  ASMR_DIRECTOR_RUNTIME_ROOT: "E:\\runtime",
  ASMR_MIX_ASSET_ROOT: "E:\\assets\\mixes",
});
expect(config.mixAssetRoot).toBe("E:\\assets\\mixes");
```

- [ ] **Step 2: Run runtime config test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-runtime-config.test.ts
```

Expected: FAIL because `mixAssetRoot` does not exist.

- [ ] **Step 3: Implement runtime config**

Add `mixAssetRoot` to `LocalRuntimeConfig`, accept `ASMR_MIX_ASSET_ROOT`, and default to:

```ts
path.join(runtimeRoot, "assets", "mixes", "app")
```

- [ ] **Step 4: Verify runtime config GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-runtime-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing mix asset store tests**

In `apps/web/src/lib/asmr/local-asset-store.test.ts`, extend `makeConfig` to include `mixAssetRoot`. Add tests:

```ts
it("stores WAV bytes and returns a durable mix asset URI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asmr-assets-"));
  const config = makeConfig(path.join(root, "clips"), path.join(root, "mixes"));
  const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

  const asset = await saveMixAsset({
    config,
    projectId: "asmr_demo_001",
    exportType: "wav",
    wav,
    duration: 210,
    now: new Date("2026-07-10T00:00:00.000Z"),
  });

  expect(asset.assetId).toMatch(/^asmr_demo_001_wav_20260710T000000000Z_[a-z0-9]+$/);
  expect(asset.uri).toBe(`asset://mix/${asset.assetId}`);
  expect(asset.duration).toBe(210);
  await expect(readFile(resolveMixAssetPath(asset.assetId, config))).resolves.toEqual(Buffer.from(wav));
});

it("rejects unsafe mix asset IDs", () => {
  const config = makeConfig("D:\\runtime\\clips", "D:\\runtime\\mixes");

  expect(() => resolveMixAssetPath("..\\secret", config)).toThrow("Invalid mix asset id");
  expect(() => resolveMixAssetPath("../secret", config)).toThrow("Invalid mix asset id");
});
```

- [ ] **Step 6: Run asset store test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-asset-store.test.ts
```

Expected: FAIL because `saveMixAsset` and `resolveMixAssetPath` do not exist.

- [ ] **Step 7: Implement mix asset store**

Add `saveMixAsset` and `resolveMixAssetPath` using the same safe segment guard as clip assets. Use asset ID shape:

```ts
`${projectId}_${exportType}_${makeTimestamp(now)}_${randomUUID().replace(/-/g, "").slice(0, 8)}`
```

Return:

```ts
{ assetId, uri: `asset://mix/${assetId}`, duration }
```

- [ ] **Step 8: Verify asset store GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-asset-store.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing playback resolver test**

In `apps/web/src/lib/asmr/playback-asset-resolver.test.ts`, add:

```ts
expect(isLocalMixAssetUri("asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234")).toBe(true);
expect(resolvePlayableAssetUri("asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234")).toBe(
  "/api/assets/mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
);
```

- [ ] **Step 10: Run playback resolver test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/playback-asset-resolver.test.ts
```

Expected: FAIL because mix URI handling does not exist.

- [ ] **Step 11: Implement playback resolver support**

Add:

```ts
const localMixAssetPrefix = "asset://mix/";
export function isLocalMixAssetUri(uri: string | null | undefined): boolean;
```

Map `asset://mix/<assetId>` to `/api/assets/mix/<encodedAssetId>`.

- [ ] **Step 12: Verify Task 1**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-runtime-config.test.ts src/lib/asmr/local-asset-store.test.ts src/lib/asmr/playback-asset-resolver.test.ts
```

Expected: PASS.

### Task 2: Project Mix Readiness, Export State, And Fingerprint

**Files:**
- Create: `apps/web/src/lib/asmr/project-mix-state.ts`
- Create: `apps/web/src/lib/asmr/project-mix-state.test.ts`
- Modify: `apps/web/src/lib/asmr/generation-fingerprint.ts`
- Modify: `apps/web/src/lib/asmr/generation-fingerprint.test.ts`

**Interfaces:**
- Produces: `getMissingProjectMixClipIds(project: AsmrProject): string[]`
- Produces: `canGenerateProjectMix(project: AsmrProject): boolean`
- Produces: `getWavExport(project: AsmrProject)`
- Produces: `commitProjectMixSuccess(project, asset): AsmrProject`
- Produces: `commitProjectMixFailure(project, { reason, error }): AsmrProject`
- Produces: `getProjectMixFingerprint(project: AsmrProject, exportType?: "wav"): string`
- Produces: `isCurrentProjectMixFingerprint(project, fingerprint, exportType?): boolean`

- [ ] **Step 1: Write failing project mix state tests**

Create `apps/web/src/lib/asmr/project-mix-state.test.ts` with tests for:

```ts
it("lists every audio-bearing clip without a local generated asset", () => {});
it("allows project mix only when every audio-bearing clip has asset://clip", () => {});
it("commits successful wav mix into an existing or new wav export", () => {});
it("preserves previous exported mix when remix fails", () => {});
it("clears wav export on first mix failure", () => {});
```

Use `commitGenerationSuccess` to mark demo clips generated. Use `asset://clip/<clipId>_asset` URIs.

- [ ] **Step 2: Run project mix state test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-mix-state.test.ts
```

Expected: FAIL because `project-mix-state.ts` does not exist.

- [ ] **Step 3: Implement project mix state helper**

Create `apps/web/src/lib/asmr/project-mix-state.ts` with pure immutable helpers. Treat `voice`, `breath`, `sfx`, and `ambience` clips as audio-bearing. Require `asset.asset_id`, `asset.uri`, `asset://clip/`, and `asset_generated`.

- [ ] **Step 4: Verify project mix state GREEN**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-mix-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing fingerprint tests**

In `apps/web/src/lib/asmr/generation-fingerprint.test.ts`, add tests:

```ts
it("changes project mix fingerprint when clip timing, mixing, or asset uri changes", () => {});
it("ignores wav export uri when computing project mix fingerprint", () => {});
it("rejects stale project mix commits when the current project mix fingerprint changed", () => {});
```

- [ ] **Step 6: Run fingerprint test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/generation-fingerprint.test.ts
```

Expected: FAIL because project mix fingerprint helpers do not exist.

- [ ] **Step 7: Implement project mix fingerprint**

Add `getProjectMixFingerprint` and `isCurrentProjectMixFingerprint`. Include project/timeline/mixing/audio-bearing clip fields and clip asset URI/duration. Exclude exports and runtime data.

- [ ] **Step 8: Verify Task 2**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-mix-state.test.ts src/lib/asmr/generation-fingerprint.test.ts
```

Expected: PASS.

### Task 3: WAV Decoder And Project Mix Renderer

**Files:**
- Create: `apps/web/src/lib/asmr/project-mix-renderer.ts`
- Create: `apps/web/src/lib/asmr/project-mix-renderer.test.ts`

**Interfaces:**
- Produces: `decodePcmWav(bytes: Uint8Array | Buffer): DecodedPcmAudio`
- Produces: `writePcm16StereoWav(samples: Float32Array, sampleRate: number): Uint8Array`
- Produces: `renderProjectMixWav({ project, loadClipAsset, sampleRate? }): Promise<Uint8Array>`
- Consumes: `getMissingProjectMixClipIds`

- [ ] **Step 1: Write failing decoder/encoder tests**

Create tests proving:

```ts
decodePcmWav(writePcm16StereoWav(samples, 32000))
```

returns sample rate `32000`, `channels: 2`, and expected sample count. Add malformed WAV rejection test.

- [ ] **Step 2: Run renderer test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-mix-renderer.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement WAV decode/write basics**

Support PCM format code `1`, 16-bit samples, mono/stereo. Write stereo 16-bit PCM WAV with `RIFF`, `WAVE`, `fmt `, and `data`.

- [ ] **Step 4: Verify decoder/encoder GREEN**

Run focused renderer test. Expected: PASS for decoder/encoder tests.

- [ ] **Step 5: Add failing timeline placement tests**

Add tests with a 2-second project and a 1-second generated clip at `start: 1`. Assert first second is silent and second second has non-zero samples.

- [ ] **Step 6: Implement basic placement**

Implement output allocation, clip loading, mono conversion, trim/pad to `clip.duration`, and placement at `clip.start`.

- [ ] **Step 7: Add failing gain/fade/pan tests**

Add tests showing:

- `volume_db: -6` reduces peak versus `0`.
- `fade_in` makes first samples quieter than later samples.
- `position.pan: -1` produces stronger left channel than right.

- [ ] **Step 8: Implement gain/fade/pan/distance/movement**

Implement:

- dB to gain.
- fade in/out envelope.
- equal-power pan.
- distance gain map.
- movement pan/gain interpolation for `left_to_right`, `right_to_left`, `approach`, `recede`.

- [ ] **Step 9: Add failing loop/normalization/limiter tests**

Add tests showing:

- looped ambience repeats source shorter than target duration.
- limiter clamps peaks to `[-1, 1]`.
- target normalization changes low-level mix level upward.

- [ ] **Step 10: Implement loop/normalization/limiter**

Repeat `ambience.loop === true`, compute approximate RMS target from `target_lufs`, apply bounded normalization gain, then peak limit when enabled.

- [ ] **Step 11: Verify Task 3**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/project-mix-renderer.test.ts
```

Expected: PASS.

### Task 4: Local Project Mix Generation And API Routes

**Files:**
- Create: `apps/web/src/lib/asmr/local-project-mix-generation.ts`
- Create: `apps/web/src/lib/asmr/local-project-mix-generation.test.ts`
- Create: `apps/web/src/app/api/generation/mix/route.ts`
- Create: `apps/web/src/app/api/assets/mix/[assetId]/route.ts`

**Interfaces:**
- Produces: `generateLocalProjectMix({ project, config, exportType? }): Promise<GeneratedAssetResult>`
- Produces: `POST /api/generation/mix`
- Produces: `GET /api/assets/mix/[assetId]`

- [ ] **Step 1: Write failing local project mix generation tests**

Test that `generateLocalProjectMix`:

- fails with an error containing missing clip IDs when assets are missing.
- reads local clip WAV files using `resolveClipAssetPath`.
- saves a mix with `asset://mix/...`.
- returns duration equal to `project.duration`.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-project-mix-generation.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement local project mix helper**

Use `renderProjectMixWav`, `readFile(resolveClipAssetPath(...))`, and `saveMixAsset`.

- [ ] **Step 4: Verify local project mix helper GREEN**

Run focused test. Expected: PASS.

- [ ] **Step 5: Add API routes**

Create `POST /api/generation/mix` validating `AsmrProjectSchema`, `exportType === "wav"`, and mapping missing assets to status `409`. Create `GET /api/assets/mix/[assetId]` mirroring clip asset route with `resolveMixAssetPath`.

- [ ] **Step 6: Verify API-related tests indirectly**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-project-mix-generation.test.ts
```

Expected: PASS. Full API route behavior will be browser/manual verified in Task 7.

### Task 5: Bridge, Runtime, View Model, And Preview Summary

**Files:**
- Modify: `apps/web/src/lib/asmr/generation-bridge.ts`
- Modify: `apps/web/src/lib/asmr/generation-runtime.ts`
- Modify: `apps/web/src/lib/asmr/generation-runtime.test.ts`
- Modify: `apps/web/src/lib/asmr/local-generation-bridge.ts`
- Modify: `apps/web/src/lib/asmr/local-generation-bridge.test.ts`
- Modify: `apps/web/src/lib/asmr/mock-generation-bridge.ts`
- Modify: `apps/web/src/lib/asmr/generation-summary.ts`
- Modify: `apps/web/src/lib/asmr/generation-summary.test.ts`
- Modify: `apps/web/src/lib/asmr/generation-view.ts`
- Modify: `apps/web/src/lib/asmr/generation-view.test.ts`

**Interfaces:**
- Produces: project mix request/update types.
- Produces: runtime mapping for one project mix job by export type.
- Produces: `ProjectMixControl` inside `GenerationView`.
- Consumes: project mix state and fingerprint helpers.

- [ ] **Step 1: Write failing runtime tests for project mix jobs**

Add tests that `upsertGenerationJob`, `clearGenerationJob`, and `markGenerationJobCanceling` handle a project mix job target separately from clip jobs.

- [ ] **Step 2: Extend generation bridge/runtime types**

Add `GenerationJobTarget = { type: "clip"; clipId } | { type: "project_mix"; exportType: "wav" }`, keep `clipId` compatibility during migration if needed, and add `generateProjectMix` to `GenerationBridge`.

- [ ] **Step 3: Verify runtime tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/generation-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing local bridge tests**

Add tests that `createLocalGenerationBridge().generateProjectMix` emits queued/generating/succeeded, maps `/api/generation/mix` response asset, handles failures, and emits canceled without committing late success.

- [ ] **Step 5: Implement local bridge project mix support**

Add a `mixEndpoint = "/api/generation/mix"` option and implement `generateProjectMix`. Keep selected clip `generateClip` behavior unchanged.

- [ ] **Step 6: Verify bridge tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/local-generation-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 7: Write failing summary/view tests**

Add tests that:

- Preview summary project mix slot reflects missing/ready/exported/stale/mixing states.
- Generation view exposes `projectMixControl` with labels `生成整段`, `重混`, `试听`, and `WAV`.
- A valid `asset://mix/...` enables full-project playback/download.

- [ ] **Step 8: Implement summary/view derivation**

Use `getMissingProjectMixClipIds`, `getWavExport`, `getProjectMixFingerprint`, and runtime project mix job state.

- [ ] **Step 9: Verify Task 5**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/generation-runtime.test.ts src/lib/asmr/local-generation-bridge.test.ts src/lib/asmr/generation-summary.test.ts src/lib/asmr/generation-view.test.ts
```

Expected: PASS.

### Task 6: Studio UI Wiring

**Files:**
- Modify: `apps/web/src/components/studio/preview-layer-panel.tsx`
- Modify: `apps/web/src/components/studio/project-details-dock.tsx`
- Modify: `apps/web/src/components/studio/project-workspace.tsx`
- Modify: `apps/web/src/components/studio/project-workspace-header.tsx`
- Modify: `apps/web/src/components/studio/studio-app.tsx`

**Interfaces:**
- Consumes: `generationView.projectMixControl`
- Produces: Preview Layer buttons for `生成整段` / `重混`, `试听`, and `WAV`
- Produces: handlers `handleGenerateProjectMix`, `handleCancelProjectMix`, `handlePlayProjectMix`, `handleDownloadProjectMix`

- [ ] **Step 1: Wire component props**

Pass project mix control and handlers from `StudioApp` through `ProjectWorkspace` and `ProjectDetailsDock` to `PreviewLayerPanel`.

- [ ] **Step 2: Implement StudioApp project mix handlers**

Use bridge `generateProjectMix`, project mix fingerprint refs, runtime updates, `commitProjectMixSuccess`, `commitProjectMixFailure`, `resolvePlayableAssetUri`, and an anchor download for WAV.

- [ ] **Step 3: Render Preview Layer controls**

Add compact icon/text buttons:

- primary action: `生成整段` or `重混`
- play: `试听`
- download: `WAV`
- cancel while mixing: `取消`

Keep existing selected-clip play button separate.

- [ ] **Step 4: Rename header JSON export if needed**

If both header and Preview Layer show export/download actions, make header copy clearly `JSON` or `导出JSON`.

- [ ] **Step 5: Run focused UI-adjacent tests**

Run:

```powershell
npm.cmd run test --prefix apps/web -- src/lib/asmr/generation-view.test.ts src/lib/asmr/generation-summary.test.ts
```

Expected: PASS.

### Task 7: Docs, Full Verification, And Browser Check

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/project-archive.md`

**Interfaces:**
- Documents Step 9 completion only after verification passes.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

Expected: all pass. Build may show the known SWC/Turbopack warning only if exit code is 0.

- [ ] **Step 2: Browser/manual verification**

Start:

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000 --webpack
```

Use the browser to verify:

- Page loads.
- Generate all required clips or use imported/localStorage project that already has `asset://clip/...`.
- Preview Layer enables `生成整段`.
- Project mix produces `asset://mix/...`.
- `/api/assets/mix/<assetId>` returns `audio/wav` with `RIFF`.
- `试听` plays the mix.
- `WAV` downloads the same route.
- Editing a clip timing marks the old mix stale.

- [ ] **Step 3: Update docs**

After verification, update:

- `docs/ROADMAP.md`: mark Step 9 completed and Step 10 current/next.
- `docs/AI_HANDOFF.md`: record implementation files, runtime defaults, verification outputs, and next work.
- `docs/project-archive.md`: add a Step 9 completion record.

- [ ] **Step 4: Final status**

Run:

```powershell
git status --short --branch
git diff --stat
```

Report changed files, verification evidence, and any remaining risks.
