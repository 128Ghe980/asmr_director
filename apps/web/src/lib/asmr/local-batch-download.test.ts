import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchDownloadError, prepareBatchDownload } from "./local-batch-download";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { makePreparedAudioFixture } from "./post-processing-test-fixtures";
import { StoredZipWriter } from "./stored-zip";

let root: string, tempRoot: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  const base = tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-batch-test-"));
  tempRoot = path.join(root, "exports");
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

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
  it("exports byte-identical complete originals without implicitly generating post-processing", async () => {
    const raw = writePcm16Wav(new Float32Array(4800).fill(.2), 48000);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), raw);
    const archive = await prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot });
    const bytes = await readFile(archive.filePath), entries = zipEntries(bytes);
    expect(archive.clipCount).toBe(1);
    expect(archive.size).toBe(bytes.length);
    const rawEntry = [...entries].find(([name]) => name.includes("/无后处理/"))!;
    expect([...entries].some(([name]) => name.includes("/后处理/"))).toBe(false);
    expect(rawEntry[1]).toEqual(Buffer.from(raw));
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ assetId: "adopted", processing: "not_generated", spatialized: false, durationSeconds: .1 });
    expect(manifest.clips[0]).not.toHaveProperty("processedPath");
    await archive.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
    expect(await readFile(path.join(config.clipAssetRoot, "adopted.wav"))).toEqual(Buffer.from(raw));
  });

  it("copies the prepared D result including its tail without applying gain or fades twice", async () => {
    const { project, processed: prepared } = await makePreparedAudioFixture(config, 1);
    const archive = await prepareBatchDownload(project, config, undefined, { tempRoot });
    const entries = zipEntries(await readFile(archive.filePath));
    const processed = decodePcmWav([...entries].find(([name]) => name.includes("/后处理/"))![1]);
    expect(processed.samples.length / 2 / processed.sampleRate).toBe(.75);
    expect([...entries].find(([name]) => name.includes("/后处理/"))![1]).toEqual(prepared);
    expect(processed.samples[0]).toBeCloseTo(.04, 4);
    expect(processed.samples.at(-1)).toBeCloseTo(.02, 4);
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ processing: "prepared_audio", spatialized: true, durationSeconds: .75 });
    await archive.cleanup();
  });

  it("exports mono and stereo originals even when no explicit processing result exists", async () => {
    const raw = writePcm16Wav(new Float32Array(9600).fill(.1), 48000, 2);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), raw);
    const archive = await prepareBatchDownload(projectWithVoice(true), config, undefined, { tempRoot });
    const entries = zipEntries(await readFile(archive.filePath));
    const manifest = JSON.parse(new TextDecoder().decode([...entries].find(([name]) => name.endsWith("导出清单.json"))![1]));
    expect(manifest.clips[0]).toMatchObject({ processing: "not_generated", spatialized: false });
    await archive.cleanup();
    const mono = writePcm16Wav(new Float32Array(4800).fill(.1), 48000);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), mono);
    const monoArchive = await prepareBatchDownload(projectWithVoice(true), config, undefined, { tempRoot });
    await monoArchive.cleanup();
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
    // The source fits, but ZIP metadata does not: the partial archive is cleaned.
    await expect(prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot, maxArchiveBytes: 10000 })).rejects.toMatchObject({ statusCode: 413 });
    expect(await readdir(tempRoot)).toEqual([]);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), new Uint8Array(44));
    await expect(prepareBatchDownload(projectWithVoice(), config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 422 });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("propagates cancellation and removes an incomplete ZIP without processing audio", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareBatchDownload(projectWithVoice(), config, controller.signal, { tempRoot })).rejects.toBeInstanceOf(BatchDownloadError);
    await writeFile(path.join(config.clipAssetRoot, "adopted.wav"), writePcm16Wav(new Float32Array(4800), 48000));
    const active = new AbortController();
    vi.spyOn(StoredZipWriter.prototype, "add").mockImplementationOnce(async () => { active.abort(); throw new Error("cancel"); });
    await expect(prepareBatchDownload(projectWithVoice(true), config, active.signal, { tempRoot })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
