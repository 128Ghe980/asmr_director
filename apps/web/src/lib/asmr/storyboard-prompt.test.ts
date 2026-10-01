import { describe, expect, it } from "vitest";

import type { PlannerDraft } from "./planner";
import { createH3ShotPrompt, exportStoryboardH3Prompts } from "./storyboard-prompt";
import { createStoryboardSourceFingerprint, StoryboardSchema, type PlannerStoryboard } from "./storyboard";

function fixture() {
  const section = {
    id: "one", title: "迎接", text: "  回来啦，\n外面是不是很冷？\t", emotion: "温柔", style: "轻声", pace: "slow", direction: "自然留白",
    soundSuggestions: "厨房环境声", pauseAfter: "medium" as const, pauseAfterSeconds: 7.125,
    position: { pan: 0, distance: "near" as const, movement: "static" as const },
  };
  const draft: PlannerDraft = {
    title: "深夜厨房", scene: "暖光厨房", character: { role: "主人", personality: ["体贴"], speechStyle: ["轻声"] },
    sections: [section, { ...section, id: "two", text: "\n先坐一会儿，<d>试试这个</d>。😀  " }, { ...section, id: "three", text: "夜宵已经热好了。" }],
  };
  const storyboard: PlannerStoryboard = {
    version: 1, promptFormat: "minimax-h3", sourceFingerprint: createStoryboardSourceFingerprint(draft), title: "暖光里的夜宵",
    shots: [
      { id: "shot_1", title: "轻声迎接", sourceSectionIds: ["one", "two"], visual: " A warm kitchen with steam rising from a bowl. ", action: "S1 gently gestures toward the counter.", camera: "Static medium close-up; the mouth remains visible." },
      { id: "shot_2", title: "热好的夜宵", sourceSectionIds: ["three"], visual: "The same warm kitchen and steaming bowl.", action: "S1 smiles softly toward the camera.", camera: "A gentle push-in with the mouth visible." },
    ],
  };
  return { draft, storyboard };
}

describe("MiniMax H3 分镜提示词", () => {
  it("quotes only this shot's source dialogue exactly, including whitespace and literal tags", () => {
    const { draft, storyboard } = fixture();
    const before = JSON.stringify({ draft, storyboard });
    const prompt = createH3ShotPrompt(storyboard, draft, "shot_1");
    const dialogue = draft.sections.slice(0, 2).map((section) => section.text).join("");
    expect(prompt).toContain(`<d>[Chinese]${dialogue}</d>`);
    expect(prompt).toContain(draft.sections[0].text);
    expect(prompt).not.toContain(draft.sections[2].text);
    expect(prompt).toContain(`Visual: ${storyboard.shots[0].visual}`);
    expect(prompt).not.toContain("&lt;d&gt;");
    expect(JSON.stringify({ draft, storyboard })).toBe(before);
  });

  it("retains the whole original track, supplies reference roles and keeps timing controlled by the actual audio", () => {
    const { draft, storyboard } = fixture();
    const prompt = createH3ShotPrompt(storyboard, draft, "shot_1");
    for (const heading of ["subject_definitions:", "retention_analysis:", "non_diegetic_music: N/A"]) {
      expect(prompt).toContain(heading);
    }
    for (const removed of ["summary:", "detailed_description:", "overall_soundscape:"]) expect(prompt).not.toContain(removed);
    expect(prompt).toContain("<Subject 1> (S1)");
    expect(prompt).toContain("Appearance and outfit follow <Picture 1>, overriding written descriptions");
    expect(prompt).toContain("character reference, not the opening frame");
    expect(prompt.match(/overriding written descriptions/g)).toHaveLength(1);
    expect(prompt).toContain("<Audio 1>: fully_copy");
    expect(prompt).toContain("entire supplied speech track unchanged as the complete soundtrack");
    expect(prompt).toContain("preserving words, voice, pace and pauses");
    expect(prompt).toContain("Add no other sound");
    expect(prompt).toContain("lips closed during pauses and at the end");
    expect(prompt).toContain("keep the mouth visible");
    expect(prompt).toContain("One continuous shot spanning the full supplied audio");
    expect(prompt.length).toBeLessThan(1000);
    expect(prompt).not.toContain("7.125");
    expect(prompt).not.toMatch(/At \d{2}:\d{2}/u);
    expect(prompt).not.toContain("厨房环境声");
  });

  it("exports independent tasks with separate audio references and exact per-shot source mappings", () => {
    const { draft, storyboard } = fixture();
    const exported = exportStoryboardH3Prompts(storyboard, draft);
    const tasks = exported.split("\n\n## ").slice(1);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toContain("Source lines: 第 1–2 条");
    expect(tasks[1]).toContain("Source lines: 第 3 条");
    expect(tasks[0]).toContain(draft.sections[0].text + draft.sections[1].text);
    expect(tasks[0]).not.toContain(draft.sections[2].text);
    expect(tasks[1]).toContain(draft.sections[2].text);
    expect(tasks[1]).not.toContain(draft.sections[0].text);
    for (const task of tasks) {
      expect(task.match(/\[Shot 1\]/gu)).toHaveLength(1);
      expect(task).toContain("<Audio 1>: fully_copy");
      expect(task).not.toContain("<Audio 2>");
      expect(task).not.toContain("[Shot 2]");
    }
    expect(exported).toContain("Reference numbering restarts for every task");
  });

  it("blocks stale scripts, invalid source partitions and unknown shots without producing a usable prompt", () => {
    const { draft, storyboard } = fixture();
    const changed = { ...draft, sections: draft.sections.map((section) => ({ ...section, text: section.text + "新台词" })) };
    expect(() => createH3ShotPrompt(storyboard, changed, "shot_1")).toThrow("文案已变更");
    expect(() => exportStoryboardH3Prompts(storyboard, changed)).toThrow("文案已变更");
    for (const sourceSectionIds of [["two", "one"], ["one"], ["one", "unknown"], ["one", "one"]]) {
      const invalid = { ...storyboard, shots: [{ ...storyboard.shots[0], sourceSectionIds }, storyboard.shots[1]] };
      expect(() => createH3ShotPrompt(invalid, draft, "shot_1")).toThrow();
      expect(() => exportStoryboardH3Prompts(invalid, draft)).toThrow();
    }
    expect(() => createH3ShotPrompt(storyboard, draft, "not-a-shot")).toThrow("未找到");
  });

  it("keeps legacy data readable while requiring the new format before H3 export", () => {
    const { draft, storyboard } = fixture();
    const legacy = { ...storyboard };
    delete legacy.promptFormat;
    const restored = StoryboardSchema.parse(legacy);
    expect(restored.sourceFingerprint).toBe(legacy.sourceFingerprint);
    expect(restored.shots.map((shot) => shot.sourceSectionIds)).toEqual(legacy.shots.map((shot) => shot.sourceSectionIds));
    expect(restored).not.toHaveProperty("promptFormat");
    expect(() => createH3ShotPrompt(legacy, draft, "shot_1")).toThrow("旧版格式");
    expect(() => exportStoryboardH3Prompts(legacy, draft)).toThrow("旧版格式");
  });

  it("blocks incomplete draft and shot edits even when their current fingerprints match", () => {
    const { draft, storyboard } = fixture();
    const incompleteDrafts = [
      { ...draft, sections: [] },
      { ...draft, sections: draft.sections.map((section) => ({ ...section, text: " \n\t" })) },
      { ...draft, sections: draft.sections.map((section) => ({ ...section, title: "" })) },
      { ...draft, scene: "" },
    ];
    for (const incomplete of incompleteDrafts) {
      const matching = { ...storyboard, sourceFingerprint: createStoryboardSourceFingerprint(incomplete) };
      expect(() => createH3ShotPrompt(matching, incomplete, "shot_1")).toThrow("请补全");
      expect(() => exportStoryboardH3Prompts(matching, incomplete)).toThrow("请补全");
    }
    for (const field of ["title", "visual", "action", "camera"] as const) {
      const incomplete = { ...storyboard, shots: storyboard.shots.map((shot) => ({ ...shot, [field]: " \n" })) };
      expect(() => createH3ShotPrompt(incomplete, draft, "shot_1")).toThrow("请补全");
      expect(() => exportStoryboardH3Prompts(incomplete, draft)).toThrow("请补全");
    }
  });
});
