import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPlannerProviderCatalog,
  PlannerError,
  runPlanner,
} from "./planner-provider";
import { normalizePlannerSemanticDraft } from "./planner-semantic";
import { referenceTemplateFixture } from "./reference-template-test-fixture";

const brief = {
  theme: "深夜书店",
  durationSeconds: 300,
  language: "zh" as const,
  role: "书店店员",
  style: "温柔自然",
  notes: "多一点翻书声",
};

const section = {
  id: "section_1",
  title: "迎接客人",
  text: "进来坐一会儿吧。窗边的位置还空着，我给你留了一盏小灯。",
  emotion: "温柔",
  style: "自然轻声",
  pace: "slow",
  direction: "轻声迎接，句尾自然留白。",
  soundSuggestions: "轻轻翻书",
  pauseAfter: "medium" as const,
  position: { pan: 0, distance: "near" as const, movement: "static" as const },
};

const draft = {
  title: "深夜书店的小灯",
  scene: "深夜仍亮着灯的书店",
  character: {
    role: "书店店员",
    personality: ["耐心"],
    speechStyle: ["自然轻声"],
  },
  sections: [section, { ...section, id: "section_2", title: "安静收尾" }],
};

function ollamaReply(value: unknown) {
  return Response.json({ message: { content: JSON.stringify(value) }, done: true });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Planner provider", () => {
  it.each([false, true])("follows listener POV only when not locked by a character-framing template (template=%s)", async withTemplate => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(draft));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, storyboardStyle: "listener_pov", ...(withTemplate ? { referenceTemplate: referenceTemplateFixture } : {}) } }, { env: {}, fetchImpl });
    const messages = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages;
    if (withTemplate) {
      expect(messages[0].content).not.toContain("镜头就是听者的眼睛");
      expect(messages[1].content).toContain('"storyboardStyle":"character_framing"');
      expect(messages[1].content).not.toContain('"storyboardStyle":"listener_pov"');
    }
    else {
      expect(messages[0].content).toContain("镜头就是听者的眼睛");
      expect(messages[0].content).toContain("听者的站位、朝向、视线目标和移动后的落点");
      expect(messages[0].content).toContain("无对白 ASMR 触发音意图");
      expect(messages[1].content).toContain("每个 unit 必须单独填写 direction");
    }
  });

  it.each([false, true])("generates from the current robot-care brief without injecting a fixed domestic opening (template=%s)", async withTemplate => {
    const currentBrief = { ...brief, theme: "漫长寒潮中的智能小屋，机器人管家守候归来的旅人。", role: "机器人管家",
      notes: "机器人没有人类的睡眠需求；环境保持寒冷，室内有可靠供暖。", ...(withTemplate ? { referenceTemplate: referenceTemplateFixture } : {}) };
    const freshDraft = { ...draft, title: "智能小屋的寒潮夜", scene: "漫长寒潮中的智能小屋。",
      character: { ...draft.character, role: "机器人管家" },
      sections: [{ ...section, text: "入口的暖风已调好了。你可以先在这里缓一缓。" }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(freshDraft));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: currentBrief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string), prompt = request.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain(currentBrief.theme);
    expect(prompt).toContain(currentBrief.role);
    expect(prompt).toContain(currentBrief.notes);
    for (const phrase of ["回来啦", "我还没睡", "就猜你快到了", "换鞋", "挂外套", "先看这一件", "这一款的颜色很柔和", "我先把它放回这里", "先把这本放回去"]) expect(prompt).not.toContain(phrase);
    expect(prompt).not.toContain(section.text);
    expect(prompt).toContain("开场与具体细节必须来自本次主题、角色和关系");
    expect("draft" in result && result.draft.sections[0].text).toBe(freshDraft.sections[0].text);
  });
  it("makes each template unit own its complete prop transition rather than relying on overwritten group directions", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(draft));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, referenceTemplate: referenceTemplateFixture } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const messages = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages;
    expect(messages[0].content).toContain("units.direction 会完整覆盖 group.direction，不会自动拼接");
    expect(messages[0].content).toContain("本 unit 的起始必须承接上一 unit 的结束，包括跨 group");
    expect(messages[0].content).toContain("取起A必须写在①的unit.direction，不能只写在group.direction");
    expect(messages[0].content).toContain("结束：A留在左侧，双手空");
    expect(messages[0].content).toContain("不要把食指竖在唇前");
    expect(messages[0].content).toContain("持物期间不要用手指比价或比数字");
    expect(messages[1].content).toContain("一次性动作全部写在各自的 unit.direction");
    expect(messages[1].content).not.toContain("groups 只用来共享导演与声音属性");
  });
  it("expands compact semantic generation in one call while inheriting shared direction", async () => {
    const { id, title, emotion, style, pace, direction, soundSuggestions, position } = section;
    const units = Array.from({ length: 70 }, (_, index) => ({ text: `第${index + 1}句，你可以慢慢看，我在这里陪着。`, pauseAfter: "medium" }));
    const compact = { title: draft.title, scene: draft.scene, character: draft.character, groups: [{ id, title, emotion, style, pace, direction, soundSuggestions, position, units }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(compact));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 600 } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    if (!("draft" in result)) throw new Error("Expected draft");
    expect(result.draft.segmentation).toBe("semantic");
    expect(result.draft.sections).toHaveLength(70);
    expect(result.draft.sections.map((item) => item.text)).toEqual(units.map((unit) => unit.text));
    expect(result.draft.sections.every((item) => item.direction === direction && item.pauseAfterSeconds === 0.35)).toBe(true);
  });
  it.each(["compact", "flat"] as const)("preserves valid %s API units with several sentence endings beyond brevity targets", async representation => {
    const texts = ["你累了吧？先歇会儿，饭马上就好。", "先慢慢呼吸。我就在这里。".repeat(12)];
    expect(texts[1].length).toBeGreaterThan(100);
    expect(texts[1].length).toBeLessThanOrEqual(500);
    const modelSections = texts.map((text, index) => ({ ...section, id: `source_${index + 1}`, text, pauseAfter: index ? "long" as const : "short" as const }));
    const { id, title, emotion, style, pace, direction, soundSuggestions, position } = section;
    const compact = { title: draft.title, scene: draft.scene, character: draft.character, groups: [{ id, title, emotion, style, pace, direction, soundSuggestions, position,
      units: modelSections.map(({ text, pauseAfter }) => ({ text, pauseAfter })) }] };
    const modelReply = representation === "compact" ? compact : { ...draft, sections: modelSections };
    const before = structuredClone(modelReply);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(modelReply) }, finish_reason: "stop" }] }));
    const result = await runPlanner({ action: "generate", provider: "api", brief }, { env: {
      ASMR_PLANNER_API_URL: "https://provider.example/v1", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "fixture-model",
    }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    if (!("draft" in result)) throw new Error("Expected draft");
    expect(result.draft.sections.map(item => item.text)).toEqual(texts);
    expect(result.draft.sections.map(item => item.id)).toEqual(representation === "compact" ? ["unit_001", "unit_002"] : ["source_1", "source_2"]);
    expect(result.draft.sections.map(item => item.pauseAfterSeconds)).toEqual([.18, .6]);
    expect(result.draft.sections.every(item => item.direction === section.direction)).toBe(true);
    expect(modelReply).toEqual(before);
    const request = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(request.messages[1].content).toContain("一个单元可以包含多个句号，不按每个句号机械拆分");
  });
  it("reserves the creative Planner's complete JSON budget by explicitly disabling official DeepSeek thinking", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }] }));
    const result = await runPlanner({ action: "generate", provider: "api", brief }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl });
    expect(result).toMatchObject({ draft, provider: "api" });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.max_tokens).toBe(12288);
    expect(body.thinking).toEqual({ type: "disabled" });
  });
  it.each([[60, 4096], [180, 8192], [300, 12288], [600, 16384]])("retains the requested %i-second creative brief with a bounded %i-token official DeepSeek budget", async (durationSeconds, maxTokens) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }] }));
    const result = await runPlanner({ action: "generate", provider: "api", brief: { ...brief, durationSeconds } }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com/v1", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl });
    expect(result).toMatchObject({ draft: normalizePlannerSemanticDraft(draft), provider: "api" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ max_tokens: maxTokens, thinking: { type: "disabled" }, response_format: { type: "json_object" } });
    expect(body.messages[1].content).toContain(`目标约 ${durationSeconds} 秒`);
    expect(body.messages[1].content).toContain("共用一个 group");
  });
  it("preserves the user's three-minute apocalypse birthday brief without reducing duration or replacing the topic", async () => {
    const theme = "深夜，在外面收集了一天资源回家，并带回来一个精致的机械表给家里的ai机器人作为生日礼物。末世题材";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }] }));
    await runPlanner({ action: "generate", provider: "api", brief: { ...brief, theme, durationSeconds: 180 } }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ max_tokens: 8192, thinking: { type: "disabled" } });
    expect(body.messages[1].content).toContain(theme); expect(body.messages[1].content).toContain('"durationSeconds":180');
    expect(body.messages[1].content).not.toContain("缩短");
  });
  it("keeps the official DeepSeek rewrite budget and range contract independent of overall brief duration", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ text: "先坐吧。" }) }, finish_reason: "stop" }] }));
    await runPlanner({ action: "rewrite", provider: "api", brief: { ...brief, durationSeconds: 600 }, draft, sectionId: section.id, instruction: "简短一点", range: { start: 0, end: 3 } }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toMatchObject({ max_tokens: 8192, thinking: { type: "disabled" } });
  });
  it("lists local defaults and never exposes secrets or endpoint URLs", () => {
    const catalog = getPlannerProviderCatalog({
      ASMR_PLANNER_API_URL: "https://provider.example/v1",
      ASMR_PLANNER_API_KEY: "private-key",
      ASMR_PLANNER_API_MODEL: "configured-model",
      ASMR_PLANNER_DEFAULT_PROVIDER: "api",
    });
    expect(catalog).toEqual({
      providers: [
        { id: "ollama", label: "本地 Ollama", model: "qwen3:1.7b", configured: true },
        { id: "api", label: "外部 API", model: "configured-model", configured: true },
      ],
      defaultProvider: "api",
    });
    expect(JSON.stringify(catalog)).not.toContain("private-key");
    expect(JSON.stringify(catalog)).not.toContain("provider.example");
    expect(getPlannerProviderCatalog({}).providers[1].configured).toBe(false);
  });

  it("generates validated drafts with the Ollama schema and bounded output", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(draft));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });

    expect(result).toEqual({ draft: normalizePlannerSemanticDraft(draft), provider: "ollama", model: "qwen3:1.7b" });
    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body).toMatchObject({ stream: false, think: false, format: { type: "object" }, options: { num_predict: 8192 } });
    expect(body.messages[0].content).toContain("导演");
    expect(body.messages[1].content).toContain("深夜书店");
    expect(body.format.properties.groups.items.properties.units).toBeTruthy();
    expect(body.messages[1].content).toContain("语义短单元");
    expect(body.messages[1].content).not.toContain("4 至 6 段");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("supports explicit CPU and bounded context configuration without automatic fallback", async () => {
    const env = { ASMR_PLANNER_OLLAMA_NUM_GPU: "0", ASMR_PLANNER_OLLAMA_CONTEXT: "4096" };
    expect(getPlannerProviderCatalog(env).providers[0].label).toContain("CPU");
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => ollamaReply(draft));
    await runPlanner({ action: "generate", provider: "ollama", brief }, { env, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).options).toMatchObject({ num_gpu: 0, num_ctx: 4096 });
    await runPlanner({ action: "generate", provider: "ollama", brief }, {
      env: { ASMR_PLANNER_OLLAMA_CONTEXT: "999999", ASMR_PLANNER_OLLAMA_NUM_GPU: "invalid" }, fetchImpl,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string).options).toMatchObject({ num_gpu: -1, num_ctx: 32768 });
  });

  it("uses the configured compatible API with server-only credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }],
    }));
    const result = await runPlanner({ action: "generate", provider: "api", brief }, {
      env: {
        ASMR_PLANNER_API_URL: "https://provider.example/v1/",
        ASMR_PLANNER_API_KEY: "private-key",
        ASMR_PLANNER_API_MODEL: "configured-model",
      },
      fetchImpl,
    });
    expect(result.provider).toBe("api");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-key");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: "configured-model", max_tokens: 8192, response_format: { type: "json_object" }, stream: false,
    });
    expect(JSON.parse(init?.body as string)).not.toHaveProperty("thinking");
    expect(JSON.stringify(result)).not.toContain("private-key");
  });

  it("rewrites only one section, preserving its identity and the original draft", async () => {
    const original = structuredClone(draft);
    const replacement = { ...section, id: "model-changed-id", text: "先坐下吧，书可以慢慢挑。" };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply(replacement));
    const result = await runPlanner({
      action: "rewrite", provider: "ollama", brief, draft, sectionId: section.id, instruction: "更日常一点",
    }, { env: {}, fetchImpl });
    expect(result).toEqual({ section: { ...replacement, id: section.id }, provider: "ollama", model: "qwen3:1.7b" });
    expect(draft).toEqual(original);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toContain("section_1");
    expect(body.messages[1].content).toContain("更日常一点");
  });

  it("rejects a rewrite target that is not in the draft before calling a provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(runPlanner({
      action: "rewrite", provider: "ollama", brief, draft, sectionId: "missing", instruction: "更日常",
    }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rewrites only the selected range and preserves exact surrounding text and direction metadata", async () => {
    const original = { ...section, text: "  进来坐一会儿吧。\n窗边的位置还空着。  " };
    const selectedDraft = { ...draft, sections: [original] };
    const range = { start: 2, end: 10 };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ollamaReply({ text: "先坐吧。" }));
    const result = await runPlanner({ action: "rewrite", provider: "ollama", brief, draft: selectedDraft, sectionId: original.id, instruction: "简短一点", range }, { env: {}, fetchImpl });
    expect(result).toMatchObject({ section: { ...original, text: original.text.slice(0, range.start) + "先坐吧。" + original.text.slice(range.end) }, replacement: "先坐吧。" });
    const prompt = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).messages[1].content;
    expect(prompt).toContain("选中文字");
    expect(prompt).toContain("仅供参考");
    expect(selectedDraft.sections[0]).toEqual(original);
  });

  it.each([{ start: -1, end: 3 }, { start: 2, end: 2 }, { start: 0, end: 9999 }])("rejects invalid selected ranges before invoking the provider: %j", async (range) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(runPlanner({ action: "rewrite", provider: "ollama", brief, draft, sectionId: section.id, instruction: "改写", range }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses whole-section responses for a range rewrite", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => ollamaReply(section));
    await expect(runPlanner({ action: "rewrite", provider: "ollama", brief, draft, sectionId: section.id, instruction: "改写", range: { start: 0, end: 3 } }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("repairs malformed output once with the original brief and schema still present", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ollamaReply({ title: "不完整" }))
      .mockResolvedValueOnce(ollamaReply(draft));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    expect(result).toMatchObject({ draft });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const repaired = JSON.parse(fetchImpl.mock.calls[1][1]?.body as string);
    expect(repaired.messages[1].content).toContain("深夜书店");
    expect(repaired.messages.at(-1).content).toContain("修复");
  });

  it("rejects repeated invalid output without infinite retry or upstream details", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => ollamaReply({ private: "secret-upstream-value" }));
    await expect(runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("结构") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports missing configuration and offline Ollama without a fabricated draft", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(runPlanner({ action: "generate", provider: "api", brief }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("配置") });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockRejectedValue(new Error("connect ECONNREFUSED; sensitive upstream details"));
    await expect(runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("Ollama") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("hides upstream authentication errors and refuses redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-key upstream trace", { status: 401 }));
    const error = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(PlannerError);
    expect((error as Error).message).not.toContain("private-key");
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports an Ollama load failure without returning its internal error body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("CUDA allocation failed in private/runtime/path", { status: 500 }));
    const error = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 503, message: expect.stringContaining("内存") });
    expect((error as Error).message).not.toContain("private/runtime/path");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("limits provider responses while reading even without Content-Length", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(256 * 1024 + 1)));
    await expect(runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("过长") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a whole-draft rewrite response and model-supplied asset fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => ollamaReply(draft))
      .mockImplementationOnce(async () => ollamaReply({ ...section, asset: { uri: "https://unexpected.example/voice.wav" } }));
    await expect(runPlanner({
      action: "rewrite", provider: "ollama", brief, draft, sectionId: section.id, instruction: "更自然",
    }, { env: {}, fetchImpl })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("结构") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects truncated completions instead of adopting partial content", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: { content: JSON.stringify(draft) }, done_reason: "length",
    }));
    await expect(runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("长度上限") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects official DeepSeek length termination even when content looks valid, without adopting partial output or retrying automatically", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify(draft), reasoning_content: "private model reasoning" }, finish_reason: "length" }],
      usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 7900 } },
    }));
    const error = await runPlanner({ action: "generate", provider: "api", brief: { ...brief, durationSeconds: 180 } }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl }).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 502, message: expect.stringContaining("长度上限") });
    expect((error as Error).message).not.toContain("缩短"); expect((error as Error).message).not.toContain("private model reasoning");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("retains the bounded official DeepSeek budget and thinking setting through the single structural repair", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"title":"incomplete"}' }, finish_reason: "stop" }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }] }));
    await runPlanner({ action: "generate", provider: "api", brief: { ...brief, durationSeconds: 600 } }, { env: {
      ASMR_PLANNER_API_URL: "https://api.deepseek.com", ASMR_PLANNER_API_KEY: "fixture-key", ASMR_PLANNER_API_MODEL: "deepseek-v4-pro",
    }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(call => JSON.parse(call[1]?.body as string))).toEqual([
      expect.objectContaining({ max_tokens: 16384, thinking: { type: "disabled" } }),
      expect.objectContaining({ max_tokens: 16384, thinking: { type: "disabled" } }),
    ]);
  });

  it("cancels a response stream when the user aborts during body reading", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"message":')); },
      cancel: cancelled,
    }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const pending = runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ status: 499 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assertion;
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("honors cancellation before dispatch and while waiting for the provider", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 499, message: expect.stringContaining("取消") });
    const alreadyCancelled = vi.fn<typeof fetch>();
    await expect(runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl: alreadyCancelled, signal: controller.signal }))
      .rejects.toMatchObject({ status: 499 });
    expect(alreadyCancelled).not.toHaveBeenCalled();
  });

  it("bounds the whole operation with a timeout, including a hanging fetch", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const result = runPlanner({ action: "generate", provider: "ollama", brief }, {
      env: { ASMR_PLANNER_TIMEOUT_SECONDS: "10" }, fetchImpl,
    });
    const assertion = expect(result).rejects.toMatchObject({ status: 504, message: expect.stringContaining("超时") });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
