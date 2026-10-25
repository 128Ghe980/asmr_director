import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAcceptedVoicePreviewPlan } from "./accepted-voice-preview";
import { getCurrentProcessedVoiceAsset } from "./audio-post-processing";
import { generateLocalProjectMix } from "./local-project-mix-generation";
import { prepareBatchDownload } from "./local-batch-download";
import { prepareVideoPackage } from "./local-video-package";
import { prepareVoicePreview } from "./local-voice-preview";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import { makePreparedAudioFixture, readStoredZip } from "./post-processing-test-fixtures";
import { readPreparedAudioSource } from "./prepared-audio-source";

vi.mock("./processed-voice-renderer", () => ({ renderProcessedVoice: () => { throw new Error("Delivery must not render audio"); } }));
vi.mock("./spatial-audio", () => ({ renderSpatialClip: () => { throw new Error("Delivery must not trigger legacy spatial DSP"); } }));
let root: string, config: LocalRuntimeConfig, runnerRoot: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "asmr-prepared-delivery-"));
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mixes"), voicePackPath: "unused", gptSovitsBaseUrl: "unused" };
  runnerRoot = path.join(root, "runner"); await mkdir(runnerRoot);
  for (const name of ["runner.py", "run.bat", "README.zh.md", "workflow_api.json"]) await writeFile(path.join(runnerRoot, name), name === "workflow_api.json" ? "{}" : "fixture");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("delivery of explicitly prepared audio", () => {
  it("keeps original preview independent and concatenates stored processed bytes without timeline waits or another render", async () => {
    const { project, raw, processed } = await makePreparedAudioFixture(config);
    const original = getAcceptedVoicePreviewPlan(project);
    expect(original.entries[0]).toMatchObject({ assetId: "original_0", gapAfterSeconds: 25 });
    const plan = getAcceptedVoicePreviewPlan(project, "processed");
    expect(plan.entries.map(entry => entry.gapAfterSeconds)).toEqual([0, 0]);
    expect(plan.entries[0]).toMatchObject({ assetId: "prepared_0" });
    const preview = await prepareVoicePreview(project, config, undefined, { tempRoot: path.join(root, "tmp"), audioVersion: "processed" });
    const result = decodePcmWav(await readFile(preview.filePath)), expected = decodePcmWav(processed);
    expect(preview.duration).toBe(1.5);
    expect(result.samples.slice(0, expected.samples.length)).toEqual(expected.samples);
    expect(result.samples.slice(expected.samples.length)).toEqual(expected.samples);
    expect(await readFile(path.join(config.clipAssetRoot, "original_0.wav"))).toEqual(raw);
    await preview.cleanup();
  });

  it("exports each stored processed WAV byte-for-byte with its original beside it", async () => {
    const { project, raw, processed } = await makePreparedAudioFixture(config);
    const archive = await prepareBatchDownload(project, config, undefined, { tempRoot: path.join(root, "tmp") });
    const files = readStoredZip(await readFile(archive.filePath));
    expect([...files].filter(([name]) => name.includes("/无后处理/")).map(([, bytes]) => bytes)).toEqual([raw, raw]);
    expect([...files].filter(([name]) => name.includes("/后处理/")).map(([, bytes]) => bytes)).toEqual([processed, processed]);
    await archive.cleanup();
  });

  it("uses complete current prepared audio in the portable video package without changing the workflow protocol", async () => {
    const { project, processed } = await makePreparedAudioFixture(config);
    const archive = await prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot: path.join(root, "tmp") });
    const files = readStoredZip(await readFile(archive.filePath)), manifest = JSON.parse(files.get("project.json")!.toString());
    expect(manifest).toMatchObject({ format: "asmr-video-package", version: 1 });
    expect(manifest.shots.map((shot: { durationSeconds: number }) => shot.durationSeconds)).toEqual([.75, .75]);
    expect(files.get("shots/001/audio.wav")).toEqual(processed);
    expect(files.get("shots/002/audio.wav")).toEqual(processed);
    await archive.cleanup();
  });

  it("retains all originals in a video package while an explicit batch is incomplete", async () => {
    const { project, clipIds, raw, processed } = await makePreparedAudioFixture(config);
    delete project.audioPostProcessing!.results[clipIds[1]];
    const archive = await prepareVideoPackage(project, config, undefined, { runnerRoot, tempRoot: path.join(root, "tmp") });
    const files = readStoredZip(await readFile(archive.filePath));
    expect(files.get("shots/001/audio.wav")).toEqual(raw); expect(files.get("shots/002/audio.wav")).toEqual(raw);
    await archive.cleanup();
    const partial = await prepareBatchDownload(project, config, undefined, { tempRoot: path.join(root, "tmp") });
    const partialFiles = readStoredZip(await readFile(partial.filePath));
    expect([...partialFiles].filter(([name]) => name.includes("/后处理/")).map(([, bytes]) => bytes)).toEqual([processed]);
    await partial.cleanup();
    await expect(prepareVoicePreview(project, config, undefined, { tempRoot: path.join(root, "tmp"), audioVersion: "processed" })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("does not apply clip gain, fades or positioning twice when mixing prepared audio", async () => {
    const { project } = await makePreparedAudioFixture(config, 1);
    const result = await generateLocalProjectMix({ project, config });
    const audio = decodePcmWav(await readFile(path.join(config.mixAssetRoot, `${result.assetId}.wav`)));
    expect(audio.samples[0]).toBeCloseTo(.04, 4);
    expect(audio.samples[1]).toBeCloseTo(.02, 4);
    expect(audio.samples[10000]).toBeCloseTo(.04, 4);
  });

  it("detects source and output-file changes without modifying originals or doing hidden rendering", async () => {
    const { project, clipIds, raw, processed } = await makePreparedAudioFixture(config, 1);
    expect((await readPreparedAudioSource(project, clipIds[0], config))!.wav).toEqual(processed);
    await writeFile(path.join(config.clipAssetRoot, "prepared_0.wav"), raw);
    await expect(readPreparedAudioSource(project, clipIds[0], config)).rejects.toThrow("变化");
    await writeFile(path.join(config.clipAssetRoot, "prepared_0.wav"), processed);
    await writeFile(path.join(config.clipAssetRoot, "original_0.wav"), processed);
    await expect(readPreparedAudioSource(project, clipIds[0], config)).rejects.toThrow("变化");
    await writeFile(path.join(config.clipAssetRoot, "original_0.wav"), raw);
    project.videoPlan!.shots[clipIds[0]].action = "Walks away";
    expect(getCurrentProcessedVoiceAsset(project, clipIds[0])).toBeUndefined();
    await expect(prepareVoicePreview(project, config, undefined, { audioVersion: "processed" })).rejects.toMatchObject({ statusCode: 422 });
  });
});
