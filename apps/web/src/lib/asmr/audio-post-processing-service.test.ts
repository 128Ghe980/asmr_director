import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { applyAudioPostProcessingPlan, createAudioPostProcessingSettingsFingerprint } from "./audio-post-processing";
import { AUDIO_POST_PROCESSING_RENDERER_VERSION } from "./audio-post-processing-schema";
import { planAudioPostProcessing, renderAudioPostProcessing } from "./audio-post-processing-service";
import type { LocalRuntimeConfig } from "./local-runtime-config";

const base = path.resolve(process.env.ASMR_TEST_TEMP_ROOT ?? "I:/AI/asmr-director-audio-post-processing/2026-10-23/tests");
const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "test-only-key", ASMR_PLANNER_API_MODEL: "test-model" };
let root: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  await mkdir(base, { recursive: true }); root = await mkdtemp(path.join(base, "post-processing-"));
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot);
});
afterEach(async () => { if (path.dirname(path.resolve(root)) === base && path.basename(root).startsWith("post-processing-")) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const project = structuredClone(demoProject), track = project.timeline.tracks.find(item => item.track_type === "voice")!;
  track.clips = track.clips.slice(0, 2);
  project.videoPlan = { version: 1, sceneDescription: "雪夜归家，屋内安静。", shots: {} };
  for (const [index, clip] of track.clips.entries()) {
    clip.generation.status = "asset_generated"; clip.asset = { asset_id: `raw_${index}`, uri: `asset://clip/raw_${index}`, duration: .1 };
    await writeFile(path.join(config.clipAssetRoot, `raw_${index}.wav`), writePcm16Wav(new Float32Array(4800).fill(.1), 48000));
    project.videoPlan.shots[clip.id] = { version: 1, promptFormat: "minimax-h3", clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id), audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: .1 }, title: "暖屋", visual: "A person beside the stove", action: "Sits quietly", camera: "Close-up", referenceMode: "new" };
  }
  const generated = { shots: track.clips.map((clip, index) => ({ clipId: clip.id, reason: "顺着剧情自然靠近", start: { pan: 0, distance: "near" }, end: { pan: .2, distance: "close" }, movement: index ? "static" : "approach", reset: index === 0 })) };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] }));
  return { project, track, generated, fetchImpl };
}
describe("audio post-processing planning and rendering", () => {
  it("plans the whole batch once using scene and shots, measured source metadata and API config", async () => {
    const { project, fetchImpl } = await fixture(), original = JSON.stringify(project);
    const { processing } = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(processing.shots).toHaveLength(2);
    expect(processing.shots[0]).toMatchObject({ sourceAssetId: "raw_0", durationSeconds: .1 });
    expect(processing.shots[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(processing.shots[1].start).toEqual(processing.shots[0].end);
    expect(processing.shots[1].end).toEqual(processing.shots[1].start);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.messages[1].content).toContain("Close-up");
    expect(body.messages[0].content).toContain("特写");
    expect(body.messages[1].content).not.toContain(config.clipAssetRoot);
    expect(JSON.stringify(project)).toBe(original);
  });

  it("reuses the plan after manual static position edits and propagates the new landing without another AI call", async () => {
    const { project, fetchImpl } = await fixture();
    const { processing } = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    const planned = applyAudioPostProcessingPlan(project, processing);
    const clip = planned.timeline.tracks.find(item => item.track_type === "voice")!.clips[0];
    clip.position = { pan: -.7, distance: "far", movement: "static" };
    const reused = await planAudioPostProcessing({ project: planned, provider: "api" }, { env, config, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(reused.processing.shots[0]).toMatchObject({ start: { pan: -.7, distance: "far" }, end: { pan: -.7, distance: "far" }, reset: true });
    expect(reused.processing.shots[1].start).toEqual(reused.processing.shots[0].end);
  });

  it("rejects missing storyboards and invalid model membership before rendering", async () => {
    const { project, generated, fetchImpl } = await fixture();
    delete project.videoPlan!.shots[generated.shots[0].clipId];
    await expect(planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const good = await fixture();
    good.generated.shots[1].clipId = good.generated.shots[0].clipId;
    good.fetchImpl.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(good.generated) } }] }));
    await expect(planAudioPostProcessing({ project: good.project, provider: "api" }, { env, config, fetchImpl: good.fetchImpl })).rejects.toMatchObject({ status: 502 });
  });

  it("renders one source-bound plan without replacing the original, and rejects changed source bytes", async () => {
    const { project, fetchImpl } = await fixture();
    const { processing } = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    const planned = applyAudioPostProcessingPlan(project, processing), shot = processing.shots[0];
    const renderImpl = vi.fn().mockImplementation(async input => ({ asset: { assetId: "processed_1", uri: "asset://clip/processed_1", duration: .75 }, sourceSha256: shot.sourceSha256,
      outputSha256: "c".repeat(64), settingsFingerprint: createAudioPostProcessingSettingsFingerprint(input), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION }));
    const result = await renderAudioPostProcessing({ project: planned, clipId: shot.clipId }, { config, renderImpl });
    expect(result.receipt).toMatchObject({ clipId: shot.clipId, inputFingerprint: processing.inputFingerprint, asset: { assetId: "processed_1" } });
    expect(planned.timeline.tracks.find(item => item.track_type === "voice")!.clips[0].asset.asset_id).toBe("raw_0");
    await writeFile(path.join(config.clipAssetRoot, "raw_0.wav"), writePcm16Wav(new Float32Array(4800).fill(.2), 48000));
    await expect(renderAudioPostProcessing({ project: planned, clipId: shot.clipId }, { config, renderImpl })).rejects.toMatchObject({ status: 409 });
    expect(renderImpl).toHaveBeenCalledOnce();
  });

  it("does not dispatch an already cancelled plan or render", async () => {
    const { project, fetchImpl } = await fixture(), controller = new AbortController(); controller.abort();
    await expect(planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    await expect(renderAudioPostProcessing({ project, clipId: "missing" }, { config, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a source mutation while the API is pending instead of binding a plan to new bytes", async () => {
    const { project, generated, fetchImpl } = await fixture();
    fetchImpl.mockImplementation(async () => {
      await writeFile(path.join(config.clipAssetRoot, "raw_0.wav"), writePcm16Wav(new Float32Array(4800).fill(.4), 48000));
      return Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] });
    });
    await expect(planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
  });

  it("includes silent storyboards as context without inventing a silent WAV or render plan", async () => {
    const { project, track, generated, fetchImpl } = await fixture();
    const silent = structuredClone(track.clips[0]); silent.id = "silent_context"; silent.kind = "silent"; silent.text = "看向落雪的窗边"; silent.duration = 2;
    silent.asset = { asset_id: null, uri: null, duration: null }; track.clips.splice(1, 0, silent);
    project.videoPlan!.shots[silent.id] = { version: 1, promptFormat: "minimax-h3", clipId: silent.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, silent.id), kind: "silent", duration: 2, title: "窗外", visual: "Snow beyond window", action: "Snow falls", camera: "Wide shot", ambientSound: "Quiet room tone", referenceMode: "new" };
    generated.shots[1].reset = true; generated.shots[1].start = { pan: -.5, distance: "far" };
    generated.shots[1].reason = "无对白镜头中已走到窗边，接续新位置";
    fetchImpl.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] }));
    const result = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    expect(result.processing.shots).toHaveLength(2);
    expect(result.processing.shots[1]).toMatchObject({ reset: true, start: { pan: -.5, distance: "far" }, end: { pan: -.5, distance: "far" } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages[1].content).toContain("Quiet room tone");
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages[0].content).toContain("无对白动作");
  });

  it("retains completed receipts on plan reuse but does not let a renderer return a different input", async () => {
    const { project, fetchImpl } = await fixture();
    const { processing } = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    const planned = applyAudioPostProcessingPlan(project, processing), shot = processing.shots[0];
    const renderImpl = vi.fn().mockImplementation(async input => ({ asset: { assetId: "processed_1", uri: "asset://clip/processed_1", duration: .75 },
      sourceSha256: shot.sourceSha256, outputSha256: "c".repeat(64), settingsFingerprint: createAudioPostProcessingSettingsFingerprint(input), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION }));
    const { receipt } = await renderAudioPostProcessing({ project: planned, clipId: shot.clipId }, { config, renderImpl });
    planned.audioPostProcessing!.results[shot.clipId] = receipt;
    const reused = await planAudioPostProcessing({ project: planned, provider: "api" }, { env, config, fetchImpl });
    expect(reused.processing.results[shot.clipId]).toEqual(receipt); expect(fetchImpl).toHaveBeenCalledOnce();
    renderImpl.mockResolvedValueOnce({ ...receipt, sourceSha256: "e".repeat(64) });
    await expect(renderAudioPostProcessing({ project: planned, clipId: shot.clipId }, { config, renderImpl })).rejects.toMatchObject({ status: 409 });
  });

  it("does not publish a late plan or render after cancellation", async () => {
    const { project, generated, fetchImpl } = await fixture(), controller = new AbortController();
    fetchImpl.mockImplementation(async () => {
      controller.abort(); return Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] });
    });
    await expect(planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(project.audioPostProcessing).toBeUndefined();
    const good = await fixture();
    const { processing } = await planAudioPostProcessing({ project: good.project, provider: "api" }, { env, config, fetchImpl: good.fetchImpl });
    const planned = applyAudioPostProcessingPlan(good.project, processing), renderController = new AbortController();
    const renderImpl = vi.fn().mockImplementation(async () => { renderController.abort(); throw new Error("private error"); });
    await expect(renderAudioPostProcessing({ project: planned, clipId: processing.shots[0].clipId }, { config, renderImpl, signal: renderController.signal })).rejects.toMatchObject({ status: 499 });
    expect(planned.audioPostProcessing!.results).toEqual({});
  });

  it("plans a hundred-line project in one API call with the explicit bounded larger budget", async () => {
    const { project, track, fetchImpl } = await fixture(), template = structuredClone(track.clips[0]);
    track.clips = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(template), id: `batch_${index}` }));
    const generated = { shots: track.clips.map(clip => ({ clipId: clip.id, reason: "静坐自然衔接", start: { pan: 0, distance: "near" },
      end: { pan: 0, distance: "near" }, movement: "static", reset: false })) };
    project.videoPlan!.shots = Object.fromEntries(track.clips.map(clip => [clip.id, { version: 1 as const, promptFormat: "minimax-h3" as const, clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id), audio: { assetId: "raw_0", uri: "asset://clip/raw_0", duration: .1 },
      title: "炉边", visual: "A quiet warm room", action: "Sits still", camera: "Medium shot", referenceMode: "new" as const }]));
    fetchImpl.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(generated) } }] }));
    const { processing } = await planAudioPostProcessing({ project, provider: "api" }, { env, config, fetchImpl });
    expect(processing.shots).toHaveLength(100); expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).max_tokens).toBe(16_384);
  });
});
