import { afterEach, describe, expect, it, vi } from "vitest";

import { completePlannerJson } from "./planner-provider";
import { createStoryboardSourceFingerprint } from "./storyboard";
import { generateStoryboard, type StoryboardRequest } from "./storyboard-service";

const draft = {
  title: "深夜书店", scene: "夜晚书店", character: { role: "店员", personality: ["耐心"], speechStyle: ["轻声"] },
  sections: ["one", "two"].map((id) => ({
    id, title: "迎接", text: "进来坐一会儿吧。", emotion: "温柔", style: "轻声", pace: "slow", direction: "自然留白", soundSuggestions: "翻书声",
    pauseAfter: "medium" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const },
  })),
};
const generated = { title: "书店的小灯", shots: [{ id: "shot_1", title: "暖光迎接", sourceSectionIds: ["one", "two"], visual: "A warm lamp lights the quiet bookshelves behind S1.", action: "S1 gently gestures toward a nearby chair while facing the camera.", camera: "Static medium close-up with S1's mouth clearly visible." }] };
const input: StoryboardRequest = { provider: "ollama", draft, instruction: "少一点切镜" };
const apiEnv = { ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "server-secret", ASMR_PLANNER_API_MODEL: "configured-model" };
function reply(value: unknown) { return Response.json({ message: { content: JSON.stringify(value) } }); }

afterEach(() => { vi.useRealTimers(); });

describe("分镜生成服务", () => {
  it("uses the configured model and H3 visual plan, binds provenance locally and preserves dialogue", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const before = JSON.stringify(draft);
    const result = await generateStoryboard(input, { env: {}, fetchImpl });
    expect(result).toEqual({ storyboard: { ...generated, version: 1, sourceFingerprint: createStoryboardSourceFingerprint(draft), promptFormat: "minimax-h3" }, provider: "ollama", model: "qwen3:1.7b" });
    expect(JSON.stringify(draft)).toBe(before);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.options).toMatchObject({ num_predict: 8192, temperature: 0.5, num_gpu: -1 });
    expect(body.messages[0].content).toContain("6 至 12 镜");
    expect(body.messages[0].content).toContain("visual、action、camera 必须用简洁英文");
    expect(body.messages[0].content).toContain("外貌只引用 S1's reference appearance and outfit");
    expect(body.messages[0].content).toContain("性别、年龄、脸部特征、发型、发色或服装");
    expect(body.messages[0].content).toContain("即使文案角色设定含这些描述，也必须以角色参考图为准");
    expect(body.messages[0].content).toContain("非外貌的职业或剧情身份可以保留");
    expect(body.messages[0].content).toContain("每镜只包含一段连续画面");
    expect(body.messages[0].content).toContain("说话时脸和嘴部始终可见");
    expect(body.messages[0].content).toContain("不要决定音频资产、音频 ID、秒数或时长");
    expect(body.messages[0].content).toContain("fully_copy");
    expect(body.messages[0].content).toContain("non_diegetic_music: N/A");
    expect(body.messages[1].content).toContain("少一点切镜");
    expect(body.messages[1].content).toContain(draft.sections[0].text);
    expect(body.messages[1].content).not.toContain("soundSuggestions");
    expect(body.messages[1].content).not.toContain("pace");
    expect(body.format.properties).not.toHaveProperty("sourceFingerprint");
    expect(body.format.properties).not.toHaveProperty("promptFormat");
  });

  it("groups 200 short voice units into a small number of complete ordered shots", async () => {
    const sections = Array.from({ length: 200 }, (_, index) => ({ ...draft.sections[0], id: `unit_${index}`, text: `第${index + 1}句。` }));
    const value = { ...generated, shots: Array.from({ length: 8 }, (_, index) => ({ ...generated.shots[0], id: `shot_${index}`, sourceSectionIds: sections.slice(index * 25, (index + 1) * 25).map((section) => section.id) })) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    const result = await generateStoryboard({ ...input, draft: { ...draft, sections } }, { env: {}, fetchImpl });
    expect(result.storyboard.shots).toHaveLength(8);
    expect(result.storyboard.shots.flatMap((shot) => shot.sourceSectionIds)).toEqual(sections.map((section) => section.id));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("honors the existing CPU-only Ollama configuration without forcing CPU for other local models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => reply(generated));
    await generateStoryboard(input, { env: { ASMR_PLANNER_OLLAMA_NUM_GPU: "0" }, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.options.num_gpu).toBe(0);
    expect(body).not.toHaveProperty("keep_alive");
  });

  it("accepts a full 12,000-character draft with long section IDs beyond the analysis message limit", async () => {
    const sections = Array.from({ length: 200 }, (_, index) => ({ ...draft.sections[0], id: `${String(index).padStart(3, "0")}_${"a".repeat(96)}`, text: "轻".repeat(60) }));
    const longDraft = { ...draft, sections };
    expect(createStoryboardSourceFingerprint(longDraft).length).toBeGreaterThan(24_000);
    const value = { ...generated, shots: [{ ...generated.shots[0], sourceSectionIds: sections.map((section) => section.id) }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
    const result = await generateStoryboard({ ...input, draft: longDraft }, { env: {}, fetchImpl });
    expect(result.storyboard.shots[0].sourceSectionIds).toHaveLength(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses server credentials with a creative budget and retains JSON thinking limits on DeepSeek", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(generated) }, finish_reason: "stop" }] }));
    const result = await generateStoryboard({ ...input, provider: "api" }, { env: apiEnv, fetchImpl });
    expect(result.provider).toBe("api");
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer server-secret" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toMatchObject({ max_tokens: 8192, temperature: 0.5, thinking: { type: "disabled" } });
  });

  it.each([["two", "one"], ["one"], ["one", "unknown"], ["one", "one", "two"]])("rejects source ID omissions, unknown IDs, duplication or reordering: %j", async (...sourceSectionIds) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...generated, shots: [{ ...generated.shots[0], sourceSectionIds }] }));
    await expect(generateStoryboard(input, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("原稿") });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects malformed model output or fabricated assets without modifying a source or retrying silently", async () => {
    for (const value of [{ ...generated, imageUrl: "https://unexpected.example/image.png" }, { ...generated, shots: [{ ...generated.shots[0], visual: "" }] }, { shots: [] }]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(value));
      await expect(generateStoryboard(input, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502 });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: { content: "not json" } }));
    await expect(generateStoryboard(input, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("分镜") });
  });

  it("rejects invalid drafts and unconfigured services before calling the model", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateStoryboard({ ...input, draft: { ...draft, sections: [] } }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 400 });
    await expect(generateStoryboard({ ...input, provider: "api" }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("分镜模型") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors cancellation before dispatch and while waiting for an unresponsive upstream", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = generateStoryboard(input, { env: {}, fetchImpl, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ status: 499, message: expect.stringContaining("分镜") });
    controller.abort();
    await assertion;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchImpl.mockClear();
    await expect(generateStoryboard(input, { env: {}, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the configured generation timeout instead of the 60-second analysis default", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = generateStoryboard(input, { env: { ASMR_PLANNER_TIMEOUT_SECONDS: "120" }, fetchImpl });
    let settled = false;
    void pending.catch(() => { settled = true; });
    const assertion = expect(pending).rejects.toMatchObject({ status: 504, message: expect.stringContaining("分镜") });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("keeps the existing text-analysis defaults and message bound", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply({ okay: true }));
    await completePlannerJson({ provider: "ollama", messages: [{ role: "user", content: "分析" }], jsonSchema: {} }, { env: {}, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).options).toMatchObject({ num_predict: 2048, temperature: 0.2, num_gpu: 0 });
    await expect(completePlannerJson({ provider: "ollama", messages: [{ role: "user", content: "x".repeat(24_001) }], jsonSchema: {} }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
