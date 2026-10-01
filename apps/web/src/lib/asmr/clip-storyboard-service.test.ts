import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateClipStoryboard, type ClipStoryboardRequest } from "./clip-storyboard-service";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createClipH3Prompt, createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint, isClipVideoStoryboardCurrent, type ClipVideoStoryboard } from "./video-plan";

const base = path.resolve(process.platform === "win32" ? "I:/AI" : tmpdir());
let root: string, config: LocalRuntimeConfig;
const generated = { title: "暖光迎接", visual: "S1 stands beside a warmly lit kitchen counter.", action: "S1 gently gestures toward the counter.", camera: "Static eye-level medium close-up." };
function reply(value: unknown) { return Response.json({ message: { content: JSON.stringify(value) } }); }

beforeEach(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-clip-video-test-"));
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
});
afterEach(async () => {
  vi.useRealTimers();
  if (path.dirname(path.resolve(root)) === base && path.basename(root).startsWith("asmr-clip-video-test-")) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const project = structuredClone(demoProject);
  const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.slice(0, 3);
  for (const track of project.timeline.tracks) track.clips = [];
  for (const [index, clip] of voices.entries()) {
    clip.start = index;
    clip.duration = .025;
    clip.text = ["上一镜独有台词。", "  当前台词，\n<d>保持原样</d>。 ", "第三镜独有台词。"] [index];
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `audio_${index}`, uri: `asset://clip/audio_${index}`, duration: 40 };
    await writeFile(path.join(config.clipAssetRoot, `audio_${index}.wav`), writePcm16Wav(new Float32Array(2400).fill(.1), 8000));
  }
  project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.push(...voices);
  project.videoPlan = { version: 1, sceneDescription: "A quiet home kitchen at night, with warm amber light and wooden cabinets.", shots: {} };
  const input: ClipStoryboardRequest = { provider: "ollama", project, clipId: voices[1].id, includePrevious: false, instruction: "轻微动作" };
  return { project, voices, input };
}

function attachPrevious(project: ClipStoryboardRequest["project"], clipId: string): ClipVideoStoryboard {
  const clip = project.timeline.tracks.flatMap((track) => track.track_type === "voice" ? track.clips : []).find((candidate) => candidate.id === clipId)!;
  const shot: ClipVideoStoryboard = { ...generated, version: 1, promptFormat: "minimax-h3", clipId, sourceFingerprint: createClipVideoSourceFingerprint(project, clipId), audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: .3 } };
  project.videoPlan!.shots[clipId] = shot;
  return shot;
}

describe("已采用音频的单片段分镜", () => {
  it("measures the real complete WAV duration instead of either declared duration or timeline estimate", async () => {
    const { input, project, voices } = await fixture();
    const before = JSON.stringify(project);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    expect(result.storyboard).toEqual({ ...generated, version: 1, promptFormat: "minimax-h3", clipId: voices[1].id, sourceFingerprint: createClipVideoSourceFingerprint(project, voices[1].id), audio: { assetId: "audio_1", uri: "asset://clip/audio_1", duration: .3 } });
    expect(JSON.stringify(project)).toBe(before);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.options).toMatchObject({ num_predict: 2048, temperature: .5, num_gpu: -1 });
    expect(body.messages[0].content).toContain("visual、action、camera 必须是简洁具体的英文");
    expect(body.messages[0].content).toContain("不是整个文案的多镜列表");
    expect(body.messages[0].content).toContain("禁止从台词、角色设定或补充要求复述或发明");
    expect(body.messages[0].content).toContain("fully_copy");
    expect(body.messages[0].content).toContain("non_diegetic_music: N/A");
    expect(body.messages[0].content).toContain("每个字段只写一句");
    expect(body.messages[0].content).toContain("visual、action、camera 不重复这些固定要求");
    expect(body.messages[0].content).toContain("说话期间脸和嘴部始终可见");
    expect(body.messages[1].content).toContain('"audioDurationSeconds":0.3');
    expect(body.messages[1].content).toContain(project.videoPlan!.sceneDescription);
    expect(body.messages[1].content).toContain(JSON.stringify(voices[1].text).slice(1, -1));
    expect(body.messages[1].content).not.toContain("audio_1");
    expect(body.format.properties).not.toHaveProperty("audio");
    expect(body.format.properties).not.toHaveProperty("sourceFingerprint");
    expect(body.format.properties).not.toHaveProperty("dialogue");
    expect(body.format.properties.visual.maxLength).toBe(320);
    expect(body.format.properties.action.maxLength).toBe(180);
    expect(body.format.properties.camera.maxLength).toBe(120);
    project.videoPlan!.shots[voices[1].id] = result.storyboard;
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(true);
    const prompt = createClipH3Prompt(project, voices[1].id);
    expect(prompt).toContain(`<d>[Chinese]${voices[1].text}</d>`);
    expect(prompt).toContain("0.3 seconds");
    expect(prompt).not.toContain("40 seconds");
    expect(prompt).not.toContain(voices[0].text);
  });

  it("treats a short story background as semantic context for a concrete per-line view without copying it", async () => {
    const { input, project, voices } = await fixture();
    const background = "雪地木屋内，刚回来的客人歇息取暖。";
    project.videoPlan!.sceneDescription = background;
    voices[1].text = "来火边坐一会儿吧。";
    const fireplace = { title: "火边歇息", visual: "S1 sits beside a softly glowing fireplace.", action: "S1 offers a gentle open-hand gesture.", camera: "Static frontal medium close-up." };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(fireplace));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain(background);
    expect(body.messages[1].content).toContain(voices[1].text);
    expect(body.messages[0].content).toContain("仅作为语义上下文");
    expect(body.messages[0].content).toContain("结合当前台词选择一处相关景物或位置");
    expect(body.messages[0].content).toContain("不要复述、逐字复制或整段翻译基础背景");
    expect(body.messages[0].content).not.toContain("基础场景是全镜固定背景");
    expect(result.storyboard.visual).toBe(fireplace.visual);
    expect(result.storyboard.visual).not.toContain(background);
    expect(result.storyboard.action).toBe(fireplace.action);
    expect(result.storyboard.camera).toBe(fireplace.camera);
    expect(result.storyboard.sourceFingerprint).toBe(createClipVideoSourceFingerprint(project, voices[1].id));
  });

  it("limits newly generated visual fields without discarding longer editable previous notes", async () => {
    const { input, project, voices } = await fixture();
    const previous = attachPrevious(project, voices[0].id);
    previous.visual = "A".repeat(500);
    previous.action = "B".repeat(300);
    previous.camera = "C".repeat(200);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard({ ...input, includePrevious: true }, { env: {}, config, fetchImpl });
    expect(result.storyboard.previousClipId).toBe(voices[0].id);
    expect(project.videoPlan!.shots[voices[0].id]).toBe(previous);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain(previous.visual);
    expect(body.messages[0].content).toContain("不复述或复制上一镜提示词");
    for (const [field, limit] of [["visual", 320], ["action", 180], ["camera", 120]] as const) {
      const tooLong = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, [field]: "x".repeat(limit + 1) }));
      await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl: tooLong })).rejects.toMatchObject({ status: 502 });
      expect(tooLong).toHaveBeenCalledOnce();
    }
  });

  it("never sends a previous prompt or previous dialogue when continuity is disabled", async () => {
    const { input, project, voices } = await fixture();
    attachPrevious(project, voices[0].id);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(JSON.stringify(body.messages)).not.toContain(voices[0].text);
    expect(JSON.stringify(body.messages)).not.toContain("上一镜连续参考");
    expect(JSON.stringify(body.messages)).not.toContain("retention_analysis:");
    expect(result.storyboard).not.toHaveProperty("previousClipId");
    expect(result.storyboard).not.toHaveProperty("previousPromptFingerprint");
  });

  it("uses exactly the adjacent current prompt as continuity and binds its hand-edit fingerprint", async () => {
    const { input, project, voices } = await fixture();
    const previous = attachPrevious(project, voices[0].id);
    previous.action = "S1 rests one hand lightly on the counter.";
    const previousPrompt = createClipH3Prompt(project, voices[0].id);
    const previousFingerprint = getPreviousClipPromptFingerprint(project, voices[1].id);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard({ ...input, includePrevious: true }, { env: {}, config, fetchImpl });
    expect(result.storyboard.previousClipId).toBe(voices[0].id);
    expect(result.storyboard.previousPromptFingerprint).toBe(previousFingerprint);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain(previousPrompt);
    expect(body.messages[0].content).toContain("不能复制上一镜台词、音频");
    project.videoPlan!.shots[voices[1].id] = result.storyboard;
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(true);
    const prompt = createClipH3Prompt(project, voices[1].id);
    expect(prompt).toContain(`<d>[Chinese]${voices[1].text}</d>`);
    expect(prompt).not.toContain(voices[0].text);
    previous.visual += " A hand-edited scene change.";
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(false);
  });

  it("blocks missing, stale, incomplete or non-adjacent prior shots before a model call", async () => {
    const { input, project, voices } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateClipStoryboard({ ...input, includePrevious: true }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    attachPrevious(project, voices[0].id).visual = "";
    await expect(generateClipStoryboard({ ...input, includePrevious: true }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    attachPrevious(project, voices[0].id);
    voices[0].text += "已改原稿";
    await expect(generateClipStoryboard({ ...input, includePrevious: true }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    attachPrevious(project, voices[0].id);
    await expect(generateClipStoryboard({ ...input, clipId: voices[2].id, includePrevious: true }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    await expect(generateClipStoryboard({ ...input, clipId: voices[0].id, includePrevious: true }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unadopted voices, SFX IDs, unsafe asset IDs and inconsistent or remote URIs", async () => {
    const { input, voices } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>();
    for (const patch of [
      { generation: { ...voices[1].generation, status: "asset_pending" as const } },
      { asset: { ...voices[1].asset, asset_id: "../outside", uri: "asset://clip/../outside" } },
      { asset: { ...voices[1].asset, uri: "asset://clip/not-current" } },
      { asset: { ...voices[1].asset, uri: "https://remote.example/audio.wav" } },
      { asset: { asset_id: null, uri: null, duration: null } },
    ]) {
      const project = structuredClone(input.project);
      const track = project.timeline.tracks.find((candidate) => candidate.track_type === "voice")!;
      track.clips[1] = { ...track.clips[1], ...patch };
      await expect(generateClipStoryboard({ ...input, project }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 400 });
    }
    await expect(generateClipStoryboard({ ...input, clipId: "sfx_001" }, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed or oversized WAVs before dispatch", async () => {
    const { input } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateClipStoryboard(input, { env: {}, config: { ...config, clipAssetRoot: path.join(root, "missing") }, fetchImpl })).rejects.toMatchObject({ status: 404 });
    const audioPath = path.join(config.clipAssetRoot, "audio_1.wav");
    await writeFile(audioPath, Buffer.from("not a PCM WAV".repeat(5)));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 422 });
    await truncate(audioPath, 128 * 1024 * 1024 + 1);
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the legacy scene-name fallback stable but rejects an intentionally empty global scene", async () => {
    const { input, project, voices } = await fixture();
    delete project.videoPlan;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain(project.scene.name);
    project.videoPlan = { version: 1, sceneDescription: project.scene.name, shots: { [voices[1].id]: result.storyboard } };
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(true);
    fetchImpl.mockClear();
    project.videoPlan.sceneDescription = " \n ";
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("全局场景") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects model-added dialogue, duration, audio or provenance and does not regenerate TTS or retry", async () => {
    const { input } = await fixture();
    for (const value of [{ ...generated, dialogue: "新的台词" }, { ...generated, duration: 999 }, { ...generated, audio: { uri: "remote" } }, { ...generated, sourceFingerprint: "forged" }, { ...generated, visual: "" }]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
      await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 502 });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("cancels before asset access or during upstream generation without keeping late output", async () => {
    const { input } = await fixture();
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => { markStarted!(); return new Promise(() => {}); });
    const pending = generateClipStoryboard(input, { env: {}, config, fetchImpl, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ status: 499 });
    await started;
    controller.abort();
    await assertion;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchImpl.mockClear();
    await expect(generateClipStoryboard(input, { env: {}, config: { ...config, clipAssetRoot: "missing" }, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
