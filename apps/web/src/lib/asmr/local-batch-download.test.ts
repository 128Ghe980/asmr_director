import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchDownloadError, prepareBatchDownload } from "./local-batch-download";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { SpatialAudioError, type RenderSpatialClipInput } from "./spatial-audio";

let root: string, tempRoot: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI" : tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-batch-test-"));
  tempRoot = path.join(root, "exports");
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function projectWithVoice(binaural = false) {
  const project = structuredClone(demoProject);
  const voice = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
  for (const track of project.timeline.tracks) track.clips = [];
  voice.generation.status = "asset_generated";
  voice.asset = { asset_id: "adopted", uri: "asset://clip/adopted", duration: .1 };
  voice.start = 0;
  voice.duration = .025; // Timeline edit must not truncate adopted downloads.
  voice.fade_in = 0;
  voice.fade_out = 0;
  voice.volume_db = -6;
  voice.position = { pan: 1, distance: "close", movement: "static" };
  project.timeline.tracks.find(track => track.track_type === "voice")!.clips.push(voice);
  project.timeline.mixing.binaural = binaural;
  return project;
}

function zipEntries(bytes: Buffer) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(bytes.length - 12, true);
  let offset = view.getUint32(bytes.length - 6, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const local = view.getUint32(offset + 42, true);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, bytes.subarray(data, data + size));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

describe("complete adopted batch archive", () => {
  it("pairs complete byte-identical originals with full-length processed clips and a truthful manifest", async () => {
    const raw = writePcm16Wav(new Float32Array(4800).fill(.2), 48000);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), raw);
    const archive = await prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot });
    const bytes = await readFile(archive.filePath), entries = zipEntries(bytes);
    expect(archive.clipCount).toBe(1);
    expect(archive.size).toBe(bytes.length);
    const rawEntry = [...entries].find(([name]) => name.includes("/无后处理/"))!;
    const processedEntry = [...entries].find(([name]) => name.includes("/后处理/"))!;
    expect(rawEntry[0].split("/").at(-1)).toBe(processedEntry[0].split("/").at(-1));
    expect(rawEntry[1]).toEqual(Buffer.from(raw));
    const processed = decodePcmWav(processedEntry[1]);
    expect(processed.samples.length / 2 / processed.sampleRate).toBe(.1);
    expect(processed.samples[0]).toBeCloseTo(0, 5);
    expect(processed.samples[1]).toBeCloseTo(.2 * Math.pow(10, -6 / 20), 4);
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ assetId: "adopted", processing: "basic_processing", spatialized: false, durationSeconds: .1 });
    await archive.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
    expect(await readFile(path.join(config.clipAssetRoot, "adopted.wav"))).toEqual(Buffer.from(raw));
  });

  it("exports original D over the full source and retains its 650 ms tail without applying fades twice", async () => {
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), writePcm16Wav(new Float32Array(4800).fill(.2), 48000));
    const spatial = writePcm16Wav(new Float32Array(36000 * 2).fill(.2), 48000, 2);
    const renderSpatial = vi.fn(async (input: RenderSpatialClipInput) => { void input; return { wav: spatial, spatialized: true }; });
    const project = projectWithVoice(true);
    const voice = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    voice.fade_in = .05; voice.fade_out = .05;
    const archive = await prepareBatchDownload(project, config, undefined, { tempRoot, renderSpatial });
    expect(renderSpatial).toHaveBeenCalledWith(expect.objectContaining({ assetId: "adopted", fadeInSeconds: .05, fadeOutSeconds: .05 }));
    expect(renderSpatial.mock.calls[0][0]).not.toHaveProperty("durationSeconds");
    const entries = zipEntries(await readFile(archive.filePath));
    const processed = decodePcmWav([...entries].find(([name]) => name.includes("/后处理/"))![1]);
    expect(processed.samples.length / 2 / processed.sampleRate).toBe(.75);
    expect(processed.samples[0]).toBeCloseTo(.2 * Math.pow(10, -6 / 20), 4);
    expect(processed.samples.at(-1)).toBeCloseTo(.2 * Math.pow(10, -6 / 20), 4);
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ processing: "original_d_binaural", spatialized: true, durationSeconds: .75 });
    await archive.cleanup();
  });

  it("allows existing stereo sources but never labels a mono fallback as successful spatial processing", async () => {
    const raw = writePcm16Wav(new Float32Array(9600).fill(.1), 48000, 2);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), raw);
    const archive = await prepareBatchDownload(projectWithVoice(true), config, undefined, { tempRoot, renderSpatial: vi.fn(async () => ({ wav: raw, spatialized: false })) });
    const entries = zipEntries(await readFile(archive.filePath));
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ processing: "stereo_source", spatialized: false });
    await archive.cleanup();
    const mono = writePcm16Wav(new Float32Array(4800).fill(.1), 48000);
    await expect(prepareBatchDownload(projectWithVoice(true), config, undefined, { tempRoot, renderSpatial: vi.fn(async () => ({ wav: mono, spatialized: false })) })).rejects.toMatchObject({ statusCode: 503 });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("rejects missing, unsafe and inconsistent references, oversized packets and malformed WAVs", async () => {
    await expect(prepareBatchDownload(demoProject, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    const project = projectWithVoice();
    await expect(prepareBatchDownload(project, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 404 });
    const voice = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    voice.asset = { asset_id: "../secret", uri: "asset://clip/../secret", duration: 1 };
    await expect(prepareBatchDownload(project, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    voice.asset = { asset_id: "a", uri: "asset://clip/b", duration: 1 };
    await expect(prepareBatchDownload(project, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), writePcm16Wav(new Float32Array(4800), 48000));
    await expect(prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot, maxArchiveBytes: 100 })).rejects.toMatchObject({ statusCode: 413 });
    // Raw fits the limit, but both paired files do not: partial archive is cleaned up.
    await expect(prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot, maxArchiveBytes: 12000 })).rejects.toMatchObject({ statusCode: 413 });
    expect(await readdir(tempRoot)).toEqual([]);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), new Uint8Array(44));
    await expect(prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 422 });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("propagates cancellation and spatial failures while removing the incomplete ZIP", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareBatchDownload(projectWithVoice(), config, controller.signal, { tempRoot })).rejects.toBeInstanceOf(BatchDownloadError);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), writePcm16Wav(new Float32Array(4800), 48000));
    await expect(prepareBatchDownload(projectWithVoice(true), config, undefined, { tempRoot, renderSpatial: vi.fn(async () => { throw new SpatialAudioError("空间处理不可用。", 503); }) })).rejects.toMatchObject({ statusCode: 503, message: "空间处理不可用。" });
    expect(await readdir(tempRoot)).toEqual([]);
    const active = new AbortController();
    await expect(prepareBatchDownload(projectWithVoice(true), config, active.signal, { tempRoot, renderSpatial: vi.fn(async () => { active.abort(); throw new Error("cancel"); }) })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
