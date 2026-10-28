import { describe, expect, it } from "vitest";
import { PlannerBriefSchema } from "./planner";
import { effectiveStoryboardStyle } from "./storyboard-style";
import { setProjectStoryboardStyle } from "./storyboard-style-project";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft } from "./planner-persistence";
import { adoptPlannerDraft, createInitialProjectLibrary, getCurrentLibraryEntry } from "./project-library";
import { CREATIVE_TEMPLATES, createTemplateDemo } from "./creative-templates";
import { demoProject } from "./mock-project";
import { switchSpeechWorkspace } from "./speech-workspace";
import { serializeProject, parseImportedProject } from "./project-persistence";
import { postProcessingProject } from "../../components/studio/audio-post-processing-test-fixture";
import { isClipVideoStoryboardCurrent } from "./video-plan";

describe("storyboard style persistence and compatibility", () => {
  it("keeps missing legacy preferences on character framing and locks even old template snapshots", () => {
    expect(effectiveStoryboardStyle()).toBe("character_framing");
    expect(effectiveStoryboardStyle({ storyboardStyle: "listener_pov" })).toBe("listener_pov");
    expect(effectiveStoryboardStyle({ storyboardStyle: "listener_pov", referenceTemplate: {} })).toBe("character_framing");
    expect(effectiveStoryboardStyle({ storyboardStyle: "character_framing", referenceTemplate: { storyboardStyle: "listener_pov" } })).toBe("listener_pov");
    expect(PlannerBriefSchema.safeParse({ theme: "书店", storyboardStyle: "third_person" }).success).toBe(false);
  });

  it("adopts a POV draft with source-bound directions into both workspaces and survives JSON", () => {
    const demo = createTemplateDemo(CREATIVE_TEMPLATES[0]);
    const brief = { ...demo.brief, storyboardStyle: "listener_pov" as const };
    delete brief.referenceTemplate;
    const library = adoptPlannerDraft(createInitialProjectLibrary(demoProject), brief, demo.draft);
    const entry = getCurrentLibraryEntry(library);
    expect(entry.plannerSource!.brief).toEqual(brief);
    expect(entry.project.videoPlan!.storyboardStyle).toBe("listener_pov");
    expect(entry.project.videoPlan!.templateDirections).toHaveLength(demo.draft.sections.filter(section => section.kind !== "silent").length);
    const clips = entry.project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []);
    expect(clips.every(clip => clip.performance?.segmentId)).toBe(true);
    expect(clips.filter(clip => clip.kind === "silent")).toHaveLength(demo.draft.sections.filter(section => section.kind === "silent").length);
    expect(entry.project.videoPlan!.referenceTemplate).toBeUndefined();
    for (const mode of ["short", "paragraph"] as const) expect(switchSpeechWorkspace(entry.project, mode).videoPlan?.storyboardStyle).toBe("listener_pov");
    const imported = parseImportedProject(serializeProject(entry.project));
    expect(imported.success).toBe(true);
    if (imported.success) expect(imported.project.videoPlan).toEqual(entry.project.videoPlan);
  });

  it("saves future selection independently from the draft used for adoption", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const demo = createTemplateDemo(CREATIVE_TEMPLATES[0]);
    const state = { ...createEmptyPlannerWorkingState(), brief: { ...demo.brief, storyboardStyle: "listener_pov" as const }, draftBrief: demo.brief, draft: demo.draft };
    expect(savePlannerDraft(storage, state, "style").success).toBe(true);
    expect(loadPlannerDraft(storage, "style").state).toEqual(state);
  });

  it("changes camera style without rewriting shots or adopted audio and restores validity when switched back", () => {
    const project = postProcessingProject();
    const before = structuredClone(project);
    const clipId = Object.keys(project.videoPlan!.shots)[0];
    expect(isClipVideoStoryboardCurrent(project, clipId)).toBe(true);
    const changed = setProjectStoryboardStyle(project, "listener_pov");
    expect(changed.timeline).toEqual(before.timeline);
    expect(changed.videoPlan!.shots).toEqual(before.videoPlan!.shots);
    expect(isClipVideoStoryboardCurrent(changed, clipId)).toBe(false);
    for (const mode of ["short", "paragraph"] as const) expect(switchSpeechWorkspace(changed, mode).videoPlan?.storyboardStyle).toBe("listener_pov");
    expect(isClipVideoStoryboardCurrent(setProjectStoryboardStyle(changed, "character_framing"), clipId)).toBe(true);
    expect(project).toEqual(before);
  });

  it("ignores a programmatic style change when the current project has a template", () => {
    const project = postProcessingProject();
    project.videoPlan!.referenceTemplate = CREATIVE_TEMPLATES[0];
    expect(setProjectStoryboardStyle(project, "listener_pov")).toBe(project);
  });
});
