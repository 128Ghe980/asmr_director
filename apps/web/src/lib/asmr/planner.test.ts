import { describe, expect, it } from "vitest";

import {
  PlannerBriefSchema,
  PlannerDraftSchema,
  compilePlannerDraft,
  createEmptyPlannerBrief,
  type PlannerDraft,
} from "./planner";
import { AsmrProjectSchema } from "./schema";
import { commitGenerationSuccess } from "./generation-project-state";

function draftFixture(): PlannerDraft {
  return {
    title: "深夜书店",
    scene: "下班后的一间安静书店",
    character: {
      role: "店员",
      personality: ["温柔", "自然"],
      speechStyle: ["轻声慢说"],
    },
    sections: [
      {
        id: "迎接 / 第一段",
        title: "迎接客人",
        text: "晚上好，进来坐一会儿吧。",
        emotion: "平静",
        style: "轻声",
        pace: "缓慢",
        direction: "靠近左侧，轻轻翻开书页。",
        soundSuggestions: "翻书声",
        pauseAfter: "long",
        position: { pan: -0.3, distance: "near", movement: "static" },
      },
      {
        id: "ending",
        title: "安静收尾",
        text: "这盏灯可以为你再留一会儿。",
        emotion: "温暖",
        style: "柔和",
        pace: "缓慢",
        direction: "安静地放下书。",
        soundSuggestions: "布面书封的轻响",
        pauseAfter: "medium",
        position: { pan: 0.2, distance: "mid", movement: "recede" },
      },
    ],
  };
}

describe("planner contracts", () => {
  it("fills optional brief preferences but requires a usable theme", () => {
    expect(PlannerBriefSchema.parse({ theme: "  深夜书店  " })).toEqual({
      theme: "深夜书店",
      durationSeconds: 300,
      language: "zh",
      role: "",
      style: "温柔自然",
      notes: "",
    });
    expect(createEmptyPlannerBrief().theme).toBe("");
    for (const input of [
      { theme: " " },
      { theme: "书店", durationSeconds: 59 },
      { theme: "书店", durationSeconds: 601 },
      { theme: "书店", language: "en" },
      { theme: "a".repeat(2001) },
      { theme: "书店", secret: "should not persist" },
    ]) {
      expect(PlannerBriefSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects duplicate section ids, missing directions and invalid positions", () => {
    const valid = draftFixture();
    expect(PlannerDraftSchema.safeParse(valid).success).toBe(true);
    const duplicate = structuredClone(valid);
    duplicate.sections[1].id = duplicate.sections[0].id;
    expect(PlannerDraftSchema.safeParse(duplicate).success).toBe(false);
    const invalidPosition = structuredClone(valid);
    invalidPosition.sections[0].position.pan = 2;
    expect(PlannerDraftSchema.safeParse(invalidPosition).success).toBe(false);
    const missingDirection = JSON.parse(JSON.stringify(valid));
    delete missingDirection.sections[0].direction;
    expect(PlannerDraftSchema.safeParse(missingDirection).success).toBe(false);
    expect(PlannerDraftSchema.safeParse({ ...valid, sections: [valid.sections[0]] }).success).toBe(true);
    expect(PlannerDraftSchema.safeParse({ ...valid, sections: [] }).success).toBe(false);
    expect(PlannerDraftSchema.safeParse({ ...valid, instructions: "hidden" }).success).toBe(false);
  });

  it("bounds individual and combined text sizes", () => {
    const valid = draftFixture();
    const oversizedSection = structuredClone(valid);
    oversizedSection.sections[0].text = "字".repeat(3001);
    expect(PlannerDraftSchema.safeParse(oversizedSection).success).toBe(false);
    const oversizedDraft = {
      ...valid,
      sections: Array.from({ length: 5 }, (_, index) => ({
        ...valid.sections[0], id: `section_${index}`, text: "字".repeat(3000),
      })),
    };
    expect(PlannerDraftSchema.safeParse(oversizedDraft).success).toBe(false);
  });
});

describe("planner compilation", () => {
  it("keeps the selected six-second pause after generated speech is shorter than the planning estimate", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const compiled = compilePlannerDraft(brief, draftFixture(), "planned_pause");
    const [estimated, nextEstimated] = compiled.timeline.tracks[0].clips;
    const spokenDuration = 2;
    expect(estimated.duration).toBeGreaterThan(spokenDuration);
    const generated = commitGenerationSuccess(compiled, estimated.id, {
      assetId: "shorter_voice", uri: "asset://clip/shorter_voice", duration: spokenDuration,
    }, { fitVoiceTiming: true });
    const [first, second] = generated.timeline.tracks[0].clips;
    expect(first).toMatchObject({ duration: spokenDuration, pause_after: 6, asset: { duration: spokenDuration } });
    expect(second.start - first.start - spokenDuration).toBe(6);
    expect(second.start).toBeLessThan(nextEstimated.start);
    expect(AsmrProjectSchema.safeParse(generated).success).toBe(true);
    expect(compiled.timeline.tracks[0].clips[0].duration).toBe(estimated.duration);
  });

  it("creates an editable valid pending project and keeps directions out of speech", () => {
    const brief = PlannerBriefSchema.parse({ theme: "深夜书店" });
    const draft = draftFixture();
    const original = structuredClone(draft);
    const compiled = compilePlannerDraft(brief, draft, "asmr_planner_01");

    expect(AsmrProjectSchema.safeParse(compiled).success).toBe(true);
    expect(compiled).toMatchObject({
      project_id: "asmr_planner_01", title: draft.title, language: "zh", status: "draft",
      scene: { name: draft.scene },
      character: { role: "店员", speech_style: ["轻声慢说"] },
    });
    expect(compiled.timeline.tracks.map((track) => track.track_type)).toEqual([
      "voice", "breath", "sfx", "ambience", "post_processing",
    ]);
    const voice = compiled.timeline.tracks[0];
    expect(voice.clips.map((clip) => clip.type === "voice" && clip.text)).toEqual(draft.sections.map((section) => section.text));
    expect(voice.clips[0].position).toEqual(draft.sections[0].position);
    for (const clip of voice.clips) {
      expect(clip.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(clip.generation).toMatchObject({ status: "asset_pending", retry_count: 0, error: null });
      expect(clip.asset).toEqual({ asset_id: null, uri: null, duration: null });
    }
    expect(new Set(voice.clips.map((clip) => clip.id)).size).toBe(2);
    expect(compiled.timeline.tracks.slice(1).every((track) => track.clips.length === 0)).toBe(true);
    expect(compiled.exports.every((entry) => entry.status === "not_started" && entry.uri === null)).toBe(true);
    expect(JSON.stringify(compiled)).not.toContain("靠近左侧");
    expect(draft).toEqual(original);
    expect(compilePlannerDraft(brief, draft, "asmr_planner_01")).toEqual(compiled);
  });

  it("uses positive estimated durations and explicit pauses without stretching to the target", () => {
    const draft = draftFixture();
    const brief = PlannerBriefSchema.parse({ theme: "书店", durationSeconds: 600 });
    const compiled = compilePlannerDraft(brief, draft, "short_draft");
    const [first, second] = compiled.timeline.tracks[0].clips;
    expect(first.start).toBe(0);
    expect(first.duration).toBeGreaterThan(0);
    expect(second.start).toBeGreaterThan(first.start + first.duration);
    expect(compiled.duration).toBeGreaterThanOrEqual(second.start + second.duration);
    expect(compiled.duration).toBeLessThan(60);
    expect(compiled.emotion_curve).toHaveLength(2);
  });

  it("keeps every word when estimated speech exceeds the requested length", () => {
    const draft = draftFixture();
    draft.sections[0].text = "这是一段很长的陪伴文案。".repeat(100);
    const brief = PlannerBriefSchema.parse({ theme: "书店", durationSeconds: 60 });
    const compiled = compilePlannerDraft(brief, draft, "long_draft");
    expect(compiled.duration).toBeGreaterThan(60);
    expect(compiled.timeline.tracks[0].clips[0]).toMatchObject({ text: draft.sections[0].text });
    expect(AsmrProjectSchema.safeParse(compiled).success).toBe(true);
  });

  it("rejects invalid compilation input and unsafe project identifiers", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    expect(() => compilePlannerDraft(createEmptyPlannerBrief(), draftFixture(), "test")).toThrow();
    expect(() => compilePlannerDraft(brief, draftFixture(), "../../unsafe")).toThrow();
  });
});
