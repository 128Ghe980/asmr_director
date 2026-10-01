import { describe, expect, it } from "vitest";

import { PlannerBriefSchema, type PlannerDraft } from "./planner";
import {
  PLANNER_DRAFT_STORAGE_KEY,
  createEmptyPlannerWorkingState,
  loadPlannerDraft,
  savePlannerDraft,
  type PlannerWorkingState,
} from "./planner-persistence";
import {
  createStoryboardSourceFingerprint,
  isStoryboardCurrent,
  type PlannerStoryboard,
} from "./storyboard";

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

function createPlannerState(): PlannerWorkingState {
  const sourceBrief = PlannerBriefSchema.parse({ theme: "安静书店" });
  return {
    ...createEmptyPlannerWorkingState(),
    brief: { ...sourceBrief, theme: "雨夜便利店" },
    draftBrief: sourceBrief,
    draft,
    provider: "api",
  };
}

function createStoryboard(): PlannerStoryboard {
  return {
    version: 1,
    title: "书店分镜",
    sourceFingerprint: createStoryboardSourceFingerprint(draft),
    shots: draft.sections.map((section, index) => ({
      id: `shot_${index}`,
      title: section.title,
      sourceSectionIds: [section.id],
      visual: "暖光下的书架和木桌。",
      action: "店员把书放到桌上。",
      camera: "固定近景。",
    })),
  };
}

function createH3Storyboard(): PlannerStoryboard {
  const storyboard = createStoryboard();
  return {
    ...storyboard,
    promptFormat: "minimax-h3",
    shots: storyboard.shots.map((shot) => ({
      ...shot,
      visual: "A quiet bookstore at night, warm light falling across wooden shelves.",
      action: "The clerk slowly places a book on the wooden table.",
      camera: "[Static shot] Medium close-up with shallow depth of field.",
    })),
  };
}

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

describe("planner storyboard persistence", () => {
  it("restores and resaves an earlier V1 workspace without a storyboard", () => {
    const state = createPlannerState();
    const storage = createStorage(JSON.stringify(state));

    const restored = loadPlannerDraft(storage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.storyboard).toBeUndefined();
    expect(savePlannerDraft(storage, restored.state)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual(restored);
  });

  it("restores a legacy V1 brief with no storyboard and keeps the migration saveable", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const storage = createStorage(JSON.stringify({ version: 1, brief, draft, provider: "api" }));
    const expected = { version: 1 as const, brief, draftBrief: brief, draft, provider: "api" as const };

    expect(loadPlannerDraft(storage)).toEqual({ state: expected, restored: true });
    expect(savePlannerDraft(storage, loadPlannerDraft(storage).state)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual({ state: expected, restored: true });
  });

  it("saves cleared storyboard and shot text through a browser refresh", () => {
    const storage = createStorage();
    const storyboard = createStoryboard();
    const state = {
      ...createPlannerState(),
      storyboard: {
        ...storyboard,
        title: "",
        shots: storyboard.shots.map((shot) => ({ ...shot, title: "", visual: "", action: "", camera: "" })),
      },
    };

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    expect(loadPlannerDraft(refreshedStorage)).toEqual({ state, restored: true });
    expect(isStoryboardCurrent(loadPlannerDraft(refreshedStorage).state.storyboard, draft)).toBe(true);
  });

  it("preserves the H3 prompt format and English prompts through saving and a browser refresh", () => {
    const state = { ...createPlannerState(), storyboard: createH3Storyboard() };
    const storage = createStorage();

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    const restored = loadPlannerDraft(refreshedStorage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.storyboard?.promptFormat).toBe("minimax-h3");
    expect(savePlannerDraft(refreshedStorage, restored.state)).toEqual({ success: true });
    expect(loadPlannerDraft(refreshedStorage)).toEqual(restored);
  });

  it("keeps the H3 prompt format when storyboard and shot text is temporarily cleared", () => {
    const storyboard = createH3Storyboard();
    const state = {
      ...createPlannerState(),
      storyboard: {
        ...storyboard,
        title: "",
        shots: storyboard.shots.map((shot) => ({ ...shot, title: "", visual: "", action: "", camera: "" })),
      },
    };
    const storage = createStorage();

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    const restored = loadPlannerDraft(refreshedStorage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.storyboard?.promptFormat).toBe("minimax-h3");
    expect(isStoryboardCurrent(restored.state.storyboard, restored.state.draft)).toBe(true);
  });

  it("restores legacy Chinese storyboard notes without adding an H3 format tag on resave", () => {
    const state = { ...createPlannerState(), storyboard: createStoryboard() };
    const storage = createStorage(JSON.stringify(state));

    const restored = loadPlannerDraft(storage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.storyboard).not.toHaveProperty("promptFormat");
    expect(savePlannerDraft(storage, restored.state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    expect(loadPlannerDraft(refreshedStorage)).toEqual(restored);
    expect(JSON.parse(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!).storyboard).not.toHaveProperty("promptFormat");
  });

  it.each([
    ["duplicate shot IDs", (board: PlannerStoryboard) => ({
      ...board,
      shots: board.shots.map((shot) => ({ ...shot, id: "same_shot" })),
    })],
    ["duplicate source section IDs", (board: PlannerStoryboard) => ({
      ...board,
      shots: board.shots.map((shot) => ({ ...shot, sourceSectionIds: [draft.sections[0].id] })),
    })],
    ["unknown storyboard fields", (board: PlannerStoryboard) => ({ ...board, unexpected: "untrusted" })],
    ["unknown shot fields", (board: PlannerStoryboard) => ({
      ...board,
      shots: [{ ...board.shots[0], unexpected: "untrusted" }, board.shots[1]],
    })],
    ["empty source mapping", (board: PlannerStoryboard) => ({
      ...board,
      shots: [{ ...board.shots[0], sourceSectionIds: [] }, board.shots[1]],
    })],
    ["a non-string action", (board: PlannerStoryboard) => ({
      ...board,
      shots: [{ ...board.shots[0], action: 42 }, board.shots[1]],
    })],
    ["a malformed shots collection", (board: PlannerStoryboard) => ({ ...board, shots: {} })],
    ["an unsupported prompt format", (board: PlannerStoryboard) => ({ ...board, promptFormat: "minimax-h4" })],
  ] as const)("discards only a storyboard with %s while preserving the working draft", (_, invalidate) => {
    const state = createPlannerState();
    const invalidState = { ...state, storyboard: invalidate(createStoryboard()) };
    const raw = JSON.stringify(invalidState);
    const storage = createStorage(raw);

    const restored = loadPlannerDraft(storage);
    expect(restored.restored).toBe(true);
    expect(restored.error).toBeUndefined();
    expect(restored.state).toMatchObject(state);
    expect(restored.state.storyboard).toBeUndefined();
    expect(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)).toBe(raw);

    expect(savePlannerDraft(storage, invalidState as unknown as PlannerWorkingState)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual({ state, restored: true });
    expect(JSON.parse(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!)).not.toHaveProperty("storyboard");
  });

  it("preserves an outdated storyboard and its exact source fingerprint after the draft changes", () => {
    const storyboard = createStoryboard();
    const editedDraft = {
      ...draft,
      sections: draft.sections.map((section, index) => index === 0
        ? { ...section, text: "雨停了，再坐一会儿吧。" }
        : section),
    };
    const state = { ...createPlannerState(), draft: editedDraft, storyboard };
    const storage = createStorage();

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const restored = loadPlannerDraft(storage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.storyboard?.sourceFingerprint).toBe(createStoryboardSourceFingerprint(draft));
    expect(isStoryboardCurrent(restored.state.storyboard, restored.state.draft)).toBe(false);
    expect(savePlannerDraft(storage, restored.state)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual(restored);
  });

  it.each([
    ["missing a section", (board: PlannerStoryboard) => ({ ...board, shots: [board.shots[0]] })],
    ["in a different source order", (board: PlannerStoryboard) => ({ ...board, shots: [...board.shots].reverse() })],
    ["referencing an unknown section", (board: PlannerStoryboard) => ({
      ...board,
      shots: [{ ...board.shots[0], sourceSectionIds: ["unknown_section"] }, board.shots[1]],
    })],
  ] as const)("keeps an editable storyboard %s but does not treat it as current", (_, remap) => {
    const storyboard = remap(createStoryboard());
    const state = { ...createPlannerState(), storyboard };
    const storage = createStorage();

    expect(storyboard.sourceFingerprint).toBe(createStoryboardSourceFingerprint(draft));
    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const restored = loadPlannerDraft(storage);
    expect(restored).toEqual({ state, restored: true });
    expect(isStoryboardCurrent(restored.state.storyboard, restored.state.draft)).toBe(false);
  });
});

describe("planner scene description persistence", () => {
  it.each([
    ["hand-edited multiline content", "雨夜的小书店。\n  暖光落在木桌上，窗外有细雨。  "],
    ["the maximum permitted length", "景".repeat(4000)],
  ])("preserves %s through saving and a browser refresh", (_, sceneDescription) => {
    const state = { ...createPlannerState(), storyboard: createH3Storyboard(), sceneDescription };
    const storage = createStorage();

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    const restored = loadPlannerDraft(refreshedStorage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state.sceneDescription).toBe(sceneDescription);
    expect(savePlannerDraft(refreshedStorage, restored.state)).toEqual({ success: true });
    expect(loadPlannerDraft(refreshedStorage)).toEqual(restored);
  });

  it.each(["", null])("persists a scene description cleared to %j", (sceneDescription) => {
    const state = { ...createPlannerState(), sceneDescription };
    const storage = createStorage();

    expect(savePlannerDraft(storage, state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    expect(loadPlannerDraft(refreshedStorage)).toEqual({ state, restored: true });
    expect(JSON.parse(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!).sceneDescription).toBe(sceneDescription);
  });

  it.each([
    ["overlong content", "景".repeat(4001)],
    ["a non-string scalar", 42],
    ["a malformed object", { text: "景物描写" }],
  ])("discards only scene descriptions containing %s", (_, sceneDescription) => {
    const state = { ...createPlannerState(), storyboard: createH3Storyboard() };
    const invalidState = { ...state, sceneDescription };
    const raw = JSON.stringify(invalidState);
    const storage = createStorage(raw);

    const restored = loadPlannerDraft(storage);
    expect(restored.restored).toBe(true);
    expect(restored.error).toBeUndefined();
    expect(restored.state).toMatchObject(state);
    expect(restored.state.sceneDescription).toBeUndefined();
    expect(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)).toBe(raw);
    expect(savePlannerDraft(storage, invalidState as unknown as PlannerWorkingState)).toEqual({ success: true });
    expect(loadPlannerDraft(storage)).toEqual({ state, restored: true });
    expect(JSON.parse(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!)).not.toHaveProperty("sceneDescription");
  });

  it("keeps new and earlier V1 workspaces free of an absent scene description", () => {
    const empty = createEmptyPlannerWorkingState();
    expect(empty).not.toHaveProperty("sceneDescription");
    const state = { ...createPlannerState(), storyboard: createStoryboard() };
    const storage = createStorage(JSON.stringify(state));

    const restored = loadPlannerDraft(storage);
    expect(restored).toEqual({ state, restored: true });
    expect(restored.state).not.toHaveProperty("sceneDescription");
    expect(savePlannerDraft(storage, restored.state)).toEqual({ success: true });
    const refreshedStorage = createStorage(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    expect(loadPlannerDraft(refreshedStorage)).toEqual(restored);
    expect(JSON.parse(storage.getItem(PLANNER_DRAFT_STORAGE_KEY)!)).not.toHaveProperty("sceneDescription");
  });
});
