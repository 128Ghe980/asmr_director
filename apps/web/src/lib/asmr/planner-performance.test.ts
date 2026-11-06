import { describe, expect, it, vi } from "vitest";
import { compilePlannerDraft, estimatePlannerSpeechDuration, getPlannerDurationSummary, getPlannerPerformanceBudget, PlannerBriefSchema, PlannerDraftSchema, type PlannerDraft } from "./planner";
import { insertPlannerSection, insertPlannerSilentSection, mergePlannerSection, replacePlannerRange, splitPlannerSection } from "./planner-editing";
import { normalizePlannerSemanticDraft, PlannerGeneratedDraftSchema, PlannerPerformanceGeneratedDraftSchema } from "./planner-semantic";
import { runPlanner } from "./planner-provider";
import { commitGenerationSuccess } from "./generation-project-state";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft } from "./planner-persistence";
import { CREATIVE_TEMPLATES } from "./creative-templates";
import { ASMR_SOUND_PALETTE_GUIDANCE } from "./asmr-sound";

const base = { id: "invite", title: "邀请", kind: "speech" as const, purpose: "dialogue" as const,
  text: "把外套给我，进来坐一会儿吧。", emotion: "自然", style: "轻声", pace: "缓慢", direction: "起始：双方站在门口；动作：S1伸出空手示意；结束：仍在门口，手中无物。",
  soundSuggestions: "安静门口的轻微环境声。", pauseAfter: "short" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const } };
const transition = { ...base, id: "enter", title: "进屋", kind: "silent" as const, purpose: "transition" as const, durationSeconds: 8,
  text: "听者跟随角色从门口进入房间并停在桌边。", direction: "起始：双方在门口；动作：听者进入房间到桌边停住；结束：双方站在桌边。", soundSuggestions: "克制的脚步与衣料声，走到桌边后停住。" };
const sound = { ...base, id: "tapping", title: "听纸盒", kind: "silent" as const, purpose: "asmr" as const, durationSeconds: 20,
  text: "角色在同一机位轻敲已经拿在手里的纸盒，疏密变化并停歇。", direction: "起始：右手持纸盒；动作：左指轻敲；结束：两手保持，敲击停止。", soundSuggestions: "柔和纸盒点触，清晰而克制。" };
const draft: PlannerDraft = { performanceVersion: 1, title: "门口到桌边", scene: "安静房间，纸盒在桌上。", character: { role: "熟人", personality: ["自然"], speechStyle: ["轻声"] }, sections: [base, transition, sound] };
const brief = PlannerBriefSchema.parse({ theme: "递外套后进屋，听纸盒", durationSeconds: 180 });
const soundSections = (seconds: number) => Array.from({ length: Math.ceil(seconds / 12) }, (_, index) => ({ ...sound, id: `sound_${index}`, durationSeconds: seconds / Math.ceil(seconds / 12) }));
const generatedDraft = { ...draft, sections: [base, transition, ...soundSections(150)] };

describe("performance scripts", () => {
  it("budgets language separately from operation time and obeys explicit no-speech themes", () => {
    expect(getPlannerPerformanceBudget(brief)).toMatchObject({ speechSeconds: 81, nonSpeechSeconds: 99, spokenCharacters: 178 });
    expect(getPlannerPerformanceBudget({ ...brief, referenceTemplate: CREATIVE_TEMPLATES[0] })).toMatchObject({ speechSeconds: 90, nonSpeechSeconds: 90 });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "传统 ASMR，在麦克风前轻敲" })).toMatchObject({ speechSeconds: 27, nonSpeechSeconds: 153 });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "全程无台词的纸张摩擦" })).toMatchObject({ speechSeconds: 0, nonSpeechSeconds: 180, noSpeech: true });
    expect(getPlannerPerformanceBudget({ ...brief, theme: "纯对白的陪伴" })).toMatchObject({ speechSeconds: 180, nonSpeechSeconds: 0, noSpeech: false });
    for (const referenceTemplate of CREATIVE_TEMPLATES) {
      expect(getPlannerPerformanceBudget({ ...brief, referenceTemplate, theme: "全程无台词的安静演出" })).toMatchObject({ speechSeconds: 0, noSpeech: true });
      expect(getPlannerPerformanceBudget({ ...brief, referenceTemplate, theme: "传统 ASMR，在麦克风前轻敲" }).speechSeconds).toBe(27);
    }
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
    expect(PlannerDraftSchema.safeParse({ ...draft, sections: [{ ...sound, durationSeconds: 600 }] }).success).toBe(true);
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
    expect("draft" in result && result.draft.sections.slice(0, 3).map(section => section.kind)).toEqual(["speech", "silent", "silent"]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.format.properties.performanceVersion.const).toBe(1);
    expect(body.messages[1].content).toContain("语言约 81 秒，无台词表演约 99 秒");
    expect(body.messages[0].content).toContain("先在内部");
    expect(body.messages[0].content).toContain(ASMR_SOUND_PALETTE_GUIDANCE);
  });
  it("puts a compact whole-performance budget before schema and template detail without inheriting original plot beats", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ message: { content: JSON.stringify({ ...draft, sections: [base, transition, ...soundSections(44)] }) } }));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60 } }, { env: {}, fetchImpl });
    const messages = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages;
    const system = messages[0].content as string;
    expect(system).toContain("语言约 27 秒，无台词表演约 33 秒");
    expect(system).toContain("约 59 个非空白字符、3 个完整 speech 段");
    expect(system).toContain("ASMR试听须有独立silent段");
    expect(system).toContain(ASMR_SOUND_PALETTE_GUIDANCE);
    expect(system).toContain("说完一句话不代表动作已完成");
    expect(system).not.toContain("按朗读顺序连续排列的语义短单元");
    expect(system).not.toContain("每个实际台词单元都要有自足的单镜导演说明");
    expect(messages[1].content).toContain("kind:'speech'");
    expect(messages[1].content).toContain("kind:'silent'");

    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, referenceTemplate: CREATIVE_TEMPLATES[0] } }, { env: {}, fetchImpl });
    const templateMessages = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages;
    expect(templateMessages[0].content).toContain("语言约 30 秒，无台词表演约 30 秒");
    expect(templateMessages[1].content).toContain(CREATIVE_TEMPLATES[0].performancePacing!.rules);
    expect(templateMessages[1].content).not.toContain('"beats"');
    expect(templateMessages[1].content).not.toContain('"sceneDescription"');
    const finalCheck = templateMessages[1].content.slice(templateMessages[1].content.lastIndexOf("【本次输出前最后核对"));
    expect(finalCheck).toContain("总表演目标60秒，合格范围48至72秒");
    expect(finalCheck).toContain("完整台词先按约30秒");
    expect(finalCheck).toContain("20至35字");
    expect(finalCheck).toContain("动作邀请或说明准备做什么的台词在动作之前");
    expect(finalCheck).toContain("不能空白");
    expect(finalCheck).toContain("必须返回混合表演脚本");
    expect(finalCheck).toContain("silent.text中不向听者说话");
    expect(finalCheck).toContain("角色评论，应写speech");
    expect(finalCheck).toContain("邀请→动作silent→完成后的回应");
    expect(finalCheck).not.toContain(CREATIVE_TEMPLATES[0].creativePrompt);
    expect(templateMessages[1].content).not.toContain('"storyboardRules"');
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
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain("上一稿缺少全部silent");
    expect(repair).toContain("从speech.direction中移到实际silent单元");
    expect(repair).toContain("不能把缺失的动作当成0秒");
    expect(repair).not.toContain("台词应合计约180秒");
  });
  it("supports a generated all-sound script and preserves its full planned duration", async () => {
    const onlySound = { ...draft, sections: soundSections(180) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: { content: JSON.stringify(onlySound) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect("draft" in result && getPlannerDurationSummary(result.draft)).toEqual({ speechSeconds: 0, nonSpeechSeconds: 180, totalSeconds: 180 });
  });
  it("gives an underlength draft a measured speech budget and short-line list instead of padding silent time", async () => {
    const shortLines = ["先坐一会儿吧。", "你慢慢听。", "这边也好了。"];
    const original = { ...draft, sections: [
      ...shortLines.map((text, index) => ({ ...base, id: `speech_${index}`, text })), ...soundSections(36),
    ] };
    const naturalSpeech = "这只纸盒的声音稍微清脆一些，等我换个位置给你听。";
    const corrected = { ...draft, sections: [
      ...Array.from({ length: 7 }, (_, index) => ({ ...base, id: `speech_${index}`, text: naturalSpeech })), ...soundSections(36),
    ] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 120, referenceTemplate: CREATIVE_TEMPLATES[1] } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && getPlannerDurationSummary(result.draft).nonSpeechSeconds).toBe(36);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain(`"path":"sections.0","seconds":${estimatePlannerSpeechDuration(shortLines[0])}`);
    expect(repair).toContain(`"text":"${shortLines[0]}"`);
    expect(repair).toContain("台词应合计约84秒，至少60秒才能达标");
    expect(repair).toContain("约7至11个完整speech段，每段8至12秒");
    expect(repair).toContain("不能仅增加估时数字、延长动作或复制台词");
    expect(repair).toContain("不要再受最初语言比例限制");
    expect(repair).not.toContain("完整台词先按约66秒");
    expect(original.sections.slice(0, 3).map(section => section.text)).toEqual(shortLines);
  });
  it.each(["全程无台词的纸盒轻敲", "传统 ASMR，在麦克风前轻敲"])("does not turn the timing repair for %s into a forced speech remainder", async theme => {
    const original = { ...draft, sections: soundSections(24) };
    const corrected = { ...draft, sections: soundSections(60) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, theme, durationSeconds: 60 } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).not.toContain("台词应合计约");
    expect(repair).not.toContain("不要再受最初语言比例限制");
  });
  it.each([
    ["asmr", 15], ["transition", 10], ["interaction", 5],
  ] as const)("repairs a new %s segment over %s seconds without silently shortening its saved value", async (purpose, maximum) => {
    const target = { ...sound, purpose, durationSeconds: maximum + 0.1 };
    const padding = soundSections(60 - maximum);
    const original = { ...draft, sections: [target, ...padding] };
    const corrected = { ...draft, sections: [{ ...target, durationSeconds: maximum }, ...padding] };
    expect(PlannerDraftSchema.safeParse(original).success).toBe(true);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(original.sections[0].durationSeconds).toBe(maximum + 0.1);
    expect("draft" in result && result.draft.sections[0].durationSeconds).toBe(maximum);
    const messages = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages;
    expect(messages.at(-1).content).toContain(`sections.0.durationSeconds为${maximum + 0.1}秒，新生成${purpose}段最多${maximum}秒`);
    expect(messages[0].content).toContain("不能只看purpose标签来分配时长");
    expect(messages[0].content).toContain("拆开糖纸、递交或取放即使有好听的声音");
    expect(messages[0].content).not.toContain("10至30秒");
  });
  it("repairs speech estimated above 15 seconds at complete-meaning boundaries without truncating text", async () => {
    const texts = ["你先在这里坐舒服一点，外面的声音很轻，我们慢慢听。", "这只纸盒的声音稍微清脆一些，等我换个位置给你听。"];
    expect(texts.every(text => estimatePlannerSpeechDuration(text) <= 15)).toBe(true);
    const longSpeech = { ...base, text: texts.join("") };
    expect(estimatePlannerSpeechDuration(longSpeech.text)).toBeGreaterThan(15);
    const padding = soundSections(36);
    const original = { ...draft, sections: [longSpeech, ...padding] };
    const corrected = { ...draft, sections: [...texts.map((text, index) => ({ ...base, id: `speech_${index}`, text })), ...padding] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60 } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections.filter(section => section.kind === "speech").map(section => section.text).join("")).toBe(longSpeech.text);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain("单条新台词最多预计15秒");
    expect(repair).toContain("完整意思或自然话题边界");
  });
  it.each([36, 92])("repairs a %s-second generation against a 60-second target without scaling the returned content", async durationSeconds => {
    const original = { ...draft, sections: soundSections(durationSeconds) };
    const corrected = { ...draft, sections: soundSections(60) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(original) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && getPlannerDurationSummary(result.draft).nonSpeechSeconds).toBe(60);
    expect(getPlannerDurationSummary(original).nonSpeechSeconds).toBe(durationSeconds);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain(`总计${durationSeconds}秒`);
    expect(repair).toContain("允许48至72秒");
    expect(repair).toContain("不机械缩放");
  });
  it("rejects a repeated, structurally valid 125-second DP script with its actual timing failure and a concrete reduction budget", async () => {
    // Reduced from the two identical real DP responses on 2026-11-02. Their
    // structure was valid; the model ignored the 90-second request and repair.
    const speechTexts = [
      "今晚要出去夜游，先帮你把披风领子整理好，这样会舒服一点。",
      "好了，领子这边已经平整了。你转一下头看看，应该不会勒。",
      "脸上也帮你扫一下，今晚风大，别让碎发粘在脸上。",
      "额发也拨开了，这样视线清楚，夜游时不会挡眼睛。",
      "最后捏一下脸，就当是今晚的祝福。",
      "好啦，现在感觉怎么样？有没有一点万圣节的气氛？",
      "这个声音像不像小南瓜在敲门？",
      "这个声音很舒服吧，像夜风轻轻吹过。",
      "今晚的夜游，我会一直陪着你。",
      "准备好了吗？我们出发吧。",
    ];
    const units = [
      ...speechTexts.map(text => ({ kind: "speech", purpose: "dialogue", text, pauseAfter: "short", direction: base.direction, soundSuggestions: "" })),
      ...[6, 5, 5, 4, 7, 6, 4, 3].map((durationSeconds, index) => ({
        kind: "silent", purpose: index === 6 ? "interaction" : index === 7 ? "transition" : "asmr",
        durationSeconds, text: "双手空着在镜头前完成当前手势，然后收住。", pauseAfter: "short",
        direction: "起始：空手在胸前。动作：完成当前手势。结束：空手收回胸前。", soundSuggestions: index < 6 ? "与当前手势同步的独立材质触发音。" : "安静室内。",
      })),
    ];
    const original = { performanceVersion: 1, title: draft.title, scene: draft.scene, character: draft.character,
      groups: [{ id: "g1", title: "万圣节准备", emotion: base.emotion, style: base.style, pace: base.pace,
        direction: base.direction, soundSuggestions: "", position: base.position, units }] };
    expect(PlannerGeneratedDraftSchema.safeParse(original).success).toBe(true);
    expect(PlannerPerformanceGeneratedDraftSchema.safeParse(original).success).toBe(true);
    expect(speechTexts.reduce((sum, text) => sum + estimatePlannerSpeechDuration(text), 0)).toBe(85);
    const content = JSON.stringify(original);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ message: { content } }));
    await expect(runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 90 } }, { env: {}, fetchImpl }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("总计125秒；目标90秒，允许72至108秒") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string).messages.at(-1).content;
    expect(repair).toContain("台词目标约50秒、最多68秒");
    expect(repair).toContain("当前台词85秒，至少减少17秒");
    expect(repair).toContain("总时长超出时不能继续扩写台词");
    expect(repair).toContain("不能只合并段落、改direction或原样返回上一稿");
    expect(JSON.stringify(original)).toBe(content);
  });
  it.each(["（无台词）", "听。", "继续。"])("repairs placeholder description %s instead of showing an empty action to the user", async text => {
    const corrected = { ...draft, sections: soundSections(60) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...corrected, sections: corrected.sections.map((part, index) => index ? part : { ...part, text }) }) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(corrected) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief: { ...brief, durationSeconds: 60, theme: "全程无台词的纸盒轻敲" } }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections[0].text).toBe(sound.text);
  });
  it("collects empty description, missing sound intent and total-duration defects in the first repair, then accepts a concrete five-character action", async () => {
    const malformed = { ...draft, sections: [{ ...transition, text: "", soundSuggestions: undefined, durationSeconds: 92 }] };
    const corrected = { ...draft, sections: [
      { ...transition, durationSeconds: 5, text: "在沙发坐下。" },
      ...soundSections(55),
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
