import { describe, expect, it } from "vitest";

import { insertPlannerSection, mergePlannerSection, replacePlannerRange, splitPlannerSection, validPlannerRange } from "./planner-editing";
import { PlannerDraftSchema, type PlannerDraft } from "./planner";

const draft: PlannerDraft = {
  title: "书店", scene: "夜晚", character: { role: "店员", personality: ["自然"], speechStyle: ["轻声"] },
  sections: [
    { id: "first", title: "迎接", text: "  外面冷。\n来坐会儿。慢慢看。  ", emotion: "平静", style: "轻声", pace: "缓慢", direction: "翻书", soundSuggestions: "书页", pauseAfter: "long", position: { pan: -0.5, distance: "near", movement: "static" } },
    { id: "second", title: "收尾", text: "再见。", emotion: "温暖", style: "轻声", pace: "缓慢", direction: "合上书", soundSuggestions: "", pauseAfter: "medium", position: { pan: 0.5, distance: "mid", movement: "static" } },
  ],
};

describe("user-defined planner text ranges", () => {
  it("only replaces selected UTF-16 text, preserving whitespace and every metadata field", () => {
    const original = draft.sections[0];
    const start = original.text.indexOf("来");
    const range = { start, end: start + 5 };
    const changed = replacePlannerRange(original, range, "坐这里。 ");
    expect(changed).toEqual({ ...original, text: original.text.slice(0, start) + "坐这里。 " + original.text.slice(range.end) });
    expect(PlannerDraftSchema.parse({ ...draft, sections: [changed, draft.sections[1]] }).sections[0].text).toBe(changed.text);
    expect(original.text).toBe("  外面冷。\n来坐会儿。慢慢看。  ");
  });

  it("rejects stale offsets and boundaries inside emoji instead of corrupting text", () => {
    expect(validPlannerRange("😀你好", { start: 1, end: 3 })).toBe(false);
    expect(validPlannerRange("😀你好", { start: 0, end: 2 })).toBe(true);
    expect(validPlannerRange("你好", { start: 0, end: 3 })).toBe(false);
    expect(() => replacePlannerRange(draft.sections[0], { start: 0, end: 100 }, "你好")).toThrow("失效");
  });

  it("splits at the cursor or isolates an arbitrary selection without changing a character", () => {
    const start = draft.sections[0].text.indexOf("来");
    const split = splitPlannerSection(draft, "first", { start, end: start + 5 });
    expect(split.sections).toHaveLength(4);
    expect(split.sections.slice(0, 3).map((section) => section.text).join("")).toBe(draft.sections[0].text);
    expect(split.sections.slice(0, 3).map((section) => section.pauseAfter)).toEqual(["short", "short", "long"]);
    expect(new Set(split.sections.map((section) => section.id)).size).toBe(4);
    expect(split.sections[3]).toBe(draft.sections[1]);
    expect(split.sections[1].direction).toBe(draft.sections[0].direction);
    expect(PlannerDraftSchema.safeParse(split).success).toBe(true);
    expect(splitPlannerSection(draft, "first", { start, end: start }).sections).toHaveLength(3);
  });

  it("preserves merged script and notes, the first voice settings and the final pause", () => {
    const merged = mergePlannerSection(draft, "first");
    expect(merged.sections).toEqual([{ ...draft.sections[0], text: draft.sections.map((section) => section.text).join(""), direction: "翻书\n合上书", pauseAfter: "medium" }]);
    expect(PlannerDraftSchema.safeParse(merged).success).toBe(true);
  });

  it("allows users to create more than twelve sections and unique empty inserts", () => {
    let next = draft;
    for (let index = 0; index < 15; index += 1) next = insertPlannerSection(next, "first");
    expect(next.sections).toHaveLength(17);
    expect(new Set(next.sections.map((section) => section.id)).size).toBe(17);
    expect(next.sections[1].text).toBe("");
    expect(next.sections.at(-1)).toBe(draft.sections[1]);
  });
});
