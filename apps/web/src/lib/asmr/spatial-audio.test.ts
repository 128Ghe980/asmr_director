import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { renderSpatialClip, type SpatialSpawn } from "./spatial-audio";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const position = { pan: -.5, distance: "near", movement: "static" } as const;

async function fixture(channels: 1 | 2 = 1, delayMs = 0) {
  const root = await mkdtemp(path.join(os.tmpdir(), "asmr-spatial-test-"));
  roots.push(root);
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_SPATIAL_PYTHON: path.join(root, "python.exe"), ASMR_SPATIAL_HRTF: path.join(root, "hrtf.sofa") });
  await mkdir(config.clipAssetRoot, { recursive: true });
  const scriptPath = path.join(root, "render.py");
  await Promise.all([writeFile(scriptPath, "# renderer 1"), writeFile(config.spatialPythonPath!, "python"), writeFile(config.spatialHrtfPath!, "hrtf")]);
  const source = writePcm16Wav(new Float32Array(960 * channels).fill(.1), 48000, channels);
  await writeFile(path.join(config.clipAssetRoot, "voice.wav"), source);
  const requests: Record<string, unknown>[] = [];
  const spawnImpl = vi.fn<SpatialSpawn>((_command, args) => {
    const child = Object.assign(new EventEmitter(), { pid: 123, stdout: null, stderr: null, kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; }) });
    setTimeout(async () => {
      const request = JSON.parse(await readFile(args[args.length - 1], "utf8"));
      requests.push(request);
      const sourceDurationSeconds = Math.min(.02, Number(request.durationSeconds ?? .02));
      const outputDurationSeconds = sourceDurationSeconds + .65;
      await writeFile(request.outputWav, writePcm16Wav(new Float32Array(Math.round(outputDurationSeconds * 48000) * 2).fill(.1), 48000, 2));
      await writeFile(request.outputJson, JSON.stringify({ version: 1, spatialized: true, sampleRate: 48000, channels: 2, sourceDurationSeconds, outputDurationSeconds, tailSeconds: .65 }));
      child.emit("close", 0, null);
    }, delayMs);
    return child;
  });
  return { root, config, scriptPath, source, requests, spawnImpl, input: { assetId: "voice", position, config } };
}

describe("spatial audio adapter", () => {
  it("preserves stereo verbatim without requiring Python or HRTF", async () => {
    const f = await fixture(2);
    await rm(f.config.spatialPythonPath!);
    const result = await renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl });
    expect(result.spatialized).toBe(false);
    expect(result.wav).toEqual(f.source);
    expect(f.spawnImpl).not.toHaveBeenCalled();
  });

  it("renders mono once, retains its tail, and reuses the successful cache", async () => {
    const f = await fixture();
    const options = { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl };
    const first = await renderSpatialClip({ ...f.input, durationSeconds: .015, fadeInSeconds: .003, fadeOutSeconds: .004 }, options);
    const second = await renderSpatialClip({ ...f.input, durationSeconds: .015, fadeInSeconds: .003, fadeOutSeconds: .004 }, options);
    expect(first.spatialized).toBe(true);
    expect(second.wav).toEqual(first.wav);
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
    expect(f.requests[0]).toMatchObject({ version: 1, position, durationSeconds: .015, fadeInSeconds: .003, fadeOutSeconds: .004, preprocess: "listening" });
    expect((await readdir(f.config.spatialCacheRoot!)).filter(name => name.endsWith(".wav"))).toHaveLength(1);
    expect(await readFile(path.join(f.config.clipAssetRoot, "voice.wav"))).toEqual(Buffer.from(f.source));
  });

  it("keeps Python dependency scratch files with the render cache without changing the parent environment", async () => {
    const f = await fixture();
    const original = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    await renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl });
    const options = f.spawnImpl.mock.calls[0][2];
    const requestDirectory = path.dirname(String(f.requests[0].outputWav));
    expect(requestDirectory.startsWith(path.resolve(f.config.spatialCacheRoot!) + path.sep)).toBe(true);
    expect({ TEMP: options.env.TEMP, TMP: options.env.TMP, TMPDIR: options.env.TMPDIR }).toEqual({ TEMP: requestDirectory, TMP: requestDirectory, TMPDIR: requestDirectory });
    expect(options.env.NODE_ENV).toBe(process.env.NODE_ENV);
    expect({ TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }).toEqual(original);
  });

  it("invalidates on position, source bytes, HRTF content and renderer code", async () => {
    const f = await fixture();
    const options = { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl };
    await renderSpatialClip(f.input, options);
    await renderSpatialClip({ ...f.input, position: { ...position, pan: .5 } }, options);
    await writeFile(path.join(f.config.clipAssetRoot, "voice.wav"), writePcm16Wav(new Float32Array(960).fill(.2), 48000));
    await renderSpatialClip(f.input, options);
    await writeFile(f.config.spatialHrtfPath!, "different hrtf");
    await renderSpatialClip(f.input, options);
    await writeFile(f.scriptPath, "# renderer 2");
    await renderSpatialClip(f.input, options);
    expect(f.spawnImpl).toHaveBeenCalledTimes(5);
  });

  it("serializes concurrent requests and rechecks their shared cache", async () => {
    const f = await fixture(1, 25);
    const options = { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl };
    const results = await Promise.all([renderSpatialClip(f.input, options), renderSpatialClip(f.input, options)]);
    expect(results[0].wav).toEqual(results[1].wav);
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued request without killing another request's process", async () => {
    const f = await fixture(1, 100);
    const options = { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl };
    const first = renderSpatialClip(f.input, options);
    await vi.waitFor(() => expect(f.spawnImpl).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const second = renderSpatialClip({ ...f.input, signal: controller.signal, position: { ...position, pan: .5 } }, options);
    const rejected = expect(second).rejects.toMatchObject({ statusCode: 499 });
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await rejected;
    await first;
    expect(f.spawnImpl).toHaveBeenCalledTimes(1);
    expect(f.spawnImpl.mock.results[0].value.kill).not.toHaveBeenCalled();
  });

  it("does not cache an incomplete renderer output and allows retry", async () => {
    const f = await fixture();
    const spawnImpl = vi.fn<SpatialSpawn>((_command, args) => {
      const child = Object.assign(new EventEmitter(), { pid: 7, stdout: null, stderr: null, kill: vi.fn() });
      setTimeout(async () => {
        const request = JSON.parse(await readFile(args[args.length - 1], "utf8"));
        await writeFile(request.outputWav, f.source);
        await writeFile(request.outputJson, JSON.stringify({ version: 1 }));
        child.emit("close", 0, null);
      }, 0);
      return child;
    });
    await expect(renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl })).rejects.toMatchObject({ statusCode: 502 });
    expect((await readdir(f.config.spatialCacheRoot!)).filter(name => name.endsWith(".wav"))).toHaveLength(0);
    await expect(renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl })).resolves.toMatchObject({ spatialized: true });
  });

  it("rejects invalid paths, positions, excessive durations and missing runtime", async () => {
    const f = await fixture();
    const options = { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl };
    await expect(renderSpatialClip({ ...f.input, assetId: "../secret" }, options)).rejects.toMatchObject({ statusCode: 400 });
    await expect(renderSpatialClip({ ...f.input, position: { ...position, pan: NaN } }, options)).rejects.toMatchObject({ statusCode: 400 });
    await expect(renderSpatialClip({ ...f.input, durationSeconds: 601 }, options)).rejects.toMatchObject({ statusCode: 400 });
    await rm(f.config.spatialPythonPath!);
    await expect(renderSpatialClip(f.input, options)).rejects.toMatchObject({ statusCode: 503 });
    expect(f.spawnImpl).not.toHaveBeenCalled();
  });

  it("kills a cancelled render and never publishes partial output", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let child: ReturnType<SpatialSpawn>;
    const spawnImpl = vi.fn<SpatialSpawn>(() => {
      const emitter = new EventEmitter();
      child = Object.assign(emitter, { pid: 99, stdout: null, stderr: null, kill: vi.fn(() => { queueMicrotask(() => emitter.emit("close", null, "SIGKILL")); return true; }) });
      queueMicrotask(() => controller.abort());
      return child;
    });
    await expect(renderSpatialClip({ ...f.input, signal: controller.signal }, { scriptPath: f.scriptPath, spawnImpl })).rejects.toMatchObject({ statusCode: 499 });
    expect(child!.kill).toHaveBeenCalledWith("SIGKILL");
    expect((await readdir(f.config.spatialCacheRoot!)).filter(name => name.endsWith(".wav"))).toHaveLength(0);
  });

  it("terminates an overdue process and releases the slot for a retry", async () => {
    const f = await fixture();
    let child: ReturnType<SpatialSpawn>;
    const spawnImpl: SpatialSpawn = () => {
      const emitter = new EventEmitter();
      child = Object.assign(emitter, { pid: 8, stdout: null, stderr: null, kill: vi.fn(() => { queueMicrotask(() => emitter.emit("close", null, "SIGKILL")); return true; }) });
      return child;
    };
    await expect(renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl, timeoutMs: 10 })).rejects.toMatchObject({ statusCode: 504 });
    expect(child!.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl: f.spawnImpl })).resolves.toMatchObject({ spatialized: true });
  });

  it("reports missing Python modules clearly without publishing a cache entry", async () => {
    const f = await fixture();
    const spawnImpl: SpatialSpawn = () => {
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), { pid: 9, stdout: null, stderr, kill: vi.fn() });
      queueMicrotask(() => { stderr.write("ModuleNotFoundError: No module named 'h5py'"); child.emit("close", 1, null); });
      return child;
    };
    await expect(renderSpatialClip(f.input, { scriptPath: f.scriptPath, spawnImpl })).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("Python 依赖") });
    expect((await readdir(f.config.spatialCacheRoot!)).filter(name => name.endsWith(".wav"))).toHaveLength(0);
  });
});
