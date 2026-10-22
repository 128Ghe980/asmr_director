import { describe, expect, it } from "vitest";
import { compilePlannerDraft, PlannerBriefSchema, type PlannerDraft } from "./planner";
import { expandPlannerGeneratedDraft, normalizePlannerSemanticDraft, PlannerGeneratedDraftSchema, splitPlannerSemanticText } from "./planner-semantic";
import { insertPlannerSection, mergePlannerSection, splitPlannerSection } from "./planner-editing";
import { commitGenerationSuccess } from "./generation-project-state";
import { VOICE_PAUSE_RULES } from "./voice-longtext-plan";

const draft: PlannerDraft = {
  title: "书店", scene: "晚间书店", character: { role: "店员", personality: ["自然"], speechStyle: ["温柔"] },
  sections: [{ id: "opening", title: "迎接", text: "别着急，我把灯挪过来。这里坐着舒服些，你慢慢挑。", emotion: "平静", style: "轻声", pace: "缓慢", direction: "轻轻放下书", soundSuggestions: "书页声", pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" } }],
};

describe("planner semantic units", () => {
  it("keeps the Snow Night food enumeration in one editable unit", () => {
    const text = "吃的也囤了不少，米面、腌菜、冻肉，还有你爱吃的果酱。";
    expect(splitPlannerSemanticText(text)).toEqual([text]);
    const normalized = normalizePlannerSemanticDraft({ ...draft, sections: [{ ...draft.sections[0], text }] });
    expect(normalized.sections.map((section) => section.text)).toEqual([text]);
    expect(normalized.sections[0].id).toBe("opening");
  });

  it("splits the real six-clause greeting into two natural voice groups even though it has only three full sentences", () => {
    const text = "回来啦。我还没睡，就猜你快到了。先把鞋换了，外套挂这边，过来坐。";
    const result = splitPlannerSemanticText(text);
    expect(result).toEqual(["回来啦。我还没睡，就猜你快到了。", "先把鞋换了，外套挂这边，过来坐。"]);
    expect(result.join("")).toBe(text);
    const normalized = normalizePlannerSemanticDraft({ ...draft, sections: [{ ...draft.sections[0], text }] });
    expect(normalized.sections.map((section) => section.text)).toEqual(result);
  });

  it("preserves model-defined related sentences together with shared natural pause defaults", () => {
    const result = normalizePlannerSemanticDraft(draft);
    expect(result.segmentation).toBe("semantic");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toEqual({ ...draft.sections[0], pauseAfterSeconds: VOICE_PAUSE_RULES.medium.default / 1000 });
    expect(draft).not.toHaveProperty("segmentation");
  });

  it("falls back to shared clause grouping for oversized units without losing any punctuation, whitespace or speech", () => {
    const text = "  价格是 3.5 元，先放在这儿。\n" + "别着急，我把灯挪过来。这里坐着舒服些，你慢慢挑。".repeat(18) + "  ";
    const split = splitPlannerSemanticText(text);
    expect(split.length).toBeGreaterThan(8);
    expect(split.join("")).toBe(text);
    expect(split.some((unit) => unit.includes("价格是 3.5 元，先放在这儿。"))).toBe(true);
    expect(split.some((unit) => (unit.match(/[，。]/g)?.length ?? 0) >= 2)).toBe(true);
    expect(split.every((unit) => unit.length <= 100)).toBe(true);
    const result = normalizePlannerSemanticDraft({ ...draft, sections: [{ ...draft.sections[0], text }] });
    expect(new Set(result.sections.map((section) => section.id)).size).toBe(result.sections.length);
    expect(result.sections.map((section) => section.text).join("")).toBe(text);
  });

  it("expands a compact ten-minute generation to seventy distinct editable and generated units", () => {
    const { id, title, emotion, style, pace, direction, soundSuggestions, position } = draft.sections[0];
    const metadata = { id, title, emotion, style, pace, direction, soundSuggestions, position };
    const units = Array.from({ length: 70 }, (_, index) => ({ text: `第${index + 1}句，书就在这里，你可以坐着慢慢看。`, pauseAfter: "medium" as const }));
    const compact = PlannerGeneratedDraftSchema.parse({ title: draft.title, scene: draft.scene, character: draft.character, groups: [{ ...metadata, units }] });
    const expanded = expandPlannerGeneratedDraft(compact);
    expect(expanded.sections).toHaveLength(70);
    expect(expanded.sections.map((section) => section.text).join("")).toBe(units.map((unit) => unit.text).join(""));
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(expanded).length / 2);
    const project = compilePlannerDraft(PlannerBriefSchema.parse({ theme: "书店", durationSeconds: 600 }), expanded, "semantic_long");
    const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
    expect(voices).toHaveLength(70);
    expect(voices.every((clip) => clip.semantic_unit && clip.pause_after === 0.35)).toBe(true);
    expect(voices.map((clip) => clip.text).join("")).toBe(units.map((unit) => unit.text).join(""));
    const generated = commitGenerationSuccess(project, voices[0].id, { assetId: "a", uri: "asset://clip/a", duration: 1.2 }, { fitVoiceTiming: true });
    const nextVoices = generated.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
    expect(nextVoices[1].start - nextVoices[0].start - 1.2).toBeCloseTo(0.35);
  });

  it("only converts legacy drafts explicitly and preserves their intended section-end waits", () => {
    const legacy = { ...draft, sections: [{ ...draft.sections[0], text: draft.sections[0].text.repeat(7), pauseAfter: "long" as const }] };
    const compiled = compilePlannerDraft(PlannerBriefSchema.parse({ theme: "书店" }), legacy, "legacy");
    expect(compiled.timeline.tracks[0].clips).toHaveLength(1);
    expect(compiled.timeline.tracks[0].clips[0]).toMatchObject({ pause_after: 6 });
    expect(compiled.timeline.tracks[0].clips[0]).not.toHaveProperty("semantic_unit");
    const converted = normalizePlannerSemanticDraft(legacy, { preserveSectionPauses: true });
    expect(converted.sections.length).toBeGreaterThan(1);
    expect(converted.sections.at(-1)?.pauseAfterSeconds).toBe(6);
    expect(converted.sections.slice(0, -1).every((section) => section.pauseAfterSeconds! <= 0.6)).toBe(true);
  });

  it("retains the final precise wait across split/merge and gives new inserted units a short pause", () => {
    const semantic = normalizePlannerSemanticDraft(draft);
    semantic.sections[0].pauseAfterSeconds = 2.75;
    const split = splitPlannerSection(semantic, "opening", { start: 4, end: 4 });
    expect(split.sections.map((section) => section.pauseAfterSeconds)).toEqual([0.18, 2.75]);
    expect(mergePlannerSection(split, "opening").sections[0].pauseAfterSeconds).toBe(2.75);
    expect(insertPlannerSection(semantic).sections[1].pauseAfterSeconds).toBe(0.18);
  });
});
