import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioPostProcessingSettingsFingerprint } from "./audio-post-processing";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { inspectProcessedVoiceSource, PROCESSED_VOICE_RENDERER_VERSION, renderProcessedVoice, type ProcessedVoiceSpawn, type RenderProcessedVoiceInput } from "./processed-voice-renderer";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
type Request = Omit<RenderProcessedVoiceInput, "config" | "signal" | "clipId" | "sourceAssetId"> & {
  inputWav: string; outputWav: string; outputJson: string; sourceSha256: string; hrtfPath?: string;
};

async function fixture(channels: 1 | 2 = 1) {
  const base = process.env.ASMR_POST_PROCESSING_TEST_ROOT ?? os.tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "processed-bridge-")); roots.push(root);
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_SPATIAL_PYTHON: path.join(root, "python.exe"), ASMR_SPATIAL_HRTF: path.join(root, "hrtf.sofa") });
  const scriptPath = path.join(root, "scripts/render-processed-voice.py"), codeRoot = path.join(root, "scripts/spatial_d");
  await Promise.all([mkdir(config.clipAssetRoot, { recursive: true }), mkdir(codeRoot, { recursive: true })]);
  for (const filename of [scriptPath, ...["__init__.py", "core.py", "near_field.py", "motion_convolution.py"].map(name => path.join(codeRoot, name))]) await writeFile(filename, "# synthetic clean code");
  await Promise.all([writeFile(config.spatialPythonPath!, "python"), writeFile(config.spatialHrtfPath!, "synthetic hrtf")]);
  const source = writePcm16Wav(new Float32Array(960 * channels).fill(.02), 48000, channels);
  const sourcePath = path.join(config.clipAssetRoot, "voice.wav"); await writeFile(sourcePath, source);
  const input: RenderProcessedVoiceInput = { clipId: "clip_001", sourceAssetId: "voice", start: { pan: -.4, distance: "near" },
    end: { pan: .5, distance: "close" }, movement: "approach", volumeDb: -3, fadeInSeconds: .002, fadeOutSeconds: .003, binaural: true, config };
  const state: { hold: boolean; closeOnKill: boolean; failToStart: boolean; exitCode: number; badReport?: (report: Record<string, unknown>) => void; afterRender?: () => Promise<void> } = {
    hold: false, closeOnKill: true, failToStart: false, exitCode: 0,
  };
  const requests: Request[] = [];
  const children: (EventEmitter & { pid?: number; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> })[] = [];
  const spawnImpl = vi.fn<ProcessedVoiceSpawn>((_command, args) => {
    const child = Object.assign(new EventEmitter(), { pid: state.failToStart ? undefined : 912, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    children.push(child);
    let killed = false;
    child.kill.mockImplementation(() => { killed = true; if (state.closeOnKill) queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; });
    if (state.failToStart) { queueMicrotask(() => child.emit("error", new Error("synthetic cannot spawn"))); return child; }
    if (state.hold) return child;
    setTimeout(() => { void (async () => {
      if (killed) return;
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8")) as Request;
      requests.push(request);
      if (state.exitCode) { child.stderr.write("ModuleNotFoundError: synthetic missing dependency"); child.emit("close", state.exitCode, null); return; }
      const spatialized = request.binaural && channels === 1;
      const frames = 960 + (spatialized ? Math.round(.65 * 48000) : 0);
      const output = writePcm16Wav(new Float32Array(frames * 2).fill(.01), 48000, 2);
      await writeFile(request.outputWav, output);
      const { start, end, movement, volumeDb, fadeInSeconds, fadeOutSeconds, binaural } = request;
      const report = { version: 1, rendererVersion: PROCESSED_VOICE_RENDERER_VERSION, sourceSha256: request.sourceSha256,
        outputSha256: digest(output), sampleRate: 48000, channels: 2, sourceFrames: 960, outputFrames: frames,
        sourceDurationSeconds: .02, outputDurationSeconds: frames / 48000, spatialized, tailSeconds: spatialized ? .65 : 0,
        settings: { start, end, movement, volumeDb, fadeInSeconds, fadeOutSeconds, binaural } };
      state.badReport?.(report);
      await writeFile(request.outputJson, JSON.stringify(report));
      await state.afterRender?.();
      child.emit("close", 0, null);
    })().catch(error => { child.stderr.write(String(error)); child.emit("close", 1, null); }); }, 1);
    return child;
  });
  return { root, config, input, source, sourcePath, codeRoot, scriptPath, requests, children, state, spawnImpl,
    dependencies: { scriptPath, spawnImpl, timeoutMs: 2000, exitWaitMs: 50 } };
}

describe("explicit processed voice renderer", () => {
  it("streams source identity without rendering and saves a separate persistent asset only on explicit render", async () => {
    const f = await fixture();
    expect(await inspectProcessedVoiceSource(f.input)).toEqual({ sourceSha256: digest(f.source), durationSeconds: .02 });
    expect(f.spawnImpl).not.toHaveBeenCalled();
    const result = await renderProcessedVoice(f.input, f.dependencies);
    expect(result.asset.assetId).not.toBe("voice");
    expect(result.asset.uri).toBe(`asset://clip/${result.asset.assetId}`);
    expect(result.asset.duration).toBe(.67);
    expect(result.sourceSha256).toBe(digest(f.source));
    expect(result.outputSha256).toBe(digest(await readFile(path.join(f.config.clipAssetRoot, result.asset.assetId + ".wav"))));
    expect(await readFile(f.sourcePath)).toEqual(Buffer.from(f.source));
    expect(result.settingsFingerprint).toBe(createAudioPostProcessingSettingsFingerprint(f.input));
    expect(f.requests[0]).toMatchObject({ start: f.input.start, end: f.input.end, hrtfPath: f.config.spatialHrtfPath });
  });

  it("reuses a SHA-validated persistent receipt without a new process or asset", async () => {
    const f = await fixture(), first = await renderProcessedVoice(f.input, f.dependencies);
    const second = await renderProcessedVoice(f.input, f.dependencies);
    expect(second).toEqual({ ...first, cacheHit: true });
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
    expect((await readdir(f.config.clipAssetRoot)).sort()).toEqual(["voice.wav", first.asset.assetId + ".wav"].sort());
  });

  it("canonicalizes static end before hashing and passing the request", async () => {
    const f = await fixture(), input = { ...f.input, movement: "static" as const };
    const first = await renderProcessedVoice(input, f.dependencies);
    expect(f.requests[0].end).toEqual(input.start);
    expect(first.settingsFingerprint).toBe(createAudioPostProcessingSettingsFingerprint({ ...input, end: input.start }));
    expect((await renderProcessedVoice({ ...input, end: { pan: -.8, distance: "far" } }, f.dependencies)).cacheHit).toBe(true);
  });

  it("accepts legacy 200-character IDs and canonicalizes anchor key ordering", async () => {
    const f = await fixture(), sourceAssetId = "s".repeat(200);
    await writeFile(path.join(f.config.clipAssetRoot, sourceAssetId + ".wav"), f.source);
    const result = await renderProcessedVoice({ ...f.input, clipId: "c".repeat(200), sourceAssetId,
      start: { distance: f.input.start.distance, pan: f.input.start.pan }, end: { distance: f.input.end.distance, pan: f.input.end.pan } }, f.dependencies);
    expect(result.asset.assetId.length).toBeLessThan(200);
    expect(JSON.parse(result.settingsFingerprint).clipId).toBe("c".repeat(200));
    expect(f.requests[0].start).toEqual(f.input.start);
  });

  it.each([false, true])("processes stereo gain/fades without HRTF or a new spatial tail (binaural=%s)", async binaural => {
    const f = await fixture(2); await rm(f.config.spatialHrtfPath!);
    const result = await renderProcessedVoice({ ...f.input, binaural }, f.dependencies);
    expect(result.asset.duration).toBe(.02);
    expect(f.requests[0]).not.toHaveProperty("hrtfPath");
    expect(f.requests[0]).toMatchObject({ volumeDb: -3, fadeInSeconds: .002, fadeOutSeconds: .003 });
  });

  it("uses a basic-processing request when binaural is off instead of silently skipping the job", async () => {
    const f = await fixture(); await rm(f.config.spatialHrtfPath!);
    const result = await renderProcessedVoice({ ...f.input, binaural: false }, f.dependencies);
    expect(result.asset.duration).toBe(.02);
    expect(f.requests[0]).toMatchObject({ binaural: false, movement: "approach" });
  });

  it("invalidates the cache on source bytes, settings, HRTF and clean code changes", async () => {
    const f = await fixture();
    await renderProcessedVoice(f.input, f.dependencies);
    await renderProcessedVoice({ ...f.input, volumeDb: -4 }, f.dependencies);
    await writeFile(f.sourcePath, writePcm16Wav(new Float32Array(960).fill(.03), 48000));
    await renderProcessedVoice(f.input, f.dependencies);
    await writeFile(f.config.spatialHrtfPath!, "new synthetic hrtf");
    await renderProcessedVoice(f.input, f.dependencies);
    await writeFile(path.join(f.codeRoot, "core.py"), "# code changed");
    await renderProcessedVoice(f.input, f.dependencies);
    expect(f.spawnImpl).toHaveBeenCalledTimes(5);
  });

  it("does not depend on the dirty spatial renderer or spatial-studio files", async () => {
    const f = await fixture();
    await renderProcessedVoice(f.input, f.dependencies);
    await writeFile(path.join(f.codeRoot, "render.py"), "# unrelated dirty editor");
    expect((await renderProcessedVoice(f.input, f.dependencies)).cacheHit).toBe(true);
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves externally changed prior processed files and publishes a new asset", async () => {
    const f = await fixture(), first = await renderProcessedVoice(f.input, f.dependencies);
    const old = path.join(f.config.clipAssetRoot, first.asset.assetId + ".wav");
    await writeFile(old, "preserve modified output");
    const second = await renderProcessedVoice(f.input, f.dependencies);
    expect(second.asset.assetId).not.toBe(first.asset.assetId);
    expect(await readFile(old, "utf8")).toBe("preserve modified output");
    expect(f.spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("does not return a malformed cached asset identity", async () => {
    const f = await fixture(), first = await renderProcessedVoice(f.input, f.dependencies);
    const directory = path.join(f.config.spatialCacheRoot!, "processed-voice");
    const receiptFile = path.join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))!);
    const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
    receipt.asset.assetId = [first.asset.assetId];
    await writeFile(receiptFile, JSON.stringify(receipt));
    const second = await renderProcessedVoice(f.input, f.dependencies);
    expect(second.asset.assetId).not.toBe(first.asset.assetId);
    expect(typeof second.asset.assetId).toBe("string");
    expect(f.spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("serializes duplicate requests and lets the second one reuse the completed receipt", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([renderProcessedVoice(f.input, f.dependencies), renderProcessedVoice(f.input, f.dependencies)]);
    expect(a.asset.assetId).toBe(b.asset.assetId);
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects traversal, invalid anchors and malformed source metadata before spawning", async () => {
    const f = await fixture();
    for (const change of [{ sourceAssetId: "../outside" }, { clipId: "../outside" }, { volumeDb: Number.NaN }, { start: { pan: 2, distance: "near" as const } }]) {
      await expect(renderProcessedVoice({ ...f.input, ...change }, f.dependencies)).rejects.toMatchObject({ statusCode: 422 });
    }
    const source = Buffer.from(f.source); source.writeUInt32LE(1, 4); await writeFile(f.sourcePath, source);
    await expect(renderProcessedVoice(f.input, f.dependencies)).rejects.toMatchObject({ statusCode: 422 });
    expect(f.spawnImpl).not.toHaveBeenCalled();
  });

  it("rejects mismatched output hashes and settings instead of persisting a false receipt", async () => {
    for (const mutation of [(report: Record<string, unknown>) => { report.outputSha256 = "0".repeat(64); },
      (report: Record<string, unknown>) => { report.settings = {}; }]) {
      const f = await fixture(); f.state.badReport = mutation;
      await expect(renderProcessedVoice(f.input, f.dependencies)).rejects.toMatchObject({ statusCode: 502 });
      expect(await readdir(f.config.clipAssetRoot)).toEqual(["voice.wav"]);
    }
  });

  it("does not publish if the source or core code changes during the process", async () => {
    for (const target of ["source", "code"]) {
      const f = await fixture();
      f.state.afterRender = () => writeFile(target === "source" ? f.sourcePath : path.join(f.codeRoot, "core.py"), target === "source" ? writePcm16Wav(new Float32Array(960).fill(.04), 48000) : "# changed");
      await expect(renderProcessedVoice(f.input, f.dependencies)).rejects.toMatchObject({ statusCode: 409 });
      expect(await readdir(f.config.clipAssetRoot)).toEqual(["voice.wav"]);
    }
  });

  it("an already aborted request cannot inspect or launch anything", async () => {
    const f = await fixture(), abort = new AbortController(); abort.abort();
    await expect(renderProcessedVoice({ ...f.input, signal: abort.signal }, f.dependencies)).rejects.toMatchObject({ statusCode: 499 });
    expect(f.spawnImpl).not.toHaveBeenCalled();
  });

  it("keeps the global slot and snapshots until cancelled child close is actually observed", async () => {
    const f = await fixture(), abort = new AbortController(); f.state.hold = true; f.state.closeOnKill = false;
    const first = renderProcessedVoice({ ...f.input, signal: abort.signal }, { ...f.dependencies, exitWaitMs: 10 });
    const failure = expect(first).rejects.toMatchObject({ statusCode: 503 });
    await vi.waitFor(() => expect(f.spawnImpl).toHaveBeenCalledTimes(1));
    const second = renderProcessedVoice({ ...f.input, volumeDb: -5 }, f.dependencies);
    abort.abort(); await failure;
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
    expect((await readdir(path.join(f.config.spatialCacheRoot!, "processed-voice"))).some(name => name.startsWith("render-"))).toBe(true);
    f.state.hold = false; f.children[0].emit("close", null, "SIGKILL");
    await second;
    expect(f.spawnImpl).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => expect((await readdir(path.join(f.config.spatialCacheRoot!, "processed-voice"))).filter(name => name.startsWith("render-"))).toEqual([]));
  });

  it("releases a failed-to-spawn job so a later explicit render can run", async () => {
    const f = await fixture(); f.state.failToStart = true;
    await expect(renderProcessedVoice(f.input, f.dependencies)).rejects.toMatchObject({ statusCode: 503 });
    f.state.failToStart = false;
    await expect(renderProcessedVoice(f.input, f.dependencies)).resolves.toHaveProperty("asset");
  });

  it("a bounded timeout kills the child and does not publish partial audio", async () => {
    const f = await fixture(); f.state.hold = true;
    await expect(renderProcessedVoice(f.input, { ...f.dependencies, timeoutMs: 5 })).rejects.toMatchObject({ statusCode: 504 });
    expect(f.children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(f.config.clipAssetRoot)).toEqual(["voice.wav"]);
  });
});
