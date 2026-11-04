import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVideoPackage, type VideoPackageManifest } from "./local-video-package";
import { getVideoPackageSummary } from "./video-package";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { makePreparedAudioFixture, readStoredZip } from "./post-processing-test-fixtures";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { AsmrProject } from "./schema";

vi.mock("./processed-voice-renderer", () => ({ renderProcessedVoice: () => { throw new Error("Export must not render D audio"); } }));
const base = process.platform === "win32"
  ? "I:/AI/asmr_director/qa/voice-continuity/2026-11-02-window-pause/export-tests" : tmpdir();
let root: string, tempRoot: string, config: LocalRuntimeConfig;
const runnerRoot = path.resolve(process.cwd(), "../../tools/comfy-batch");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeEach(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "delivery-"));
  tempRoot = path.join(root, "exports");
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mixes"),
    voicePackPath: "unused", gptSovitsBaseUrl: "unused", spatialHrtfPath: path.join(root, "fixture.sofa") };
  // Bundling validates the HDF5 signature; this test never loads or renders HRTF data.
  await writeFile(config.spatialHrtfPath!, Buffer.from([137, 72, 68, 70, 13, 10, 26, 10]));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Export must not call a model or network service"); }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (path.dirname(root) !== path.resolve(base)) throw new Error("Unsafe export test cleanup");
  await rm(root, { recursive: true, force: true });
});

function voices(project: AsmrProject) {
  return project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
}
function defaultPauses(project: AsmrProject) {
  voices(project).forEach(clip => { clip.pause_after = 0; delete clip.tail_pause_seconds; });
}
function addSounds(project: AsmrProject) {
  for (const shot of Object.values(project.videoPlan!.shots)) shot.asmrSound = {
    role: "trigger", prompt: "A cotton fold slides once between two fingertips, then rests quietly.",
    postProcessing: { start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -12 },
  };
}
async function exported(project: AsmrProject) {
  const before = JSON.stringify(project);
  const archive = await prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot });
  try {
    const files = readStoredZip(await readFile(archive.filePath));
    const manifest = JSON.parse(files.get("project.json")!.toString("utf8")) as VideoPackageManifest;
    expect(JSON.stringify(project)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
    return { files, manifest };
  } finally { await archive.cleanup(); }
}
function assertWholeSourceThenSilence(delivery: Buffer, source: Buffer, duration: number) {
  const pcm = decodePcmWav(delivery);
  expect(pcm.samples.length / pcm.channels / pcm.sampleRate).toBe(duration);
  expect(delivery.subarray(44, source.length).equals(source.subarray(44))).toBe(true);
  expect(delivery.subarray(source.length).every(value => value === 0)).toBe(true);
}

describe("voice delivery WAVs drive exported video and ASMR timing", () => {
  it("keeps the entire D tail, appends .35 once, and exports matching main and ASMR durations", async () => {
    const { project, raw, processed } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project); addSounds(project);
    const { files, manifest } = await exported(project);
    expect(manifest.shots.map(shot => [shot.durationSeconds, shot.asmrSound?.durationSeconds,
      shot.sourceDurationSeconds, shot.tailPauseSeconds])).toEqual([[1.1, 1.1, .75, .35], [.75, .75, .75, 0]]);
    assertWholeSourceThenSilence(files.get("shots/001/audio.wav")!, processed, 1.1);
    expect(files.get("shots/002/audio.wav")).toEqual(processed);
    expect(await readFile(path.join(config.clipAssetRoot, "original_0.wav"))).toEqual(raw);
    expect(await readFile(path.join(config.clipAssetRoot, "prepared_0.wav"))).toEqual(processed);
  });

  it("keeps the all-original fallback when one D receipt is missing, with the same pause contract", async () => {
    const { project, clipIds, raw, processed } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project); addSounds(project);
    delete project.audioPostProcessing!.results[clipIds[1]];
    const { files, manifest } = await exported(project);
    expect(manifest.shots.map(shot => [shot.durationSeconds, shot.asmrSound?.durationSeconds])).toEqual([[.45, .45], [.1, .1]]);
    assertWholeSourceThenSilence(files.get("shots/001/audio.wav")!, raw, .45);
    expect(files.get("shots/002/audio.wav")).toEqual(raw);
    expect(await readFile(path.join(config.clipAssetRoot, "prepared_0.wav"))).toEqual(processed);
  });

  it("adds the default after speech before a silent performance, without stretching the performance", async () => {
    const { project, raw } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project); delete project.audioPostProcessing;
    const silent = voices(project)[1];
    Object.assign(silent, { kind: "silent", duration: 1.25, asset: { asset_id: null, uri: null, duration: null } });
    silent.generation.status = "asset_pending";
    const shot = project.videoPlan!.shots[silent.id];
    delete shot.audio;
    Object.assign(shot, { kind: "silent", duration: 1.25, ambientSound: "Quiet indoor air.",
      sourceFingerprint: createClipVideoSourceFingerprint(project, silent.id) });
    addSounds(project);
    const { files, manifest } = await exported(project);
    expect(manifest.shots.map(item => [item.kind, item.durationSeconds, item.asmrSound?.durationSeconds]))
      .toEqual([["speech", .45, .45], ["ambient", 1.25, 1.25]]);
    assertWholeSourceThenSilence(files.get("shots/001/audio.wav")!, raw, .45);
    expect(files.has("shots/002/audio.wav")).toBe(false);
  });

  it("preserves a positive authored pause and ignores a final-segment trailing pause", async () => {
    const { project, processed } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project);
    voices(project)[0].pause_after = .6; voices(project)[1].pause_after = 7;
    const { files, manifest } = await exported(project);
    expect(manifest.shots.map(shot => [shot.durationSeconds, shot.tailPauseSeconds])).toEqual([[1.35, .6], [.75, 0]]);
    assertWholeSourceThenSilence(files.get("shots/001/audio.wav")!, processed, 1.35);
    expect(files.get("shots/002/audio.wav")).toEqual(processed);
  });

  it("restores byte-identical D delivery when the explicit override is zero", async () => {
    const { project, processed } = await makePreparedAudioFixture(config, 2);
    voices(project)[0].pause_after = 2; voices(project)[0].tail_pause_seconds = 0;
    const { files, manifest } = await exported(project);
    expect(manifest.shots.map(shot => [shot.durationSeconds, shot.tailPauseSeconds])).toEqual([[.75, 0], [.75, 0]]);
    expect(files.get("shots/001/audio.wav")).toEqual(processed);
    expect(files.get("shots/002/audio.wav")).toEqual(processed);
  });

  it("accepts 14.65 actual seconds plus .35, but refuses one extra sample without truncation", async () => {
    const { project } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project); delete project.audioPostProcessing;
    const sourcePath = path.join(config.clipAssetRoot, "original_0.wav");
    const raw = Buffer.from(writePcm16Wav(new Float32Array(703200).fill(.125), 48000));
    await writeFile(sourcePath, raw);
    const { files, manifest } = await exported(project);
    expect(manifest.shots[0]).toMatchObject({ sourceDurationSeconds: 14.65, tailPauseSeconds: .35, durationSeconds: 15 });
    assertWholeSourceThenSilence(files.get("shots/001/audio.wav")!, raw, 15);
    const tooLong = Buffer.from(writePcm16Wav(new Float32Array(703201).fill(.125), 48000));
    await writeFile(sourcePath, tooLong);
    expect(getVideoPackageSummary(project).issues).toEqual([]); // Metadata still says .1 seconds.
    await expect(prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot }))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining("15 秒") });
    expect((await readFile(sourcePath)).equals(tooLong)).toBe(true);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("uses D receipt duration plus the pause in browser readiness before writing any ZIP", async () => {
    const { project, clipIds } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project);
    project.audioPostProcessing!.results[clipIds[0]].asset.duration = 14.8;
    const summary = getVideoPackageSummary(project);
    expect(summary).toMatchObject({ total: 2, ready: 1 });
    expect(summary.issues).toEqual([expect.objectContaining({ clipId: clipIds[0], message: expect.stringContaining("15 秒") })]);
    await expect(prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("尾音与段间留白") });
    expect(await readdir(root)).not.toContain("exports");
  });

  it("rejects actual oversized D-plus-pause audio even if its saved duration is short", async () => {
    const { project, clipIds, raw } = await makePreparedAudioFixture(config, 2);
    defaultPauses(project);
    const tooLong = Buffer.from(writePcm16Wav(new Float32Array(703201 * 2).fill(.02), 48000, 2));
    await writeFile(path.join(config.clipAssetRoot, "prepared_0.wav"), tooLong);
    project.audioPostProcessing!.results[clipIds[0]].outputSha256 = digest(tooLong);
    expect(getVideoPackageSummary(project).issues).toEqual([]);
    await expect(prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot }))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining("15 秒") });
    expect((await readFile(path.join(config.clipAssetRoot, "prepared_0.wav"))).equals(tooLong)).toBe(true);
    expect(await readFile(path.join(config.clipAssetRoot, "original_0.wav"))).toEqual(raw);
    expect(await readdir(root)).not.toContain("exports");
  });
});
