import { describe, expect, it, vi } from "vitest";
import { runPlanner } from "./planner-provider";
import { getPlannerDurationSummary, getPlannerPerformanceBudget, PlannerBriefSchema, type PlannerDraft } from "./planner";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { CAMERA_PANTOMIME_GUIDANCE } from "./camera-pantomime";

const template = { ...referenceTemplateFixture, id: "intimate-interaction-theatre", version: 3,
  storyboardStyle: "listener_pov" as const, visualPerformance: "pantomime" as const };
const brief = PlannerBriefSchema.parse({ theme: "全程无台词，替听者整理领子", durationSeconds: 60, referenceTemplate: template });
const section = { id: "gesture", title: "模拟整理", kind: "silent" as const, purpose: "asmr" as const,
  text: "角色空手模拟整理领子的动作，配柔和拟音。", durationSeconds: 60,
  direction: "起始：S1双手在胸前空着；动作：在镜头下方空气中轻捏后向两侧舒展；结束：空手自然停住。",
  soundSuggestions: "配合空手手势的后配柔和布料摩擦拟音，动作停顿时安静。",
  emotion: "自然", style: "轻声", pace: "缓慢", pauseAfter: "short" as const,
  position: { pan: 0, distance: "near" as const, movement: "static" as const } };
const draft: PlannerDraft = { performanceVersion: 1, title: "近距离模拟整理", scene: "安静房间，S1完整头肩面对镜头，双手空着。",
  character: { role: "熟人", personality: ["自然"], speechStyle: ["轻声"] }, sections: [section] };
const generatedDraft: PlannerDraft = { ...draft, sections: Array.from({ length: 6 }, (_, index) => ({ ...section, id: `gesture_${index}`, durationSeconds: 10 })) };
function reply(value: unknown) { return Response.json({ message: { content: JSON.stringify(value) } }); }

describe("pantomime planner contract", () => {
  it("changes visual enactment and foley instructions without changing automatic time allocation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generatedDraft));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    if (!("draft" in result)) throw new Error("Expected draft");
    expect(getPlannerDurationSummary(result.draft)).toEqual({ speechSeconds: 0, nonSpeechSeconds: 60, totalSeconds: 60 });
    expect(result.draft.sections[0]).toMatchObject({ kind: "silent", purpose: "asmr", durationSeconds: 10,
      text: section.text, direction: section.direction, soundSuggestions: section.soundSuggestions });
    expect(getPlannerPerformanceBudget(brief)).toEqual(getPlannerPerformanceBudget({ ...brief,
      referenceTemplate: { ...template, visualPerformance: undefined } }));
    const messages = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages;
    expect(messages[0].content).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(messages[0].content).toContain("纯凝视、表情和等待只用安静环境");
    expect(messages[0].content).toContain("scene、direction和无台词text都不安排呼气、吹气、叹气或呼吸演出");
    expect(messages[0].content).not.toContain("任务让听者看材料或路径时允许S1画外说话");
    expect(messages[0].content).not.toContain("接物、归位、进入新位置、落座等关键状态转换");
    expect(messages[1].content).toContain('"visualPerformance":"pantomime"');
  });

  it.each(["legacy-near", "prop-template", "no-template"])("does not silently reinterpret %s", async mode => {
    const legacy = { ...template, version: 2, visualPerformance: undefined };
    const referenceTemplate = mode === "legacy-near" ? legacy : mode === "prop-template" ? referenceTemplateFixture : undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(generatedDraft));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, referenceTemplate } }, { env: {}, fetchImpl });
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).not.toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("接物、归位、进入新位置、落座等关键状态转换");
    expect(system).toContain("无实物表演、凝视和等待允许空字符串或安静环境");
    if (mode === "legacy-near") expect(system).toContain("任务让听者看材料或路径时允许S1画外说话");
  });

  it("rewrites the action and foley while retaining the selected silent segment's duration and identity", async () => {
    const original = structuredClone(draft);
    const replacement = { ...section, id: "model-id", durationSeconds: 5, purpose: "interaction" as const,
      direction: "起始：双手空着；动作：指尖在镜头两侧缓缓合拢再松开；结束：双手停在原位。" };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(replacement));
    const result = await runPlanner({ action: "rewrite", provider: "ollama", brief, draft,
      sectionId: section.id, instruction: "手势再轻一些，保持这段完整时长" }, { env: {}, fetchImpl });
    expect(result).toMatchObject({ section: { id: section.id, kind: "silent", purpose: "asmr", durationSeconds: 60,
      direction: replacement.direction } });
    expect(draft).toEqual(original);
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("具体空手模拟手势可配独立制作的材质拟音");
    expect(system).toContain("scene、direction和无台词text都不安排呼气、吹气、叹气或呼吸演出");
    for (const conflict of ["已有材料真正接触才写对应声音", "只有听者真实移动时主观视点才移动", "真实接物、进屋、落座所需时间", "允许S1画外说话"]) {
      expect(system).not.toContain(conflict);
    }
  });

  it.each([true, false])("repairs the whole performance without requiring a silent remainder (pantomime=%s)", async enabled => {
    const speech = { ...section, id: "speech", kind: "speech" as const, purpose: "dialogue" as const,
      text: "我替你稍微整理一下，你看着这里就好，不用一直低着头。", durationSeconds: undefined };
    const incomplete = { ...draft, sections: [speech, { ...section, durationSeconds: 8 }] };
    const corrected = { ...draft, sections: [
      ...Array.from({ length: 6 }, (_, index) => ({ ...speech, id: `speech_${index}` })),
      ...Array.from({ length: 4 }, (_, index) => ({ ...section, id: `gesture_${index}`, durationSeconds: 8 })),
    ] };
    const currentBrief = { ...brief, theme: "替听者整理领子，配合空手动作与柔和拟音", durationSeconds: 120,
      referenceTemplate: { ...template, ...(enabled ? {} : { version: 2, visualPerformance: undefined }) } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(incomplete)).mockResolvedValueOnce(reply(corrected));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: currentBrief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    if (!("draft" in result)) throw new Error("Expected draft");
    expect(getPlannerDurationSummary(result.draft)).toEqual(getPlannerDurationSummary(corrected));
    expect(incomplete.sections[1].durationSeconds).toBe(8);
    const messages = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).messages, repair = messages.at(-1).content;
    expect(repair).toContain("允许96至144秒");
    expect(repair).toContain("自然交流");
    expect(repair).toContain("不得把时间差额硬塞给少数silent段");
    expect(repair).toContain("不延长或重复一个简单动作");
    expect(messages[0].content).not.toContain("得到必须实际分配给silent.durationSeconds的总额");
    expect(repair).not.toContain("silent.durationSeconds实际应合计");
  });

  it("does not add a silent allocation instruction when the user explicitly requests speech only", async () => {
    const speech = { ...section, id: "speech", kind: "speech" as const, purpose: "dialogue" as const,
      text: "我替你稍微整理一下，你看着这里就好，不用一直低着头。", durationSeconds: undefined };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ ...draft, sections: [speech] }))
      .mockResolvedValueOnce(reply({ ...draft, sections: Array.from({ length: 10 }, (_, index) => ({ ...speech, id: `speech_${index}` })) }));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 120, theme: "纯对白的近距离陪伴" } }, { env: {}, fetchImpl });
    const messages = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).messages;
    expect(messages[0].content).not.toContain("得到必须实际分配给silent.durationSeconds的总额");
    expect(messages.at(-1).content).not.toContain("精确时间核对");
  });
});
