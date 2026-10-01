import { describe, expect, it } from "vitest";

import { PlannerBriefSchema, type PlannerDraft } from "./planner";
import {
  PLANNER_DRAFT_STORAGE_KEY,
  createEmptyPlannerWorkingState,
  loadPlannerDraft,
  savePlannerDraft,
} from "./planner-persistence";

function createStorage(initial?: string) {
  const values = new Map(initial ? [[PLANNER_DRAFT_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const draft: PlannerDraft = {
  title: "安静书店", scene: "夜晚书店",
  character: { role: "店员", personality: ["自然"], speechStyle: ["轻声"] },
  sections: ["开场", "结束"].map((title, index) => ({
    id: `section_${index}`, title, text: "进来坐一会儿吧。", emotion: "平静",
    style: "轻声", pace: "缓慢", direction: "", soundSuggestions: "",
    pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" },
  })),
};

describe("planner working draft persistence", () => {
  it("persists newly added blank sections and an empty draft while the user edits", () => {
    const storage = createStorage();
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    for (const sections of [[{ ...draft.sections[0], title: "", text: "" }], []]) {
      const state = { ...createEmptyPlannerWorkingState(), brief, draftBrief: brief, draft: { ...draft, sections } };
      expect(savePlannerDraft(storage, state)).toEqual({ success: true });
      expect(loadPlannerDraft(storage)).toEqual({ state, restored: true });
    }
  });
  it("starts empty and can restore a hand-entered brief before generation", () => {
    const storage = createStorage();
    const empty = createEmptyPlannerWorkingState();
    expect(loadPlannerDraft(storage)).toEqual({ state: empty, restored: false });
    expect(savePlannerDraft(storage, empty)).toEqual({ success: true });
    const entered = { ...empty, brief: { ...empty.brief, role: "店员", notes: "少一点说教" } };
    expect(savePlannerDraft(storage, entered)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual({ state: entered, restored: true });
  });

  it("restores provider, editable draft and its original brief independently", () => {
    const storage = createStorage();
    const sourceBrief = PlannerBriefSchema.parse({ theme: "安静书店" });
    const state = {
      ...createEmptyPlannerWorkingState(),
      brief: { ...sourceBrief, theme: "雨夜便利店" },
      draftBrief: sourceBrief,
      provider: "api" as const,
      draft,
    };
    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual({ state, restored: true });
  });

  it("migrates a previous saved draft that did not separate its brief", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const storage = createStorage(JSON.stringify({ version: 1, brief, draft, provider: "ollama" }));
    expect(loadPlannerDraft(storage)).toEqual({
      state: { version: 1, brief, draftBrief: brief, draft, provider: "ollama" },
      restored: true,
    });
  });

  it("reports malformed, oversized and untrusted stored data without exposing it", () => {
    for (const raw of [
      "{ secret-broken-json",
      "x".repeat(200001),
      JSON.stringify({ ...createEmptyPlannerWorkingState(), provider: "unknown" }),
      JSON.stringify({ ...createEmptyPlannerWorkingState(), apiKey: "secret-api-key" }),
      JSON.stringify({ ...createEmptyPlannerWorkingState(), draft, draftBrief: null }),
    ]) {
      const result = loadPlannerDraft(createStorage(raw));
      expect(result.restored).toBe(false);
      expect(result.state).toEqual(createEmptyPlannerWorkingState());
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("secret");
    }
  });

  it("keeps the saved draft when a new save is invalid and reports storage failure", () => {
    const storage = createStorage();
    const valid = createEmptyPlannerWorkingState();
    savePlannerDraft(storage, valid);
    const before = storage.getItem(PLANNER_DRAFT_STORAGE_KEY);
    const invalid = { ...valid, draft, draftBrief: null };
    expect(savePlannerDraft(storage, invalid).success).toBe(false);
    expect(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)).toBe(before);
    const blockedStorage = {
      getItem: () => { throw new Error("secret read failure"); },
      setItem: () => { throw new Error("secret quota failure"); },
      removeItem: () => {},
    };
    expect(loadPlannerDraft(blockedStorage)).toMatchObject({ restored: false, error: expect.any(String) });
    expect(savePlannerDraft(blockedStorage, valid)).toEqual({ success: false, error: "策划草稿无法保存到此浏览器，请保留当前页面后重试。" });
  });
});
