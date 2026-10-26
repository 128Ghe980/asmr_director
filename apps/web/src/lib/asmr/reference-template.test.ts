import { describe, expect, it, vi } from "vitest";
import { CreativeTemplateSchema, getMatchingTemplateDirections } from "./reference-template";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { PlannerBriefSchema, type PlannerDraft } from "./planner";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft } from "./planner-persistence";
import { adoptPlannerDraft, createInitialProjectLibrary, createProjectRevision, duplicateLibraryProject, loadProjectLibrary, saveProjectLibrary } from "./project-library";
import { demoProject } from "./mock-project";
import { serializeProject } from "./project-persistence";
import { AsmrProjectSchema } from "./schema";
import { expandPlannerGeneratedDraft, PlannerGeneratedDraftSchema } from "./planner-semantic";
import { createStoryboardGenerationContextFingerprint, createStoryboardScriptContext } from "./storyboard-context";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { getStoryboardReviewFingerprint } from "./storyboard-review";
import { runPlanner } from "./planner-provider";
import { generateSceneDescription } from "./scene-description-service";
import { CREATIVE_TEMPLATES, createTemplateDemo } from "./creative-templates";

const brief = PlannerBriefSchema.parse({ theme: "被禁止的安静书店", referenceTemplate: referenceTemplateFixture });
const draft: PlannerDraft = {
  title: "安静书店", scene: "雨夜书店的柜台前。", character: { role: "店员", personality: ["谨慎"], speechStyle: ["小声"] },
  sections: ["先看看这本红色的书。", "红色的放好，再拿蓝色的。"].map((text, index) => ({
    id: `unit_${index}`, title: `展示${index}`, text, emotion: "平静", style: "轻声", pace: "缓慢",
    direction: index ? "把红书放在台面再拿蓝书，结尾手持蓝书。" : "从台面拿起红书到胸前，结尾手持红书。", soundSuggestions: "轻声",
    pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" },
  })),
};
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function adoptedProject() {
  const library = adoptPlannerDraft(createInitialProjectLibrary(demoProject), brief, draft, new Date("2026-10-26T00:00:00Z"));
  return { library, entry: library.projects.find(entry => entry.projectId === library.currentProjectId)! };
}

describe("reference template contract and source-bound directions", () => {
  const directions = [
    { text: "这是第一件商品。先给你看看。", direction: "取出红色用品，举到胸前，结尾仍拿着。", soundSuggestions: "轻声" },
    { text: "现在把红色的放下。", direction: "放回桌上，双手空出。", soundSuggestions: "" },
    { text: "再来看这只蓝色瓶子。", direction: "拿起蓝瓶，红色用品留桌上。", soundSuggestions: "" },
  ];
  it("bounds templates, rejects duplicate beats and keeps source provenance", () => {
    expect(CreativeTemplateSchema.parse(referenceTemplateFixture)).toEqual(referenceTemplateFixture);
    expect(CreativeTemplateSchema.safeParse({ ...referenceTemplateFixture, beats: [referenceTemplateFixture.beats[0], referenceTemplateFixture.beats[0]] }).success).toBe(false);
    expect(CreativeTemplateSchema.safeParse({ ...referenceTemplateFixture, creativePrompt: " " }).success).toBe(false);
    expect(CreativeTemplateSchema.safeParse({ ...referenceTemplateFixture, source: { ...referenceTemplateFixture.source, durationSeconds: 0 } }).success).toBe(false);
  });
  it("follows unique exact, split and merged text without relying on clip index", () => {
    expect(getMatchingTemplateDirections(directions, directions[2].text)).toEqual([directions[2]]);
    expect(getMatchingTemplateDirections(directions, "这是第一件商品。")).toEqual([directions[0]]);
    expect(getMatchingTemplateDirections(directions, directions[1].text + directions[2].text)).toEqual(directions.slice(1));
    expect(getMatchingTemplateDirections(directions, "已经换成绿色玻璃瓶。")).toEqual([]);
    expect(getMatchingTemplateDirections(directions, "看看")).toEqual([]);
  });
  it("does not apply ambiguous repeated words or directions to an edited passage", () => {
    expect(getMatchingTemplateDirections([...directions, { ...directions[0], direction: "不同的动作" }], directions[0].text)).toEqual([]);
    expect(getMatchingTemplateDirections(directions, directions[0].text + "但不要把东西拿出来。")).toEqual([]);
    expect(getMatchingTemplateDirections(undefined, directions[0].text)).toEqual([]);
  });
});

describe("reference template survives the complete planning-to-storyboard path", () => {
  it("adopts the curated fourteen-line example with all source-bound shot directions intact", () => {
    const example = createTemplateDemo(CREATIVE_TEMPLATES[0]);
    const library = adoptPlannerDraft(createInitialProjectLibrary(demoProject), example.brief, example.draft,
      new Date("2026-10-26T00:01:00Z"), undefined, example.sceneDescription);
    const project = library.projects.find(entry => entry.projectId === library.currentProjectId)!.project;
    expect(project.videoPlan!.referenceTemplate).toEqual(CREATIVE_TEMPLATES[0]);
    expect(project.videoPlan!.templateDirections).toHaveLength(14);
    const voices = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    const context = createStoryboardScriptContext(project, voices[0].id);
    expect(context.scriptOrder.map(item => item.directorNotes?.[0].direction)).toEqual(example.draft.sections.map(section => section.direction));
    expect(context.scriptOrder.at(-1)!.directorNotes![0].direction).toContain("A 和 B");
    expect(AsmrProjectSchema.parse(JSON.parse(serializeProject(project))).videoPlan).toEqual(project.videoPlan);
  });
  it("persists an editable cleared prompt while preserving the draft's strict template snapshot", () => {
    const local = storage(), state = { ...createEmptyPlannerWorkingState(), brief: { ...brief, referenceTemplate: { ...referenceTemplateFixture, creativePrompt: "", sceneDescription: "", storyboardRules: "" } }, draftBrief: brief, draft };
    expect(savePlannerDraft(local, state, "reference_project")).toEqual({ success: true });
    expect(loadPlannerDraft(local, "reference_project").state).toEqual(state);
    expect(PlannerBriefSchema.safeParse(state.brief).success).toBe(false);
    expect(loadPlannerDraft(local, "other_project").state.brief.referenceTemplate).toBeUndefined();
  });
  it("adopts template and per-line directions without a separately generated scene, including both speech workspaces and JSON", () => {
    const { library, entry } = adoptedProject();
    expect(entry.plannerSource!.brief.referenceTemplate).toEqual(referenceTemplateFixture);
    expect(entry.project.videoPlan!.sceneDescription).toBe(draft.scene);
    expect(entry.project.videoPlan!.referenceTemplate).toEqual(referenceTemplateFixture);
    expect(entry.project.videoPlan!.templateDirections).toEqual(draft.sections.map(({ text, direction, soundSuggestions }) => ({ text, direction, soundSuggestions })));
    expect(entry.project.speechWorkspace!.short.videoPlan).toEqual(entry.project.videoPlan);
    expect(entry.project.speechWorkspace!.paragraph.videoPlan).toEqual(entry.project.videoPlan);
    const parsed = AsmrProjectSchema.parse(JSON.parse(serializeProject(entry.project)));
    expect(parsed.videoPlan).toEqual(entry.project.videoPlan);
    expect(JSON.stringify(parsed.timeline)).not.toContain("templateDirections");
    expect(JSON.stringify(parsed.timeline)).not.toContain(draft.sections[0].direction);
    const revision = createProjectRevision(library, entry.projectId), duplicate = duplicateLibraryProject(revision, entry.projectId);
    const local = storage();
    saveProjectLibrary(local, duplicate);
    const restored = loadProjectLibrary(local, demoProject);
    expect(restored.projects.find(item => item.projectId === entry.projectId)!.revisions[0].project.videoPlan).toEqual(entry.project.videoPlan);
    expect(restored.projects.find(item => item.projectId === duplicate.currentProjectId)!.project.videoPlan).toEqual(entry.project.videoPlan);
  });
  it("keeps per-unit directions distinct when compact groups share voice metadata", () => {
    const { text, pauseAfter, ...shared } = draft.sections[0];
    const generated = PlannerGeneratedDraftSchema.parse({ title: draft.title, scene: draft.scene, character: draft.character,
      groups: [{ ...shared, units: [{ text, pauseAfter }, { text: draft.sections[1].text, pauseAfter, direction: draft.sections[1].direction, soundSuggestions: "" }] }] });
    const expanded = expandPlannerGeneratedDraft(generated);
    expect(expanded.sections.map(section => section.direction)).toEqual(draft.sections.map(section => section.direction));
    expect(expanded.sections.map(section => section.soundSuggestions)).toEqual(["轻声", ""]);
  });
  it("binds matching directions to reordered speech and invalidates only relevant saved source identities", () => {
    const { entry } = adoptedProject(), project = entry.project;
    const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    for (const [index, clip] of clips.entries()) { clip.generation.status = "asset_generated"; clip.asset = { asset_id: `reference_${index}`, uri: `asset://clip/reference_${index}`, duration: 3 }; }
    clips.reverse();
    const context = createStoryboardScriptContext(project, clips[0].id);
    expect(context.referenceTemplate!.storyboardRules).toBe(referenceTemplateFixture.storyboardRules);
    expect(context.scriptOrder[0].directorNotes![0].direction).toBe(draft.sections[1].direction);
    const currentSource = createClipVideoSourceFingerprint(project, clips[0].id), otherSource = createClipVideoSourceFingerprint(project, clips[1].id);
    const generation = createStoryboardGenerationContextFingerprint(project), review = getStoryboardReviewFingerprint(project);
    project.videoPlan!.templateDirections![1].direction += "蓝书保持竖立。";
    expect(createClipVideoSourceFingerprint(project, clips[0].id)).not.toBe(currentSource);
    expect(createClipVideoSourceFingerprint(project, clips[1].id)).toBe(otherSource);
    expect(createStoryboardGenerationContextFingerprint(project)).not.toBe(generation);
    expect(getStoryboardReviewFingerprint(project)).not.toBe(review);
    const previous = createClipVideoSourceFingerprint(project, clips[1].id);
    project.videoPlan!.referenceTemplate!.storyboardRules += "保持台面位置。";
    expect(createClipVideoSourceFingerprint(project, clips[1].id)).not.toBe(previous);
    clips[0].text = "现在改成站在门口，双手不拿任何东西。";
    expect(createStoryboardScriptContext(project, clips[0].id).scriptOrder[0]).not.toHaveProperty("directorNotes");
  });
  it("uses template context for generation, rewriting and scene planning without changing their output contracts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(draft) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(draft.sections[0]) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ sceneDescription: "雨夜书店里，店员低声向来客展示书籍。" }) } }));
    await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    await runPlanner({ action: "rewrite", provider: "ollama", brief, draft, sectionId: draft.sections[0].id, instruction: "保持道具顺序" }, { env: {}, fetchImpl });
    await generateSceneDescription({ provider: "ollama", draft, instruction: "", referenceTemplate: referenceTemplateFixture }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) {
      const content = JSON.parse(call[1]!.body as string).messages[1].content as string;
      expect(content).toContain(referenceTemplateFixture.storyboardRules);
      expect(content.split(referenceTemplateFixture.storyboardRules)).toHaveLength(2);
    }
    const generation = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(generation.messages[0].content).toContain("逐单元填写具体 direction");
    expect(generation.format.properties.groups.items.properties.units.items.properties.direction).toBeDefined();
    expect(generation.format.properties.groups.items.properties.units.items.required).toContain("direction");
    expect(generation.messages[1].content).not.toContain("不要每句都重复导演字段");
    expect(generation.messages[1].content).not.toContain("导演说明和音效建议仅在需要时填写");
  });
  it("repairs a template response that only supplies group directions instead of per-unit intentions", async () => {
    const { text, pauseAfter, ...shared } = draft.sections[0];
    const missing = { title: draft.title, scene: draft.scene, character: draft.character, groups: [{ ...shared, units: [{ text, pauseAfter }] }] };
    const complete = { ...missing, groups: [{ ...shared, units: [{ text, pauseAfter, direction: shared.direction }] }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(missing) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(complete) } }));
    const result = await runPlanner({ action: "generate", provider: "ollama", brief }, { env: {}, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("draft" in result && result.draft.sections[0].direction).toBe(shared.direction);
    const repair = JSON.parse(fetchImpl.mock.calls[1][1]!.body as string);
    expect(repair.messages.at(-1).content).toContain("不能只继承组级导演说明");
  });
});
