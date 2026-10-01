import { afterEach, describe, expect, it, vi } from "vitest";

import { generateSceneDescription, type SceneDescriptionRequest } from "./scene-description-service";
import { createStoryboardSourceFingerprint } from "./storyboard";

const draft = {
  title: "深夜厨房", scene: "居家厨房", character: { role: "短发年轻女主人", personality: ["体贴"], speechStyle: ["轻声"] },
  sections: [{ id: "one", title: "迎接", text: "  回来啦，\n先坐一会儿吧。 ", emotion: "温柔", style: "轻声", pace: "slow", direction: "自然留白", soundSuggestions: "炉灶声", pauseAfter: "medium" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const } }],
};
const input: SceneDescriptionRequest = { provider: "ollama", draft, instruction: "日常的暖光厨房" };
const sceneDescription = "深夜的居家厨房，刚回来的客人坐下歇息，主人用一顿热夜宵陪他慢慢放松。";
function reply(value: unknown) { return Response.json({ message: { content: JSON.stringify(value) } }); }

afterEach(() => { vi.useRealTimers(); });

describe("基础场景描述生成", () => {
  it("requests a short Chinese story background for people with locally attached provenance and no script mutation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ sceneDescription }));
    const before = JSON.stringify(draft);
    const result = await generateSceneDescription(input, { env: {}, fetchImpl });
    expect(result).toEqual({ sceneDescription, sourceFingerprint: createStoryboardSourceFingerprint(draft), provider: "ollama", model: "qwen3:1.7b" });
    expect(JSON.stringify(draft)).toBe(before);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.options).toMatchObject({ num_predict: 4096, temperature: .5, num_gpu: -1 });
    expect(sceneDescription.length).toBeLessThanOrEqual(160);
    expect(body.messages[0].content).toContain("给人阅读的简短中文剧情背景");
    expect(body.messages[0].content).toContain("1–2 句、最多 160 字符");
    expect(body.messages[0].content).toContain("地点、时间或天气及主要剧情氛围");
    expect(body.messages[0].content).toContain("不是要复制到每段提示词里的固定画面");
    expect(body.messages[0].content).toContain("不列出所有房间、道具、光照或材质");
    expect(body.messages[0].content).toContain("不写镜头指令");
    expect(body.messages[0].content).toContain("性别、年龄、脸部特征、发型、发色、身材或服装");
    expect(body.messages[0].content).toContain("即使原稿角色设定包含这些词也不能写入场景描述");
    expect(body.messages[1].content).toContain(JSON.stringify(draft.sections[0].text).slice(1, -1));
    expect(body.messages[1].content).toContain(input.instruction);
    expect(body.messages[1].content).not.toContain("soundSuggestions");
    expect(body.format.properties).toHaveProperty("sceneDescription");
    expect(body.format.properties.sceneDescription.maxLength).toBe(160);
    expect(body.format.properties).not.toHaveProperty("sourceFingerprint");
  });

  it("accepts 160-character generated backgrounds and rejects 161 before returning usable scene metadata", async () => {
    const accepted = "雪".repeat(160);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ sceneDescription: accepted }))
      .mockResolvedValueOnce(reply({ sceneDescription: `${accepted}夜` }));
    expect(await generateSceneDescription(input, { env: {}, fetchImpl })).toMatchObject({ sceneDescription: accepted });
    await expect(generateSceneDescription(input, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("场景描述") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not accept invented shots, dialogue or model-supplied provenance and does not retry automatically", async () => {
    for (const value of [{ sceneDescription: "" }, { sceneDescription: "x".repeat(4001) }, { sceneDescription, shots: [] }, { sceneDescription, sourceFingerprint: "forged" }, { sceneDescription, dialogue: "改写台词" }]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
      await expect(generateSceneDescription(input, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502 });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("rejects incomplete drafts and unconfigured providers before dispatch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateSceneDescription({ ...input, draft: { ...draft, sections: [] } }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 400 });
    await expect(generateSceneDescription({ ...input, provider: "api" }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("模型") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses configured external credentials without returning them or adding infrastructure to source metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ sceneDescription }) }, finish_reason: "stop" }] }));
    const result = await generateSceneDescription({ ...input, provider: "api" }, { env: { ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "server-secret", ASMR_PLANNER_API_MODEL: "configured-model" }, fetchImpl });
    expect(result).toMatchObject({ provider: "api", model: "configured-model" });
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer server-secret" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toMatchObject({ max_tokens: 4096, thinking: { type: "disabled" } });
  });

  it("cancels an in-flight or already cancelled request without accepting late source changes", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = generateSceneDescription(input, { env: {}, fetchImpl, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ status: 499 });
    controller.abort();
    await assertion;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchImpl.mockClear();
    await expect(generateSceneDescription(input, { env: {}, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors the configured creative timeout and returns a scene-specific safe error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = generateSceneDescription(input, { env: { ASMR_PLANNER_TIMEOUT_SECONDS: "120" }, fetchImpl });
    let settled = false;
    void pending.catch(() => { settled = true; });
    const assertion = expect(pending).rejects.toMatchObject({ status: 504, message: expect.stringContaining("场景描述") });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
