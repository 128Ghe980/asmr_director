import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVideoPackage, getVideoPackageReferenceExtension, type VideoPackageManifest } from "./local-video-package";
import { demoProject } from "./mock-project";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { StoredZipWriter } from "./stored-zip";
import { createClipVideoSourceFingerprint } from "./video-plan";

const base = process.platform === "win32" ? "I:/AI/asmr_director/qa/video-package-tests" : tmpdir();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V0AAAAASUVORK5CYII=", "base64");
let root: string, tempRoot: string, runnerRoot: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "package-"));
  tempRoot = path.join(root, "exports"); runnerRoot = path.join(root, "runner");
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mixes"), gptSovitsBaseUrl: "unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
  await mkdir(runnerRoot);
  for (const name of ["runner.py", "workflow_api.json", "README.zh.md", "run.bat"]) await writeFile(path.join(runnerRoot, name), name === "workflow_api.json" ? "{}" : `test ${name}`);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (path.dirname(root) !== path.resolve(base)) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const project = structuredClone(demoProject);
  const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
  clips.splice(2);
  project.videoPlan = { version: 1, sceneDescription: "安静的窗边", shots: {}, referenceModes: {} };
  const wav = writePcm16Wav(new Float32Array(1600).fill(.125), 16000);
  for (const clip of clips) {
    clip.duration = .02; clip.pause_after = 10;
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `take_${clip.id}`, uri: `asset://clip/take_${clip.id}`, duration: 4.321 };
    await writeFile(path.join(config.clipAssetRoot, `${clip.asset.asset_id}.wav`), wav);
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 4.321 },
      title: "陪伴", visual: "S1 sits at a table.", action: "S1 rests one hand.", camera: "Static medium shot.",
    };
  }
  return { project, clips, wav };
}

function entries(bytes: Buffer) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = view.getUint32(bytes.length - 6, true);
  const result = new Map<string, Buffer>();
  for (let i = 0; i < view.getUint16(bytes.length - 12, true); i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const length = view.getUint16(offset + 28, true), local = view.getUint32(offset + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    result.set(bytes.subarray(offset + 46, offset + 46 + length).toString("utf8"), bytes.subarray(start, start + view.getUint32(offset + 24, true)));
    offset += 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return result;
}

describe("portable video packages", () => {
  it("exports both kinds of ASMR prompt at measured shot lengths and bundles the existing D processor", async () => {
    const { project, clips, wav } = await fixture();
    const sound = { prompt: "A cotton cloth gently glides over a wooden surface, then settles.", postProcessing: {
      start: { pan: -.5, distance: "near" as const }, end: { pan: .5, distance: "near" as const }, movement: "left_to_right" as const, gainDb: -12,
    } };
    project.videoPlan!.storyboardStyle = "listener_pov";
    for (const clip of clips) project.videoPlan!.shots[clip.id].asmrSound = structuredClone(sound);
    clips[1].kind = "silent"; clips[1].duration = 3;
    clips[1].asset = { asset_id: null, uri: null, duration: null }; clips[1].generation.status = "asset_pending";
    delete project.videoPlan!.shots[clips[1].id].audio;
    Object.assign(project.videoPlan!.shots[clips[1].id], { kind: "silent", duration: 3, ambientSound: "Quiet room tone." });
    for (const clip of clips) project.videoPlan!.shots[clip.id].sourceFingerprint = createClipVideoSourceFingerprint(project, clip.id);
    config.spatialHrtfPath = path.join(root, "test.sofa");
    const sofa = Buffer.from([137, 72, 68, 70, 13, 10, 26, 10]);
    await writeFile(config.spatialHrtfPath, sofa);
    const archive = await prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot: path.resolve(process.cwd(), "../../tools/comfy-batch") });
    const files = entries(await readFile(archive.filePath));
    const manifest = JSON.parse(files.get("project.json")!.toString()) as VideoPackageManifest;
    expect(manifest.shots.map(shot => shot.asmrSound?.durationSeconds)).toEqual([.1, 3]);
    for (const shot of manifest.shots) {
      expect(shot.asmrSound?.postProcessing).toEqual(sound.postProcessing);
      expect(shot.asmrSound?.prompt).toContain(sound.prompt);
      expect(shot.asmrSound?.prompt).toContain("No speech, whispering, vocal sounds");
      expect(shot.asmrSound?.prompt).not.toMatch(/fully_copy|Picture 1|Audio 1/);
      expect(files.get(`shots/${String(shot.order).padStart(3, "0")}/asmr-prompt.txt`)?.toString()).toBe(shot.asmrSound?.prompt);
    }
    expect(manifest.shots[0].prompt).toContain("listener");
    expect(files.get("shots/001/audio.wav")).toEqual(Buffer.from(wav));
    expect(files.get("custom_nodes/asmr_director_audio/engine/processed_voice.py")).toEqual(await readFile(path.resolve("scripts/render-processed-voice.py")));
    expect(files.get("custom_nodes/asmr_director_audio/data/subj_A.sofa")).toEqual(sofa);
    expect(files.has("custom_nodes/asmr_director_audio/engine/spatial_d/render.py")).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(root);
    await archive.cleanup();
  });

  it("fails before writing a new ASMR package if its spatial runtime cannot be bundled", async () => {
    const { project, clips } = await fixture();
    project.videoPlan!.shots[clips[0].id].asmrSound = { prompt: "Gentle cotton movement.", postProcessing: {
      start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -12,
    } };
    config.spatialHrtfPath = path.join(root, "missing.sofa");
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot: path.resolve(process.cwd(), "../../tools/comfy-batch") }))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("HRTF") });
    expect(await readdir(root)).not.toContain("exports");
  });

  it("packs a complete runnable snapshot, exact adopted WAV bytes and actual PCM durations without timeline timing", async () => {
    const { project, clips, wav } = await fixture();
    const second = project.videoPlan!.shots[clips[1].id];
    second.previousClipId = "deleted"; second.previousPromptFingerprint = "stale chain";
    project.videoPlan!.referenceModes = { [clips[0].id]: "continuous", [clips[1].id]: "continuous" };
    clips.reverse();
    const before = structuredClone(project);
    const archive = await prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot, reference: png });
    const files = entries(await readFile(archive.filePath));
    const manifest = JSON.parse(files.get("project.json")!.toString("utf8")) as VideoPackageManifest;
    expect(manifest).toMatchObject({ format: "asmr-video-package", version: 1, projectId: project.project_id,
      title: project.title, characterReference: "references/character.png", workflow: "workflow_api.json", workspaceMode: "short" });
    expect(manifest.shots.map(shot => [shot.id, shot.order, shot.kind, shot.referenceMode, shot.durationSeconds, shot.audio]))
      .toEqual([["voice_001", 1, "speech", "new", .1, "shots/001/audio.wav"], ["voice_002", 2, "speech", "continuous", .1, "shots/002/audio.wav"]]);
    expect(manifest.shots[0].prompt).toContain(", 0.1 seconds.");
    expect(manifest.shots[0].prompt).toContain(clips[1].text);
    expect(JSON.stringify(manifest)).not.toMatch(/start|pause_after|previousPromptFingerprint|asset:\/\//);
    expect(files.get("shots/001/audio.wav")).toEqual(Buffer.from(wav));
    expect(files.get("shots/002/audio.wav")).toEqual(Buffer.from(wav));
    expect(files.get("references/character.png")).toEqual(png);
    for (const name of ["runner.py", "workflow_api.json", "README.zh.md", "run.bat"]) expect(files.has(name)).toBe(true);
    expect([...files.keys()].filter(name => name.endsWith(".wav"))).toHaveLength(2);
    expect(project).toEqual(before);
    await archive.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("includes an ambient shot with independent duration and no audio file", async () => {
    const { project, clips } = await fixture();
    const clip = clips[1]; clip.kind = "silent"; clip.duration = 3;
    clip.asset = { asset_id: null, uri: null, duration: null }; clip.generation.status = "asset_pending";
    const shot = project.videoPlan!.shots[clip.id]; delete shot.audio;
    Object.assign(shot, { kind: "silent", duration: 3, ambientSound: "Soft rain against glass.", sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id) });
    const archive = await prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot });
    const files = entries(await readFile(archive.filePath));
    const manifest = JSON.parse(files.get("project.json")!.toString()) as VideoPackageManifest;
    expect(manifest.characterReference).toBeUndefined();
    expect(manifest.shots[1]).toMatchObject({ kind: "ambient", durationSeconds: 3 });
    expect(manifest.shots[1]).not.toHaveProperty("audio");
    expect(manifest.shots[1].prompt).toContain("Soft rain against glass.");
    expect(files.has("shots/002/audio.wav")).toBe(false);
    await archive.cleanup();
  });

  it("expands authored long performance parts and keeps the following speech WAV aligned", async () => {
    const { project, clips, wav } = await fixture();
    const clip = clips[0]; clip.kind = "silent"; clip.duration = 12;
    clip.performance = { version: 1, segmentId: "wooden_box", purpose: "asmr", direction: "敲击同一只盒子，然后停住。", soundIntent: "缓慢木质敲击" };
    clip.asset = { asset_id: null, uri: null, duration: null }; clip.generation.status = "asset_pending";
    const shot = project.videoPlan!.shots[clip.id]; delete shot.audio;
    const sound = { prompt: "Quiet dry wooden taps, then a pause.", mixMode: "replace" as const, postProcessing: {
      start: { pan: 0, distance: "near" as const }, end: { pan: 0, distance: "near" as const }, movement: "static" as const, gainDb: -6,
    } };
    Object.assign(shot, { kind: "silent", duration: 12, ambientSound: "Quiet wooden tapping.", asmrSound: sound,
      parts: [5, 5, 2].map((durationSeconds, index) => ({ durationSeconds,
        visual: "S1 holds the same closed wooden box.", action: `Gentle tapping stage ${index + 1}.`, camera: "Fixed listener viewpoint.",
        ambientSound: `Quiet wooden tapping stage ${index + 1}.`, asmrSound: { ...sound, prompt: `Quiet wooden taps at stage ${index + 1}.` } })),
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id) });
    config.spatialHrtfPath = path.join(root, "test.sofa");
    await writeFile(config.spatialHrtfPath, Buffer.from([137, 72, 68, 70, 13, 10, 26, 10]));
    const before = structuredClone(project);
    const archive = await prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot: path.resolve(process.cwd(), "../../tools/comfy-batch") });
    const files = entries(await readFile(archive.filePath));
    const manifest = JSON.parse(files.get("project.json")!.toString()) as VideoPackageManifest;
    expect(manifest.shots.map(entry => [entry.id, entry.order, entry.durationSeconds, entry.referenceMode])).toEqual([
      ["voice_001--part-001", 1, 5, "new"], ["voice_001--part-002", 2, 5, "continuous"], ["voice_001--part-003", 3, 2, "continuous"],
      ["voice_002", 4, .1, "new"],
    ]);
    expect(archive.clipCount).toBe(4);
    for (const [index, part] of manifest.shots.slice(0, 3).entries()) {
      expect(part).toMatchObject({ segmentId: clip.id, partIndex: index + 1, partCount: 3, asmrSound: { mixMode: "replace", durationSeconds: [5, 5, 2][index] } });
      expect(part.prompt).toContain(`Gentle tapping stage ${index + 1}.`);
      expect(part.prompt).toContain(`Quiet wooden tapping stage ${index + 1}.`);
      expect(part.asmrSound?.prompt).toContain(`Quiet wooden taps at stage ${index + 1}.`);
      expect(part).not.toHaveProperty("audio");
    }
    expect(manifest.shots[3].audio).toBe("shots/004/audio.wav");
    expect(files.get("shots/004/audio.wav")).toEqual(Buffer.from(wav));
    expect([...files.keys()].filter(file => file.endsWith(".wav"))).toEqual(["shots/004/audio.wav"]);
    expect(project).toEqual(before);
    await archive.cleanup();
  });

  it("preflights every required input before creating an archive and identifies the bad shot", async () => {
    const { project, clips } = await fixture();
    await rm(path.join(config.clipAssetRoot, `${clips[1].asset.asset_id}.wav`));
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("第 2 段") });
    expect(await readdir(root)).not.toContain("exports");
    delete project.videoPlan!.shots[clips[0].id];
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("第 1 段") });
  });

  it("rejects malformed, non-PCM and incomplete-frame WAVs without decoding or truncating them", async () => {
    const { project, clips, wav } = await fixture();
    for (const change of ["header", "format", "frames", "rate"]) {
      const invalid = Buffer.from(wav);
      if (change === "header") invalid.write("FAIL", 0);
      if (change === "format") invalid.writeUInt16LE(3, 20);
      if (change === "frames") invalid.writeUInt32LE(3199, 40);
      if (change === "rate") invalid.writeUInt32LE(0, 24);
      await writeFile(path.join(config.clipAssetRoot, `${clips[0].asset.asset_id}.wav`), invalid);
      await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining("第 1 段") });
    }
  });

  it("requires all bundled runner files and respects the explicit runner root setting", async () => {
    const { project } = await fixture();
    vi.stubEnv("ASMR_VIDEO_RUNNER_ROOT", runnerRoot);
    const archive = await prepareVideoPackage(project, config, undefined, { tempRoot });
    await archive.cleanup();
    await rm(path.join(runnerRoot, "runner.py"));
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("批跑器") });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("bounds reference bytes and accepts formats from their real magic rather than a filename", () => {
    expect(getVideoPackageReferenceExtension(png)).toBe("png");
    expect(getVideoPackageReferenceExtension(Uint8Array.from([255, 216, 255, 224, 255, 217]))).toBe("jpg");
    const webp = Buffer.alloc(22); webp.write("RIFF"); webp.writeUInt32LE(14, 4); webp.write("WEBPVP8 ", 8); webp.writeUInt32LE(2, 16);
    expect(getVideoPackageReferenceExtension(webp)).toBe("webp");
    expect(() => getVideoPackageReferenceExtension(Buffer.from("pretend.png"))).toThrow(/JPG.*PNG.*WebP/);
    expect(() => getVideoPackageReferenceExtension(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
  });

  it("cleans partial ZIP files on archive limits, cancellation and unexpected writes", async () => {
    const { project } = await fixture();
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot, maxArchiveBytes: 7000 })).rejects.toMatchObject({ statusCode: 413 });
    const controller = new AbortController();
    const original = StoredZipWriter.prototype.add;
    const add = vi.spyOn(StoredZipWriter.prototype, "add").mockImplementation(async function(this: StoredZipWriter, name, data) {
      await original.call(this, name, data); controller.abort();
    });
    await expect(prepareVideoPackage(project, config, controller.signal, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(tempRoot)).toEqual([]);
    add.mockRejectedValueOnce(new Error("private server path"));
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 500, message: expect.not.stringContaining(root) });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("detects an adopted WAV changing after preflight and discards the partial package", async () => {
    const { project, clips } = await fixture();
    const original = StoredZipWriter.prototype.add;
    vi.spyOn(StoredZipWriter.prototype, "add").mockImplementation(async function(this: StoredZipWriter, name, data) {
      await original.call(this, name, data);
      if (name === "project.json") await writeFile(path.join(config.clipAssetRoot, `${clips[1].asset.asset_id}.wav`), "changed");
    });
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("第 2 段") });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("rejects an empty batch and already-canceled work before creating files", async () => {
    const { project } = await fixture();
    project.timeline.tracks.find(track => track.track_type === "voice")!.clips = [];
    await expect(prepareVideoPackage(project, config, undefined, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 400 });
    const controller = new AbortController(); controller.abort();
    await expect(prepareVideoPackage((await fixture()).project, config, controller.signal, { tempRoot, runnerRoot })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(root)).not.toContain("exports");
  });
});
