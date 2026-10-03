import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareStoryboardBatchDownload } from "./local-storyboard-batch-download";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { getBatchStoryboardClips, getBatchStoryboardDownloadFolderName } from "./storyboard-batch-download";
import { StoredZipWriter } from "./stored-zip";
import { createClipH3Prompt, createClipVideoSourceFingerprint } from "./video-plan";

let root: string, tempRoot: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI/asmr-director-storyboard-export/2026-10-03/test-temp" : tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "storyboard-batch-"));
  tempRoot = path.join(root, "exports");
  // No asset directories or WAV files exist: exporting text must never require them.
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "missing-clips"), mixAssetRoot: path.join(root, "missing-mixes"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

function projectWithShots() {
  const project = structuredClone(demoProject);
  project.title = "雨夜/陪伴";
  project.videoPlan = { version: 1, sceneDescription: "温暖的室内。", shots: {} };
  const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
  clips.splice(3);
  for (const clip of clips) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${clip.id}`, uri: `asset://clip/adopted_${clip.id}`, duration: 4.321 };
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 4.321 },
      title: "陪伴", visual: "S1 sits beside a table.", action: "S1 rests a hand on the table.", camera: "Static medium shot.",
    };
  }
  delete project.videoPlan.shots[clips[1].id];
  return project;
}

function zipEntries(bytes: Buffer) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(bytes.length - 12, true);
  let offset = view.getUint32(bytes.length - 6, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 8, true) & 0x0800).toBe(0x0800);
    const size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const local = view.getUint32(offset + 42, true);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const content = bytes.subarray(data, data + size);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    expect(view.getUint32(offset + 16, true)).toBe((crc ^ 0xffffffff) >>> 0);
    entries.set(name, content);
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

describe("storyboard TXT ZIP preparation", () => {
  it("writes one UTF-8 TXT per ready paragraph under the project folder with exact H3 bytes and valid CRCs", async () => {
    const project = projectWithShots();
    const before = structuredClone(project);
    const archive = await prepareStoryboardBatchDownload(project, config, undefined, { tempRoot });
    const bytes = await readFile(archive.filePath), entries = zipEntries(bytes);
    expect(archive).toMatchObject({ filename: "雨夜 陪伴_分镜.zip", clipCount: 2, size: bytes.length });
    expect([...entries.keys()]).toEqual(getBatchStoryboardClips(project).map(entry => `${getBatchStoryboardDownloadFolderName(project)}/${entry.filename}`));
    for (const entry of getBatchStoryboardClips(project)) {
      const content = entries.get(`${getBatchStoryboardDownloadFolderName(project)}/${entry.filename}`)!;
      expect(content).toEqual(Buffer.from(createClipH3Prompt(project, entry.clip.id), "utf8"));
      expect(new TextDecoder().decode(content)).not.toContain("summary:");
    }
    expect(project).toEqual(before);
    await archive.cleanup();
    await archive.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("uses the shared configured download temp root", async () => {
    vi.stubEnv("ASMR_BATCH_DOWNLOAD_TEMP_ROOT", tempRoot);
    const archive = await prepareStoryboardBatchDownload(projectWithShots(), config);
    expect(path.dirname(path.dirname(archive.filePath))).toBe(path.resolve(tempRoot));
    await archive.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("returns readable 400 when no shots are ready without creating a temporary archive", async () => {
    await expect(prepareStoryboardBatchDownload(demoProject, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("可导出") });
    const project = projectWithShots();
    for (const shot of Object.values(project.videoPlan!.shots)) shot.camera = "";
    await expect(prepareStoryboardBatchDownload(project, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    expect(await readdir(root)).toEqual([]);
  });

  it("bounds file count and archive bytes, cleaning partial packages on ZIP write limits", async () => {
    const project = projectWithShots();
    const clip = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    const baseShot = project.videoPlan!.shots[clip.id];
    const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips = [];
    project.videoPlan!.shots = {};
    for (let index = 0; index < 2001; index++) {
      const copy = structuredClone(clip); copy.id = `voice_${index}`; copy.start = index;
      track.clips.push(copy);
      project.videoPlan!.shots[copy.id] = { ...baseShot, clipId: copy.id, sourceFingerprint: createClipVideoSourceFingerprint(project, copy.id) };
    }
    await expect(prepareStoryboardBatchDownload(project, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 413 });
    await expect(prepareStoryboardBatchDownload(projectWithShots(), config, undefined, { tempRoot, maxArchiveBytes: 1500 })).rejects.toMatchObject({ statusCode: 413, message: expect.stringContaining("分镜包") });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("honors cancellation before and during preparation and cleans after unexpected write failures", async () => {
    const cancelled = new AbortController(); cancelled.abort();
    await expect(prepareStoryboardBatchDownload(projectWithShots(), config, cancelled.signal, { tempRoot })).rejects.toMatchObject({ statusCode: 499 });
    const original = StoredZipWriter.prototype.add;
    const active = new AbortController();
    const add = vi.spyOn(StoredZipWriter.prototype, "add").mockImplementation(async function(this: StoredZipWriter, name, data) {
      await original.call(this, name, data);
      active.abort();
    });
    await expect(prepareStoryboardBatchDownload(projectWithShots(), config, active.signal, { tempRoot })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(tempRoot)).toEqual([]);
    add.mockRejectedValueOnce(new Error("private server path"));
    await expect(prepareStoryboardBatchDownload(projectWithShots(), config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 500, message: "批量分镜整理失败，请检查缓存空间后重试。" });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
