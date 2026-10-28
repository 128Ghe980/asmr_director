import { describe, expect, it, vi } from "vitest";

import { generateClipStoryboard } from "./clip-storyboard-service";
import { renderConciseH3Prompt } from "./h3-prompt";
import { demoProject } from "./mock-project";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { AsmrProjectSchema, type VoiceClip } from "./schema";
import { ClipVideoStoryboardSchema, createClipH3Prompt, createClipVideoSourceFingerprint,
  getPreviousClipPromptFingerprint, getUsableClipH3Prompts, type ClipVideoStoryboard } from "./video-plan";

const ambientSound = "Soft steady rain outside the window with a faint room tone.";
const generated = { title: "窗边雨声", visual: "Rain trails down the cabin window.", action: "A curtain moves gently beside the window.", camera: "Static close-up.", ambientSound, asmrSound: asmrSoundFixture };
const env = { ASMR_PLANNER_API_URL: "https://api.deepseek.example/v1", ASMR_PLANNER_API_KEY: "test-only-key", ASMR_PLANNER_API_MODEL: "test-model" };
function reply(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }

function fixture() {
  const project = structuredClone(demoProject);
  const voices = project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : []).slice(0, 3);
  for (const track of project.timeline.tracks) track.clips = track.track_type === "voice" ? voices : [];
  for (const [index, clip] of voices.entries()) {
    clip.start = index * 10;
    clip.text = ["外面还下着雨。", "镜头停留在有雨水的窗上。", "来火边坐吧。"] [index];
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `missing_${index}`, uri: `asset://clip/missing_${index}`, duration: 2 };
  }
  const clip = voices[1];
  clip.kind = "silent"; clip.duration = 5;
  clip.generation.status = "asset_pending";
  clip.asset = { asset_id: null, uri: null, duration: null };
  project.videoPlan = { version: 1, sceneDescription: "雨夜木屋，窗旁就是壁炉。", shots: {} };
  const shot: ClipVideoStoryboard = { ...generated, version: 1, promptFormat: "minimax-h3", kind: "silent", duration: 5,
    clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id) };
  return { project, voices, clip, shot, input: { provider: "ollama" as const, project, clipId: clip.id, includePrevious: false, referenceMode: "new" as const, instruction: "" } };
}

describe("无对白环境镜头", () => {
  it("keeps old silent metadata and durations intact but requires a new sound description before exporting", () => {
    const { project, clip, shot } = fixture();
    delete shot.ambientSound;
    project.videoPlan!.shots[clip.id] = shot;
    expect(ClipVideoStoryboardSchema.parse(shot)).toEqual(shot);
    expect(AsmrProjectSchema.parse(project).videoPlan!.shots[clip.id]).not.toHaveProperty("ambientSound");
    expect(() => createClipH3Prompt(project, clip.id)).toThrow("重新生成");
    expect(getUsableClipH3Prompts(project).has(clip.id)).toBe(false);
    clip.duration = 7; shot.duration = 7; shot.sourceFingerprint = createClipVideoSourceFingerprint(project, clip.id);
    expect(AsmrProjectSchema.parse(project).videoPlan!.shots[clip.id].duration).toBe(7);
    expect(() => createClipH3Prompt(project, clip.id)).toThrow("5 秒");
    expect(clip.duration).toBe(7);
  });

  it("renders just the natural background sound without speech reference, lip directions or a required visible person", () => {
    const prompt = renderConciseH3Prompt({ ...generated, dialogue: "", silent: true, durationSeconds: 5 });
    expect(prompt).toContain(ambientSound);
    expect(prompt).toContain("No dialogue, speech, voice-over or music");
    expect(prompt).toContain("S1 may be off-screen");
    for (const unwanted of ["<Audio 1>", "fully_copy", "lip", "mouth", "<d>", "No audio", "Silent shot"]) expect(prompt).not.toContain(unwanted);
    const { project, clip, shot } = fixture(); project.videoPlan!.shots[clip.id] = shot;
    expect(createClipH3Prompt(project, clip.id)).toBe(prompt);
    expect(getUsableClipH3Prompts(project).get(clip.id)).toBe(prompt);
    const before = getPreviousClipPromptFingerprint(project, fixture().voices[2].id);
    shot.ambientSound = "A faint steady fireplace crackle.";
    expect(getPreviousClipPromptFingerprint(project, fixture().voices[2].id)).not.toBe(before);
    expect(createClipH3Prompt(project, clip.id)).toContain(shot.ambientSound);
  });

  it("uses the configured API and both adjacent text contexts without waiting for their storyboards or reading WAVs", async () => {
    const { input, project, voices, clip } = fixture();
    const before = structuredClone(project);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const result = await generateClipStoryboard(input, { env, fetchImpl,
      config: { runtimeRoot: "missing", clipAssetRoot: "missing", mixAssetRoot: "missing", gptSovitsBaseUrl: "unused", voicePackPath: "unused" } });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.deepseek.example/v1/chat/completions");
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[1].content).toContain(voices[0].text);
    expect(body.messages[1].content).toContain(voices[2].text);
    expect(body.messages[1].content).toContain('"durationSeconds":5');
    expect(body.messages[0].content).toContain("ambientSound");
    expect(body.messages[0].content).toContain("白噪声");
    expect(body.messages[0].content).toContain("前后镜头");
    expect(body.messages[0].content).not.toContain("无音轨");
    expect(JSON.stringify(body.messages)).not.toContain("asset://");
    expect(JSON.stringify(body.messages)).not.toContain("<Audio 1>");
    expect(result.provider).toBe("api");
    expect(result.storyboard).toMatchObject({ kind: "silent", duration: 5, ambientSound });
    expect(result.storyboard).not.toHaveProperty("audio");
    expect(result.storyboard).not.toHaveProperty("previousClipId");
    expect(result.storyboard.sourceFingerprint).toBe(createClipVideoSourceFingerprint(project, clip.id));
    expect(project).toEqual(before);
  });

  it.each([undefined, "", "   "])("rejects a new silent storyboard without a nonempty ambientSound (%s)", async ambientSound => {
    const { input } = fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, ambientSound }));
    await expect(generateClipStoryboard(input, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses adjacent existing visual notes as optional context without copying their speech or audio rules", async () => {
    const { input, project, voices } = fixture();
    const next = voices[2];
    project.videoPlan!.shots[next.id] = { ...generated, version: 1, promptFormat: "minimax-h3", clipId: next.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, next.id), audio: { assetId: next.asset.asset_id!, uri: next.asset.uri!, duration: 2 },
      visual: "The fireplace glows beside S1." };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    await generateClipStoryboard(input, { env, fetchImpl });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[1].content).toContain("The fireplace glows beside S1.");
    expect(body.messages[1].content).not.toContain("asset://");
    expect(body.messages[1].content).not.toContain("fully_copy");
  });

  it("rejects a silent duration above five seconds before any model call without migrating it", async () => {
    const { input, clip } = fixture(); clip.duration = 5.01;
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateClipStoryboard(input, { env, fetchImpl })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("5 秒") });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(clip.duration).toBe(5.01);
  });
});
