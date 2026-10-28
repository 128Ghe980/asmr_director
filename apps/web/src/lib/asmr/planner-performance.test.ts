import { describe, expect, it, vi } from "vitest";
import { compilePlannerDraft, getPlannerDurationSummary, getPlannerPerformanceBudget, PlannerBriefSchema, PlannerDraftSchema, type PlannerDraft } from "./planner";
import { insertPlannerSection, insertPlannerSilentSection, mergePlannerSection, replacePlannerRange, splitPlannerSection } from "./planner-editing";
import { normalizePlannerSemanticDraft } from "./planner-semantic";
import { runPlanner } from "./planner-provider";
import { commitGenerationSuccess } from "./generation-project-state";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft } from "./planner-persistence";
import { CREATIVE_TEMPLATES } from "./creative-templates";

const base = { id: "invite", title: "邀请", kind: "speech" as const, purpose: "dialogue" as const,
  text: "把外套给我，进来坐一会儿吧。", emotion: "自然", style: "轻声", pace: "缓慢", direction: "起始：双方站在门口；动作：S1伸出空手示意；结束：仍在门口，手中无物。",
  soundSuggestions: "安静门口的轻微环境声。", pauseAfter: "short" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const } };
const transition = { ...base, id: "enter", title: "进屋", kind: "silent" as const, purpose: "transition" as const, durationSeconds: 8,
  text: "听者跟随角色从门口进入房间并停在桌边。", direction: "起始：双方在门口；动作：听者进入房间到桌边停住；结束：双方站在桌边。", soundSuggestions: "克制的脚步与衣料声，走到桌边后停住。" };
const sound = { ...base, id: "tapping", title: "听纸盒", kind: "silent" as const, purpose: "asmr" as const, durationSeconds: 20,
  text: "角色在同一机位轻敲已经拿在手里的纸盒，疏密变化并停歇。", direction: "起始：右手持纸盒；动作：左指轻敲；结束：两手保持，敲击停止。", soundSuggestions: "柔和纸盒点触，清晰而克制。" };
const draft: PlannerDraft = { performanceVersion: 1, title: "门口到桌边", scene: "安静房间，纸盒在桌上。", character: { role: "熟人", personality: ["自然"], speechStyle: ["轻声"] }, sections: [base, transition, sound] };
const brief = PlannerBriefSchema.parse({ theme: "递外套后进屋，听纸盒", durationSeconds: 180 });
const generatedDraft = { ...draft, sections: [base, transition, { ...sound, durationSeconds: 150 }] };

describe("performance scripts", () => {
  it("budgets language separately from operation time and obeys explicit no-speech themes", () => {
    expect(getPlannerPerformanceBudget(brief)).toMatchObject({ speechSeconds: 81, nonSpeechSeconds: 99, spokenCharacters: 178 });
    expect(getPlannerPerformanceBudget({ ...brief, referenceTemplate: CREATIVE_TEMPLATES[0] })).toMatchObject({ speechSeconds: 72, nonSpeechSeconds: 108 });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "传统 ASMR，在麦克风前轻敲" })).toMatchObject({ speechSeconds: 27, nonSpeechSeconds: 153 });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "全程无台词的纸张摩擦" })).toMatchObject({ speechSeconds: 0, nonSpeechSeconds: 180, noSpeech: true });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "纯对白的陪伴" })).toMatchObject({ speechSeconds: 180, nonSpeechSeconds: 0, noSpeech: false });
  });
  it("compiles timed actions in order, preserves identity and recalculates following starts after actual speech", () => {
    const project = compilePlannerDraft(brief, draft, "performance");
    const clips = project.timeline.tracks[0].clips;
    expect(clips.map(clip => clip.type === "voice" && clip.kind)).toEqual([undefined, "silent", "silent"]);
    expect(clips[1]).toMatchObject({ duration: 8, pause_after: 0, performance: { segmentId: "enter", purpose: "transition", direction: transition.direction } });
    expect(clips[2]).toMatchObject({ duration: 20, pause_after: 0, performance: { segmentId: "tapping", soundIntent: sound.soundSuggestions } });
    expect(getPlannerDurationSummary(draft).nonSpeechSeconds).toBe(28);
    const adopted = commitGenerationSuccess(project, clips[0].id, { assetId: "voice", uri: "asset://clip/voice", duration: 2.5 }, { fitVoiceTiming: true });
    expect(adopted.timeline.tracks[0].clips.slice(1).map(clip => [clip.start, clip.duration])).toEqual([[2.5, 8], [10.5, 20]]);
  });
  it("validates silent duration while allowing all-silent work without producing pretend speech", () => {
    const onlySound = { ...draft, sections: [sound] };
    expect(PlannerDraftSchema.safeParse(onlySound).success).toBe(true);
    const clips = compilePlannerDraft(brief, onlySound, "all_sound").timeline.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ kind: "silent", duration: 20, asset: { asset_id: null } });
    for (const durationSeconds of [undefined, 0, -1, 601]) {
      expect(PlannerDraftSchema.safeParse({ ...draft, sections: [{ ...sound, durationSeconds }] }).success).toBe(false);
    }
    expect(PlannerDraftSchema.safeParse({ ...draft, sections: [{ ...base, durationSeconds: 4 }] }).success).toBe(false);
  });
  it("keeps long action descriptions whole and does not create double pauses", () => {
    const longAction = { ...sound, text: "慢慢触碰同一材料，再停一下。".repeat(40), pauseAfterSeconds: 10 };
    const normalized = normalizePlannerSemanticDraft({ ...draft, sections: [longAction] });
    expect(normalized.sections).toHaveLength(1);
    expect(normalized.sections[0]).toMatchObject({ text: longAction.text, durationSeconds: 20, pauseAfterSeconds: 0 });
    expect(compilePlannerDraft(brief, normalized, "no_double_pause").duration).toBe(20);
  });
  it("protects nonspoken boundaries in editing and preserves legacy pauses when inserting", () => {
    expect(() => splitPlannerSection(draft, "enter", { start: 3, end: 3 })).toThrow("无台词");
    expect(() => mergePlannerSection(draft, "invite")).toThrow("无台词");
    const inserted = insertPlannerSilentSection(draft, "invite", "interaction");
    expect(inserted.sections[1]).toMatchObject({ kind: "silent", durationSeconds: 5, purpose: "interaction", pauseAfterSeconds: 0 });
    expect(insertPlannerSection(draft, "enter").sections[2]).not.toHaveProperty("durationSeconds");
    const legacy = { ...draft, performanceVersion: undefined, sections: [{ ...base, kind: undefined, purpose: undefined, pauseAfterSeconds: 6 }] };
    const legacyInserted = insertPlannerSilentSection(legacy);
    expect(compilePlannerDraft(brief, legacyInserted, "legacy_insert").timeline.tracks[0].clips[0]).toMatchObject({ pause_after: 6 });
  });
  it("persists both segment kinds and editable descriptions without converting old drafts", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const state = { ...createEmptyPlannerWorkingState(), brief, draftBrief: brief, draft };
    expect(savePlannerDraft(storage, state, "performance")).toEqual({ success: true });
    expect(loadPlannerDraft(storage, "performance").state.draft).toEqual(draft);
  });
  it("asks for automatic timing in the same generation and accepts ordered mixed model sections", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: { content: JSON.stringify(generatedDraft) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect("draft" in result && result.draft.sections.map(section => section.kind)).toEqual(["speech", "silent", "silent"]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.format.properties.performanceVersion.const).toBe(1);
    expect(body.messages[1].content).toContain("语言约 81 秒，无台词表演约 99 秒");
    expect(body.messages[0].content).toContain("先在内部");
  });
  it("puts a compact whole-performance budget before schema and template detail without inheriting original plot beats", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ message: { content: JSON.stringify({ ...draft, sections: [base, transition, { ...sound, durationSeconds: 44 }] }) } }));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60 } }, { env: {}, fetchImpl });
    const messages = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages;
    const system = messages[0].content as string;
    expect(system.split("\n")[1]).toContain("语言约 27 秒，无台词表演约 33 秒");
    expect(system.split("\n")[2]).toContain("不超过 59 个非空白字符，建议最多 5 个 speech 段");
    expect(system).toContain("ASMR试听须有独立silent段");
    expect(system).toContain("说完一句话不代表动作已完成");
    expect(system).not.toContain("按朗读顺序连续排列的语义短单元");
    expect(system).not.toContain("每个实际台词单元都要有自足的单镜导演说明");
    expect(system).toContain("kind:'speech'");
    expect(system).toContain("kind:'silent'");

    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, referenceTemplate: CREATIVE_TEMPLATES[0] } }, { env: {}, fetchImpl });
    const templateMessages = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages;
    expect(templateMessages[0].content).toContain("语言约 24 秒，无台词表演约 36 秒");
    expect(templateMessages[1].content).toContain(CREATIVE_TEMPLATES[0].performancePacing!.rules);
    expect(templateMessages[1].content).not.toContain('"beats"');
    expect(templateMessages[1].content).not.toContain('"sceneDescription"');
  });
  it("invalidates old action intentions after a speech split or selected-text rewrite", () => {
    const split = splitPlannerSection(draft, "invite", { start: 6, end: 6 });
    expect(split.sections.slice(0, 2).every(section => section.direction === "" && section.soundSuggestions === "")).toBe(true);
    const rewritten = replacePlannerRange(base, { start: 0, end: 6 }, "外套先放这里");
    expect(rewritten).toMatchObject({ kind: "speech", direction: "", soundSuggestions: "" });
    const legacy = { ...base, kind: undefined };
    expect(replacePlannerRange(legacy, { start: 0, end: 6 }, "外套先放这里").direction).toBe(base.direction);
  });
  it("repairs a generation that omitted real nonspoken time once instead of silently accepting it", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...draft, sections: [base] }) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(generatedDraft) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections[1].durationSeconds).toBe(8);
    expect(JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content).toContain("真正占据时间");
  });
  it("supports a generated all-sound script and preserves its full planned duration", async () => {
    const onlySound = { ...draft, sections: [{ ...sound, durationSeconds: 180 }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: { content: JSON.stringify(onlySound) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect("draft" in result && getPlannerDurationSummary(result.draft)).toEqual({ speechSeconds: 0, nonSpeechSeconds: 180, totalSeconds: 180 });
  });
  it.each([36, 92])("repairs a %s-second generation against a 60-second target without scaling the returned content", async durationSeconds => {
    const original = { ...draft, sections: [{ ...sound, durationSeconds }] };
    const corrected = { ...draft, sections: [{ ...sound, durationSeconds: 60 }] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections[0].durationSeconds).toBe(60);
    expect(original.sections[0].durationSeconds).toBe(durationSeconds);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain(`总计${durationSeconds}秒`);
    expect(repair).toContain("允许48至72秒");
    expect(repair).toContain("不机械缩放");
  });
  it.each(["（无台词）", "听。", "继续。"])("repairs placeholder description %s instead of showing an empty action to the user", async text => {
    const corrected = { ...draft, sections: [{ ...sound, durationSeconds: 60 }] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...corrected, sections: [{ ...corrected.sections[0], text }] }) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections[0].text).toBe(sound.text);
  });
  it("collects empty description, missing sound intent and total-duration defects in the first repair, then accepts a concrete five-character action", async () => {
    const malformed = { ...draft, sections: [{ ...transition, text: "", soundSuggestions: undefined, durationSeconds: 92 }] };
    const corrected = { ...draft, sections: [
      { ...transition, durationSeconds: 5, text: "在沙发坐下。" },
      { ...sound, id: "quiet", purpose: "interaction", durationSeconds: 55, text: "安静陪伴看雪。", soundSuggestions: "安静环境" },
    ] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(malformed) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的安静陪伴" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain("sections.0.text");
    expect(repair).toContain("sections.0.soundSuggestions");
    expect(repair).toContain("总计92秒");
    expect("draft" in result && result.draft.sections[0].text).toBe("在沙发坐下。");
  });
});
