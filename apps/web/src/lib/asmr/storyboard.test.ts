import { describe, expect, it } from "vitest";

import type { PlannerDraft } from "./planner";
import { createStoryboardSourceFingerprint, EditableStoryboardSchema, exportStoryboardMarkdown, isStoryboardCurrent, StoryboardGeneratedSchema, StoryboardSchema, validateStoryboardSourceSections, type PlannerStoryboard } from "./storyboard";

export function createStoryboardDraft(): PlannerDraft {
  const section = {
    id: "one", title: "迎接", text: "进来坐一会儿吧。", emotion: "温柔", style: "轻声", pace: "slow", direction: "自然留白",
    soundSuggestions: "翻书声", pauseAfter: "medium" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const },
  };
  return {
    title: "深夜书店", scene: "夜晚书店", character: { role: "店员", personality: ["耐心"], speechStyle: ["轻声"] },
    sections: [section, { ...section, id: "two", text: "我给你留了一盏小灯。" }],
  };
}

export function createStoryboardFixture(draft = createStoryboardDraft()): PlannerStoryboard {
  return {
    version: 1, sourceFingerprint: createStoryboardSourceFingerprint(draft), title: "书店的小灯",
    shots: [{ id: "shot_1", title: "暖光迎接", sourceSectionIds: draft.sections.map((section) => section.id), visual: "暖黄色小灯映着书架。", action: "店员请客人坐下，轻轻摆好书。", camera: "固定中景，缓缓推近。" }],
  };
}

describe("文字分镜", () => {
  it("validates generated scenes while rejecting extra assets, repeated shot IDs and duplicate source references", () => {
    const fixture = createStoryboardFixture();
    expect(StoryboardSchema.safeParse(fixture).success).toBe(true);
    expect(StoryboardSchema.safeParse({ ...fixture, imageUrl: "https://unexpected.example/image.png" }).success).toBe(false);
    const shot = fixture.shots[0];
    expect(StoryboardSchema.safeParse({ ...fixture, shots: [shot, { ...shot, sourceSectionIds: ["three"] }] }).success).toBe(false);
    expect(StoryboardSchema.safeParse({ ...fixture, shots: [shot, { ...shot, id: "shot_2" }] }).success).toBe(false);
    expect(StoryboardSchema.safeParse({ ...fixture, shots: [{ ...shot, sourceSectionIds: ["one", "one"] }] }).success).toBe(false);
  });

  it("keeps earlier V1 storyboards readable and preserves the optional H3 marker", () => {
    const fixture = createStoryboardFixture();
    expect(StoryboardSchema.parse(fixture)).toEqual(fixture);
    const h3 = { ...fixture, promptFormat: "minimax-h3" };
    expect(StoryboardSchema.parse(h3)).toEqual(h3);
    expect(EditableStoryboardSchema.parse({ ...h3, shots: h3.shots.map((shot) => ({ ...shot, visual: "" })) }).promptFormat).toBe("minimax-h3");
    expect(StoryboardSchema.safeParse({ ...fixture, promptFormat: "another-model" }).success).toBe(false);
  });

  it("lets partially edited text persist without weakening generation completeness or the 24-shot limit", () => {
    const fixture = createStoryboardFixture();
    const blank = { ...fixture, title: "", shots: fixture.shots.map((shot) => ({ ...shot, title: "", visual: "", action: "", camera: "" })) };
    expect(EditableStoryboardSchema.safeParse(blank).success).toBe(true);
    expect(StoryboardSchema.safeParse(blank).success).toBe(false);
    const tooMany = Array.from({ length: 25 }, (_, index) => ({ ...fixture.shots[0], id: `shot_${index}`, sourceSectionIds: [`section_${index}`] }));
    expect(StoryboardGeneratedSchema.safeParse({ title: fixture.title, shots: tooMany }).success).toBe(false);
    expect(EditableStoryboardSchema.safeParse({ ...fixture, shots: tooMany }).success).toBe(false);
  });

  it("requires a complete ordered partition of the original semantic units", () => {
    const draft = createStoryboardDraft();
    const fixture = createStoryboardFixture(draft);
    expect(validateStoryboardSourceSections(fixture, draft)).toBe(true);
    for (const sourceSectionIds of [["two", "one"], ["one"], ["one", "unknown"], ["one", "one", "two"]]) {
      expect(validateStoryboardSourceSections({ shots: [{ ...fixture.shots[0], sourceSectionIds }] }, draft)).toBe(false);
      const mismatch = { ...fixture, shots: [{ ...fixture.shots[0], sourceSectionIds }] };
      expect(isStoryboardCurrent(mismatch, draft)).toBe(false);
      expect(exportStoryboardMarkdown(mismatch, draft)).not.toContain("关联台词");
    }
  });

  it("tracks writing source and ordering, independent of voice controls, and recognizes undo", () => {
    const draft = createStoryboardDraft();
    const fixture = createStoryboardFixture(draft);
    expect(isStoryboardCurrent(fixture, draft)).toBe(true);
    expect(isStoryboardCurrent(fixture, { ...draft, sections: draft.sections.map((section) => ({ ...section, pace: "fast", direction: "另一条声音提示", pauseAfterSeconds: 20 })) })).toBe(true);
    expect(isStoryboardCurrent(fixture, { ...draft, sections: [...draft.sections].reverse() })).toBe(false);
    expect(isStoryboardCurrent(fixture, { ...draft, scene: "另一个场景" })).toBe(false);
    expect(isStoryboardCurrent(fixture, { ...draft, character: { ...draft.character, role: "另一位店员" } })).toBe(false);
    expect(isStoryboardCurrent(fixture, { ...draft, sections: draft.sections.map((section) => ({ ...section, text: section.text + "新台词" })) })).toBe(false);
    expect(isStoryboardCurrent(fixture, draft)).toBe(true);
    expect(isStoryboardCurrent(null, draft)).toBe(false);
    expect(isStoryboardCurrent(fixture, null)).toBe(false);
  });

  it("exports editable direction with exact current dialogue but omits dialogue references when stale", () => {
    const draft = createStoryboardDraft();
    const fixture = createStoryboardFixture(draft);
    const markdown = exportStoryboardMarkdown(fixture, draft);
    expect(markdown).toContain("镜头 01 · 暖光迎接");
    expect(markdown).toContain(draft.sections.map((section) => section.text).join(""));
    expect(markdown).toContain("画面：暖黄色小灯");
    const stale = exportStoryboardMarkdown(fixture, { ...draft, sections: draft.sections.map((section) => ({ ...section, text: "已改的新台词" })) });
    expect(stale).toContain("文案已更新");
    expect(stale).not.toContain("关联台词");
    expect(stale).not.toContain("已改的新台词");
  });
});
