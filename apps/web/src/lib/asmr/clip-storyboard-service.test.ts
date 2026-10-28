import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClipStoryboardRequestSchema, generateClipStoryboard, readClipStoryboardRequest, type ClipStoryboardRequest } from "./clip-storyboard-service";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { addSilentClip } from "./voice-segments";
import { createClipH3Prompt, createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint, isClipVideoStoryboardCurrent, type ClipVideoStoryboard } from "./video-plan";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { CREATIVE_TEMPLATES } from "./creative-templates";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";

const base = path.resolve(process.env.ASMR_STORYBOARD_TEST_ROOT ?? tmpdir());
let root: string, config: LocalRuntimeConfig;
const generated = { title: "暖光迎接", visual: "S1 stands beside a warmly lit kitchen counter.", action: "S1 gently gestures toward the counter.", camera: "Static eye-level medium close-up.", asmrSound: asmrSoundFixture };
function reply(value: unknown) { return Response.json({ message: { content: JSON.stringify(value) } }); }
function materialFrom(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
  return JSON.parse(body.messages[1].content.split("\n")[0].slice("当前镜头素材：".length));
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-clip-video-test-"));
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "http://unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
});
afterEach(async () => {
  vi.useRealTimers();
  if (path.dirname(path.resolve(root)) === base && path.basename(root).startsWith("asmr-clip-video-test-")) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
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

async function coldEntrySilentFixture(description?: string) {
  const { project, voices } = await fixture();
  project.title = "寒潮前的归家";
  project.videoPlan!.sceneDescription = "寒潮将至，朋友刚到木屋门前，正准备进屋，还没有进入室内。";
  const lines = ["外面风起来了，快到门边来。", "先站稳，我把门开大一点。", "把靴子上的雪抖掉，再进来。"];
  voices.forEach((clip, index) => { clip.text = lines[index]; clip.asset.duration = .3; });
  const following = { ...structuredClone(voices[2]), id: "cold_entry_following", start: 3, text: "进屋后再把外套挂起来。" };
  project.timeline.tracks.find(track => track.track_type === "voice")!.clips.push(following);
  const inserted = addSilentClip(project, voices[2].id, description === undefined ? {} : { description });
  const clip = inserted.project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : [])
    .find(item => item.id === inserted.selectedClipId)!;
  const input: ClipStoryboardRequest = { provider: "api", project: inserted.project, clipId: clip.id, referenceMode: "new", includePrevious: false, instruction: "" };
  return { project: inserted.project, input, clip, lines: [...lines, clip.text, following.text] };
}

describe("已采用音频的单片段分镜", () => {
  it("plans a moving listener viewpoint and an independent ASMR track while keeping the measured source duration", async () => {
    const { input, project, voices } = await fixture();
    project.videoPlan!.storyboardStyle = "listener_pov";
    voices[1].text = "你已经走到桌边，低头看看这本书。";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain("摄影机就是剧情中听者的眼睛");
    expect(system).toContain("不为了拍到");
    expect(system).not.toContain("说话期间脸和嘴部始终可见");
    expect(system).toContain("对白镜头与无对白镜头都必须有");
    expect(result.storyboard).toMatchObject({ storyboardStyle: "listener_pov", asmrSound: asmrSoundFixture, audio: { duration: .3 } });
    expect(result.storyboard.asmrSound).not.toHaveProperty("durationSeconds");
    project.videoPlan!.shots[voices[1].id] = result.storyboard;
    const prompt = createClipH3Prompt(project, voices[1].id);
    expect(prompt).toContain("camera is the listener's own eyes");
    expect(prompt).toContain("may speak from outside");
    expect(prompt).toContain("<Audio 1>: fully_copy");
    expect(prompt).not.toContain(asmrSoundFixture.prompt);
  });
  it("rejects a newly generated shot missing its ASMR plan without retrying or overwriting a saved shot", async () => {
    const { input, project, voices } = await fixture();
    attachPrevious(project, voices[1].id);
    const before = JSON.stringify(project);
    const { asmrSound: _omitted, ...legacyReply } = generated;
    void _omitted;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(legacyReply));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("ASMR 触发音") });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(project)).toBe(before);
  });
  it("provides template structure and only text-matched director notes while retaining full original audio rules", async () => {
    const { input, project, voices } = await fixture();
    project.videoPlan!.referenceTemplate = structuredClone(referenceTemplateFixture);
    project.videoPlan!.templateDirections = [{ text: voices[1].text, direction: "先放下红色用品，再展示蓝瓶，结尾持瓶。", soundSuggestions: "轻轻敲瓶，仅建议" }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const material = materialFrom(fetchImpl), body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(material.referenceTemplate.storyboardRules).toBe(referenceTemplateFixture.storyboardRules);
    expect(material.scriptOrder[1].directorNotes[0].direction).toBe(project.videoPlan!.templateDirections[0].direction);
    expect(material.scriptOrder[0]).not.toHaveProperty("directorNotes");
    expect(body.messages[0].content).toContain("禁止按索引硬套旧说明");
    expect(body.messages[0].content).toContain("fully_copy");
    expect(body.messages[0].content).toContain("soundSuggestions 只是语义参考");
    expect(material.audioDurationSeconds).toBe(.3);
  });
  it("uses interaction acting and listener viewpoint for both speech and silent ASMR planning", async () => {
    for (const silent of [false, true]) {
      const { input, project, voices } = await fixture();
      const template = CREATIVE_TEMPLATES.find(item => item.id === "intimate-interaction-theatre")!;
      project.videoPlan!.referenceTemplate = structuredClone(template);
      project.videoPlan!.storyboardStyle = "character_framing";
      if (silent) { voices[1].kind = "silent"; voices[1].duration = 4; }
      project.videoPlan!.templateDirections = [{ text: voices[1].text, direction: "S1看向听者后停留，听者视点稳定。", soundSuggestions: "纸叶轻轻落在桌面，不重复敲击。" }];
      const planned = { ...generated, ...(silent ? { ambientSound: "Quiet greenhouse room tone." } : {}) };
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(silent ? Response.json({ choices: [{ message: { content: JSON.stringify(planned) } }] }) : reply(planned));
      const result = await generateClipStoryboard(input, { env: silent ? {
        ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "mock-only", ASMR_PLANNER_API_MODEL: "mock-model",
      } : {}, config, fetchImpl });
      const material = materialFrom(fetchImpl), system = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages[0].content as string;
      expect(material.storyboardStyle).toBe("listener_pov");
      expect(material.referenceTemplate.storyboardRules).toBe(template.storyboardRules);
      expect(system).toContain("对视、等待或微表情可以构成本镜");
      expect(system).not.toContain("只借鉴展示、归位和报价的结构");
      expect(system).not.toContain("说话期间脸和嘴部始终可见");
      expect(system).toContain("对白镜头与无对白镜头都必须有");
      expect(result.storyboard.asmrSound).toEqual(asmrSoundFixture);
      if (!silent) expect(material.scriptOrder[1].directorNotes[0].soundSuggestions).toContain("纸叶");
    }
  });
  it("ignores a model-added ambient sound on speech shots while retaining the existing speech prompt", async () => {
    const { input, project, voices } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, ambientSound: "Rain outside." }));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    expect(result.storyboard).not.toHaveProperty("ambientSound");
    project.videoPlan!.shots[voices[1].id] = result.storyboard;
    const prompt = createClipH3Prompt(project, voices[1].id);
    expect(prompt).toContain("<Audio 1>: fully_copy");
    expect(prompt).not.toContain("Rain outside.");
  });
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
    expect(body.messages[0].content).toContain("建议 visual 尽量控制在 320 字符内");
    expect(body.messages[0].content).toContain("action 尽量控制在 180 字符内");
    expect(body.messages[0].content).toContain("camera 尽量控制在 120 字符内");
    expect(body.messages[0].content).toContain("visual、action、camera 不重复这些固定要求");
    expect(body.messages[0].content).toContain("说话期间脸和嘴部始终可见");
    expect(body.messages[1].content).toContain('"audioDurationSeconds":0.3');
    expect(body.messages[1].content).toContain(project.videoPlan!.sceneDescription);
    expect(body.messages[1].content).toContain(JSON.stringify(voices[1].text).slice(1, -1));
    expect(body.messages[1].content).not.toContain("audio_1");
    expect(body.format.properties).not.toHaveProperty("audio");
    expect(body.format.properties).not.toHaveProperty("sourceFingerprint");
    expect(body.format.properties).not.toHaveProperty("dialogue");
    expect(body.format.properties.visual.maxLength).toBe(800);
    expect(body.format.properties.action.maxLength).toBe(600);
    expect(body.format.properties.camera.maxLength).toBe(400);
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
    const fireplace = { title: "火边歇息", visual: "S1 sits beside a softly glowing fireplace.", action: "S1 offers a gentle open-hand gesture.", camera: "Static frontal medium close-up.", asmrSound: asmrSoundFixture };
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

  it("sends full script order, future speech and silent actions without timeline timing or unavailable audio dependencies", async () => {
    const { input, project, voices } = await fixture();
    voices[0].text = "我已经把热汤放在桌上了。";
    voices[1].text = "你来火边坐吧。";
    voices[2].text = "等你暖和了，我再去端汤。";
    voices[0].asset.duration = 2.75;
    const silent = { ...structuredClone(voices[0]), id: "silent_context", kind: "silent" as const, text: "镜头停留在桌上冒着热气的碗。", duration: 4.25 };
    const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips = [voices[0], silent, voices[1], voices[2]];
    project.duration = 200_000;
    for (const [index, clip] of track.clips.entries()) {
      clip.start = (4 - index) * 1000;
      clip.pause_after = 8888;
      if (clip.kind !== "silent") clip.duration = 98765;
    }
    voices[2].generation.status = "asset_pending";
    voices[2].asset = { asset_id: null, uri: null, duration: null };
    // Neither an unavailable neighboring WAV nor missing neighboring storyboards blocks a new shot.
    await rm(path.join(config.clipAssetRoot, "audio_0.wav"));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    await generateClipStoryboard({ ...input, referenceMode: "new" }, { env: {}, config, fetchImpl });
    const material = materialFrom(fetchImpl);
    expect(material.currentIndex).toBe(2);
    expect(material.scriptOrder).toEqual([
      { index: 0, clipId: voices[0].id, kind: "speech", text: voices[0].text, durationSeconds: 2.75 },
      { index: 1, clipId: silent.id, kind: "silent", text: silent.text, durationSeconds: 4.25 },
      { index: 2, clipId: voices[1].id, kind: "speech", text: voices[1].text, durationSeconds: .3 },
      { index: 3, clipId: voices[2].id, kind: "speech", text: voices[2].text },
    ]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    for (const excluded of ["98765", "8888", "audio_0", "audio_1", "asset://", "base64", "pause_after", '"start":', "volume_db", "fade_in"]) {
      expect(body.messages[1].content).not.toContain(excluded);
    }
    const system = body.messages[0].content;
    expect(system).toContain("已完成的事不重演");
    expect(system).toContain("邀请不等于对方已经执行");
    expect(system).toContain("计划或条件不当作当下已发生");
    expect(system).toContain("不让 S1 代替听者完成其动作");
    expect(system).toContain("只写一个主要事件");
    expect(system).toContain("动作起始与可见结果");
    expect(system).toContain("静止反应可以合理成立");
    expect(system).toContain("不强迫每句改变机位");
    expect(system).toContain("不把每镜强制为中近景");
    expect(system).toContain("不延长时长来塞入复杂动作");
    expect(system).toContain("不追加无对白段或镜头");
    expect(system).toContain("不添加其对白或额外正脸");
  });

  it("uses the same complete script context for silent shots and never requires a current WAV", async () => {
    const { input, project, voices } = await fixture();
    const clip = voices[1];
    clip.kind = "silent";
    clip.text = "窗边的水汽缓慢消散。";
    clip.duration = 4.5;
    clip.generation.status = "asset_pending";
    clip.asset = { asset_id: null, uri: null, duration: null };
    const ambientSound = "Soft steady room tone beside the window.";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ ...generated, ambientSound }) } }] }));
    const result = await generateClipStoryboard({ ...input, referenceMode: "new" }, {
      config: { ...config, clipAssetRoot: path.join(root, "nonexistent") }, fetchImpl,
      env: { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "mock-only", ASMR_PLANNER_API_MODEL: "mock-model" },
    });
    const material = materialFrom(fetchImpl);
    expect(material).toMatchObject({ currentIndex: 1, kind: "silent", description: clip.text, durationSeconds: 4.5 });
    expect(material.scriptOrder.map((entry: { text: string }) => entry.text)).toEqual(voices.map(clip => clip.text));
    expect(material).not.toHaveProperty("dialogue");
    expect(material).not.toHaveProperty("audioDurationSeconds");
    expect(result.storyboard).toMatchObject({ kind: "silent", duration: 4.5, ambientSound });
    expect(result.storyboard).not.toHaveProperty("audio");
    expect(result.provider).toBe("api");
    expect(project.videoPlan!.shots).toEqual({});
  });

  it("passes a newly inserted fourth silent beat's neutral request and full cold-entry context without inventing source events", async () => {
    const { project, input, clip, lines } = await coldEntrySilentFixture();
    const before = JSON.stringify(project);
    // This fixed response verifies request transport and preservation, not model comprehension.
    const response = { title: "门前承接", visual: "S1 stands in the open doorway while snow rests along the threshold.",
      action: "S1 steadies the open door and leaves space for the listener to enter.", camera: "Static medium shot framing the doorway.",
      ambientSound: "Soft steady wind outside the sheltered doorway.", asmrSound: asmrSoundFixture };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    const result = await generateClipStoryboard(input, { config: { ...config, clipAssetRoot: path.join(root, "nonexistent") }, fetchImpl,
      env: { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "mock-only", ASMR_PLANNER_API_MODEL: "mock-model" } });
    const material = materialFrom(fetchImpl);
    expect(clip.text).toBe("待设计：根据前后剧情安排自然衔接的无台词画面。");
    expect(material).toMatchObject({ baseScene: project.videoPlan!.sceneDescription, currentIndex: 3, kind: "silent", description: clip.text, durationSeconds: 4 });
    expect(material.scriptOrder.map((entry: { text: string }) => entry.text)).toEqual(lines);
    expect(material.scriptOrder[2].text).toBe("把靴子上的雪抖掉，再进来。");
    expect(material.scriptOrder[4].text).toBe("进屋后再把外套挂起来。");
    expect(JSON.stringify(material)).not.toContain("轻轻放下水杯，镜头停留在桌边。");
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain("不是已发生的剧情事件");
    expect(system).toContain("从完整 scriptOrder、当前镜头位置及前后台词");
    expect(system).toContain("不凭空预设道具、地点或人物行为");
    expect(system).toContain("白噪声或底噪");
    expect(system).toContain("不超过 5 秒");
    expect(result.storyboard).toMatchObject({ ...response, kind: "silent", duration: 4 });
    expect(result.storyboard).not.toHaveProperty("audio");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(project)).toBe(before);
  });

  it("preserves a user's concrete silent-shot intent alongside the cold-entry context", async () => {
    const description = "镜头对准门槛积雪，S1 的手扶住门扇。";
    const { project, input, lines } = await coldEntrySilentFixture(`  ${description}  `);
    const before = JSON.stringify(project);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      title: "门槛积雪", visual: "Snow rests along the threshold beside S1's hand.", action: "S1 holds the door steady.",
      camera: "Static close view of the threshold and hand.", ambientSound: "Soft wind at the doorway.", asmrSound: asmrSoundFixture,
    }) } }] }));
    await generateClipStoryboard(input, { config, fetchImpl,
      env: { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "mock-only", ASMR_PLANNER_API_MODEL: "mock-model" } });
    const material = materialFrom(fetchImpl);
    expect(material.description).toBe(description);
    expect(material.scriptOrder[3].text).toBe(description);
    expect(material.scriptOrder.map((entry: { text: string }) => entry.text)).toEqual(lines);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content).toContain("用户明确填写了具体画面或动作意图时优先遵循");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(project)).toBe(before);
  });

  it("uses storage bounds for generated fields without discarding longer editable previous notes", async () => {
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
    for (const [field, limit] of [["visual", 800], ["action", 600], ["camera", 400]] as const) {
      const tooLong = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, [field]: "x".repeat(limit + 1) }));
      await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl: tooLong })).rejects.toMatchObject({ status: 502 });
      expect(tooLong).toHaveBeenCalledOnce();
    }
  });

  it("accepts complete 337-character visual and 198-character action text without rewriting or retrying", async () => {
    const { input, project, voices } = await fixture(), before = JSON.stringify(project);
    const value = { ...generated, visual: "V".repeat(337), action: "A".repeat(198) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    expect(result.storyboard).toMatchObject(value);
    expect(result.storyboard.sourceFingerprint).toBe(createClipVideoSourceFingerprint(project, voices[1].id));
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(project)).toBe(before);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([["visual", 800], ["action", 600], ["camera", 400]] as const)("accepts the %s storage boundary after trimming only surrounding whitespace", async (field, length) => {
    const { input } = await fixture(), text = "x".repeat(length);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, [field]: ` \n${text} \n` }));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    expect(result.storyboard[field]).toBe(text); expect(fetchImpl).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["title", "visual", "action", "camera"] as const)("keeps the nonempty %s requirement after trimming", async field => {
    const { input } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, [field]: " \n " }));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("provides the whole script without inheriting a previous camera or full prompt when continuity is disabled", async () => {
    const { input, project, voices } = await fixture();
    const previous = attachPrevious(project, voices[0].id);
    previous.camera = "Unique previous camera that must not be inherited.";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env: {}, config, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(materialFrom(fetchImpl).scriptOrder.map((entry: { text: string }) => entry.text)).toEqual(voices.map(clip => clip.text));
    expect(body.messages[1].content).not.toContain(previous.camera);
    expect(body.messages[1].content).not.toContain(createClipH3Prompt(project, voices[0].id));
    expect(JSON.stringify(body.messages)).not.toContain("上一镜连续参考");
    expect(JSON.stringify(body.messages)).not.toContain("retention_analysis:");
    expect(result.storyboard).not.toHaveProperty("previousClipId");
    expect(result.storyboard).not.toHaveProperty("previousPromptFingerprint");
  });

  it("uses the adjacent scene/action end state for legacy continuity and preserves its hand-edit binding", async () => {
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
    expect(body.messages[1].content).not.toContain(previousPrompt);
    expect(body.messages[1].content).toContain(previous.visual);
    expect(body.messages[1].content).toContain(previous.action);
    expect(body.messages[1].content).toContain(previous.camera);
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

  it.each([
    ["title", 121, 120, "标题"], ["visual", 801, 800, "画面"], ["action", 601, 600, "动作"],
    ["camera", 401, 400, "镜头"], ["ambientSound", 601, 600, "环境声"],
  ] as const)("reports the exact rejected %s length without retrying or changing the project", async (field, length, maximum, label) => {
    const { input, project } = await fixture(), before = JSON.stringify(project);
    const value = { ...generated, [field]: "x".repeat(length) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({
      status: 502, message: expect.stringContaining(`${label}（${field}）过长（${length}/${maximum} 字符）`),
    });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(project)).toBe(before);
    const [tag, diagnostic] = vi.mocked(console.error).mock.calls[0];
    expect(tag).toBe("[asmr:clip-storyboard:invalid-output]");
    expect(JSON.parse(String(diagnostic))).toMatchObject({ projectId: project.project_id, clipId: input.clipId,
      provider: "ollama", modelJsonTruncated: false, issues: [{ field, code: "too_big", actualLength: length, maximum }] });
    expect(JSON.parse(JSON.parse(String(diagnostic)).modelJson)).toEqual(value);
  });

  it.each([
    { value: { title: generated.title, visual: generated.visual, action: generated.action }, expected: "镜头（camera）缺失", code: "invalid_type" },
    { value: { ...generated, action: "  " }, expected: "动作（action）不能为空", code: "too_small" },
    { value: { ...generated, action: 123 }, expected: "动作（action）必须是文字，实际为number", code: "invalid_type" },
    { value: { ...generated, duration: 999 }, expected: "包含不支持的字段：duration", code: "unrecognized_keys" },
    { value: [generated], expected: "分镜回复必须是对象，实际为数组", code: "invalid_type" },
  ])("explains malformed direction fields: $expected", async ({ value, expected, code }) => {
    const { input } = await fixture(), fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining(expected) });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const diagnostic = JSON.parse(String(vi.mocked(console.error).mock.calls[0][1]));
    expect(diagnostic.issues[0]).toMatchObject({ code, detail: expected });
  });

  it("bounds failed model JSON diagnostics and redacts credentials, headers and audio payloads", async () => {
    const { input } = await fixture();
    const value = { api_key: "forbidden-key", headers: { Authorization: "forbidden-header" }, audio: { bytes: "forbidden-audio" }, ...generated, visual: "x".repeat(24_000) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const logged = String(vi.mocked(console.error).mock.calls[0][1]), diagnostic = JSON.parse(logged);
    expect(diagnostic.modelJsonTruncated).toBe(true); expect(diagnostic.modelJson.length).toBeLessThanOrEqual(16_000);
    for (const field of ["api_key", "headers", "audio"]) expect(diagnostic.modelJson).toContain(`"${field}":"[redacted]"`);
    for (const secret of ["forbidden-key", "forbidden-header", "forbidden-audio"]) expect(logged).not.toContain(secret);
  });

  it("does not retry or mislabel an upstream network failure as invalid storyboard fields", async () => {
    const { input } = await fixture(), fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(generateClipStoryboard(input, { env: {}, config, fetchImpl })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(console.error).not.toHaveBeenCalled();
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

describe("explicit storyboard reference modes", () => {
  it("accepts both modes and optional legacy includePrevious through the API request parser", async () => {
    const { input } = await fixture();
    const withoutLegacyFlag = { provider: input.provider, project: input.project, clipId: input.clipId, instruction: input.instruction };
    const parsed = await readClipStoryboardRequest(new Request("http://localhost/api/clip-storyboard", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...withoutLegacyFlag, referenceMode: "new" }),
    }));
    expect(parsed.includePrevious).toBe(false);
    expect(parsed.referenceMode).toBe("new");
    expect(ClipStoryboardRequestSchema.parse(withoutLegacyFlag).referenceMode).toBeUndefined();
    expect(ClipStoryboardRequestSchema.safeParse({ ...input, referenceMode: "continuous" }).success).toBe(true);
    expect(ClipStoryboardRequestSchema.safeParse({ ...input, referenceMode: "independent" }).success).toBe(false);
  });

  it.each(["continuous", "new"] as const)("uses whole-script semantics with only current audio for %s, recording actual reference provenance", async (referenceMode) => {
    const { input, project, voices } = await fixture();
    const previous = attachPrevious(project, voices[0].id);
    previous.action = "S1 rests one hand lightly on the counter.";
    previous.camera = "Unique previous camera for continuity only.";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard({ ...input, referenceMode }, { env: {}, config, fetchImpl });
    expect(result.storyboard.referenceMode).toBe(referenceMode);
    expect(result.storyboard.previousClipId).toBe(voices[0].id);
    expect(result.storyboard.previousPromptFingerprint).toBe(getPreviousClipPromptFingerprint(project, voices[1].id));
    expect(result.storyboard.audio).toEqual({ assetId: "audio_1", uri: "asset://clip/audio_1", duration: .3 });
    expect(result.storyboard.sourceFingerprint).toBe(createClipVideoSourceFingerprint(project, voices[1].id));
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    const messages = JSON.stringify(body.messages);
    expect(body.messages[1].content).toContain(previous.visual);
    expect(body.messages[1].content).toContain(previous.action);
    expect(body.messages[1].content).toContain(JSON.stringify(voices[1].text).slice(1, -1));
    expect(materialFrom(fetchImpl).scriptOrder.map((entry: { text: string }) => entry.text)).toEqual(voices.map(clip => clip.text));
    expect(messages).not.toContain("audio_0");
    expect(messages).not.toContain(createClipH3Prompt(project, voices[0].id));
    expect(body.messages[0].content).toContain("不能复制上一镜台词、音频");
    expect(body.messages[0].content).toContain("仅作为语义上下文");
    if (referenceMode === "continuous") {
      expect(body.messages[0].content).toContain("同一具体场景、角色、道具与上一镜动作的结束状态");
      expect(body.messages[0].content).toContain("从上一镜动作自然接续");
      expect(body.messages[0].content).toContain("自然走动、落座、递接道具以及跟随运镜");
      expect(body.messages[0].content).toContain("连续不等于固定景别、机位、人物位置或姿势");
      expect(body.messages[1].content).toContain(previous.camera);
      expect(body.messages[0].content).not.toContain("可以选择新的景别");
    } else {
      expect(body.messages[0].content).toContain("新分镜优先依据 baseScene、当前剧情和当前台词");
      expect(body.messages[0].content).toContain("可以选择新的景别、机位或相关位置");
      expect(body.messages[0].content).toContain("不继承或复制上一镜机位、构图或完整 prompt");
      expect(body.messages[1].content).not.toContain(previous.camera);
    }
    project.videoPlan!.shots[voices[1].id] = result.storyboard;
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(true);
    const prompt = createClipH3Prompt(project, voices[1].id);
    expect(prompt).toContain(`<d>[Chinese]${voices[1].text}</d>`);
    expect(prompt).not.toContain(voices[0].text);
    expect(prompt).toContain("0.3 seconds");
    previous.camera += " A hand edit.";
    expect(isClipVideoStoryboardCurrent(project, voices[1].id)).toBe(false);
  });

  it.each(["missing", "stale", "incomplete", "nonadjacent", "first"])("rejects continuous generation for a %s predecessor before model dispatch", async (kind) => {
    const { input, project, voices } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>();
    if (kind !== "missing") attachPrevious(project, voices[0].id);
    if (kind === "stale") voices[0].text += "修改。";
    if (kind === "incomplete") project.videoPlan!.shots[voices[0].id].camera = "";
    const clipId = kind === "first" ? voices[0].id : kind === "nonadjacent" ? voices[2].id : input.clipId;
    await expect(generateClipStoryboard({ ...input, clipId, referenceMode: "continuous" }, { env: {}, config, fetchImpl }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining(kind === "first" ? "第一条人声" : "连续镜头") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["missing", "stale", "incomplete", "nonadjacent", "first"])("allows new generation with background/current dialogue for a %s predecessor", async (kind) => {
    const { input, project, voices } = await fixture();
    if (kind !== "missing") attachPrevious(project, voices[0].id);
    if (kind === "stale") voices[0].text += "修改。";
    if (kind === "incomplete") project.videoPlan!.shots[voices[0].id].camera = "";
    const clipId = kind === "first" ? voices[0].id : kind === "nonadjacent" ? voices[2].id : input.clipId;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard({ ...input, clipId, includePrevious: true, referenceMode: "new" }, { env: {}, config, fetchImpl });
    expect(result.storyboard.referenceMode).toBe("new");
    expect(result.storyboard).not.toHaveProperty("previousClipId");
    expect(result.storyboard).not.toHaveProperty("previousPromptFingerprint");
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain(project.videoPlan!.sceneDescription);
    expect(body.messages[1].content).not.toContain("上一镜连续参考");
    expect(body.messages[1].content).not.toContain("上一镜次要连续参考");
    expect(body.messages[0].content).toContain("新分镜优先依据");
  });
});
