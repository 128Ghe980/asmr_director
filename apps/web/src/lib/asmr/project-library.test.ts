import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import { PlannerBriefSchema, type PlannerDraft } from "./planner";
import {
  MAX_PROJECT_REVISIONS,
  PROJECT_LIBRARY_STORAGE_KEY,
  adoptPlannerDraft,
  createInitialProjectLibrary,
  createLibraryProject,
  createProjectRevision,
  deleteLibraryProject,
  duplicateLibraryProject,
  loadProjectLibrary,
  replaceLibraryProject,
  restoreProjectRevision,
  selectLibraryProject,
  setLibraryProjectMixFingerprint,
  saveProjectLibrary,
  updateLibraryProject,
} from "./project-library";
import { PROJECT_STORAGE_KEY, serializeProject } from "./project-persistence";
import type { AsmrProject, TimelineClip } from "./schema";
import { createStoryboardSourceFingerprint, type PlannerStoryboard } from "./storyboard";
import { createClipVideoSourceFingerprint, type ClipVideoStoryboard } from "./video-plan";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const firstTime = new Date("2026-07-12T01:02:03.000Z");
const secondTime = new Date("2026-07-12T02:03:04.000Z");

function plannerFixture(): PlannerDraft {
  return {
    title: "深夜书店", scene: "安静的小书店",
    character: { role: "店员", personality: ["自然"], speechStyle: ["轻声"] },
    sections: ["迎接客人", "安静收尾"].map((title, index) => ({
      id: `section_${index}`, title, text: "来坐一会儿吧。", emotion: "温暖",
      style: "柔和", pace: "缓慢", direction: "在此轻轻翻书", soundSuggestions: "书页声",
      pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" },
    })),
  };
}

function storyboardFixture(draft: PlannerDraft): PlannerStoryboard {
  return {
    version: 1, title: "书店画面", sourceFingerprint: createStoryboardSourceFingerprint(draft),
    shots: [{ id: "shot_1", title: "迎接", sourceSectionIds: draft.sections.map((section) => section.id), visual: "独有画面：灯光照着书架。", action: "把书放在桌上。", camera: "固定近景。" }],
  };
}

function projectWithAcceptedAudio(project: AsmrProject): AsmrProject {
  const generated = structuredClone(project);
  const clip = generated.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: "preserved_voice", uri: "asset://clip/preserved_voice", duration: 2 };
  return generated;
}

function videoShotFixture(project: AsmrProject): ClipVideoStoryboard {
  const clip = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
  return {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: "preserved_voice", uri: "asset://clip/preserved_voice", duration: 2 },
    title: "书店近景", visual: "Warm light falls across the wooden bookshelves.",
    action: "The clerk slowly places a book on the table.", camera: "[Static shot] Medium close-up.",
  };
}

describe("adopting planner drafts", () => {
  it("adopts optional storyboard metadata as the fifth argument without adding visual notes to audio JSON", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const before = structuredClone(initial);
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const storyboard = storyboardFixture(draft);
    const adopted = adoptPlannerDraft(initial, brief, draft, secondTime, storyboard);
    const entry = adopted.projects[1];
    expect(initial).toEqual(before);
    expect(entry.updatedAt).toBe(secondTime.toISOString());
    expect(entry.plannerSource).toEqual({ brief, draft, storyboard });
    expect(entry.plannerSource?.storyboard).not.toBe(storyboard);
    expect(entry.plannerSource?.storyboard?.shots[0]).not.toBe(storyboard.shots[0]);
    storyboard.shots[0].visual = "传入对象后来被修改";
    expect(entry.plannerSource?.storyboard?.shots[0].visual).toBe("独有画面：灯光照着书架。");
    expect(entry.project.timeline.tracks[0].clips).toHaveLength(draft.sections.length);
    const audioJson = serializeProject(entry.project);
    expect(audioJson).not.toMatch(/storyboard|sourceFingerprint|sourceSectionIds|独有画面/);
    expect(entry.project.timeline.tracks[0].clips.map((clip) => clip.type === "voice" ? clip.text : "")).toEqual(draft.sections.map((section) => section.text));
  });

  it.each(["雨夜书店，暖光落在木桌上。", ""])("adopts scene description %j as the sixth argument and keeps it out of audio clips", (sceneDescription) => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const before = structuredClone(initial);
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const storyboard = storyboardFixture(draft);
    const adopted = adoptPlannerDraft(initial, brief, draft, secondTime, storyboard, sceneDescription);
    const entry = adopted.projects[1];
    const withoutScene = adoptPlannerDraft(initial, brief, draft, secondTime, storyboard).projects[1];

    expect(initial).toEqual(before);
    expect(entry.updatedAt).toBe(secondTime.toISOString());
    expect(entry.plannerSource).toEqual({ brief, draft, storyboard, sceneDescription });
    expect(entry.project.videoPlan).toEqual({ version: 1, sceneDescription, shots: {} });
    expect(entry.project.timeline).toEqual(withoutScene.project.timeline);
    expect(withoutScene.project).not.toHaveProperty("videoPlan");
    expect(withoutScene.plannerSource).not.toHaveProperty("sceneDescription");
    expect(JSON.parse(serializeProject(entry.project)).videoPlan.sceneDescription).toBe(sceneDescription);
    expect(serializeProject(entry.project)).not.toMatch(/plannerSource|独有画面/);
  });

  it("preserves video plans and clip prompts through metadata-only versions, duplication, storage and restore", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const sceneDescription = "原来的全局书店场景。";
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, secondTime, undefined, sceneDescription);
    const projectId = library.currentProjectId;
    const generated = projectWithAcceptedAudio(library.projects[1].project);
    const shot = videoShotFixture(generated);
    generated.videoPlan!.shots[shot.clipId] = shot;
    const originalPlan = structuredClone(generated.videoPlan!);
    library = updateLibraryProject(library, generated, secondTime);
    library = createProjectRevision(library, projectId, secondTime, "原始视频计划");
    const originalRevisionId = library.projects[1].revisions[0].revisionId;
    const editedPlan = {
      ...originalPlan,
      sceneDescription: "后来编辑的全局场景。",
      shots: { [shot.clipId]: { ...shot, visual: "", camera: "[Push in] Slowly move toward the speaker." } },
    };
    library = updateLibraryProject(library, { ...generated, videoPlan: editedPlan }, secondTime);
    library = createProjectRevision(library, projectId, secondTime, "只改视频说明");

    expect(library.projects[1].revisions).toHaveLength(2);
    expect(library.projects[1].revisions[0].project.timeline).toEqual(library.projects[1].revisions[1].project.timeline);
    expect(library.projects[1].revisions[0].project.videoPlan).toEqual(originalPlan);
    expect(library.projects[1].revisions[1].project.videoPlan).toEqual(editedPlan);
    library = duplicateLibraryProject(library, projectId, secondTime);
    expect(library.projects[2].project.videoPlan).toEqual(editedPlan);
    expect(library.projects[2].project.videoPlan).not.toBe(library.projects[1].project.videoPlan);
    expect(library.projects[2].project.videoPlan?.shots[shot.clipId]).not.toBe(library.projects[1].project.videoPlan?.shots[shot.clipId]);
    const storage = createStorage();
    saveProjectLibrary(storage, library);
    const reloaded = loadProjectLibrary(storage, demoProject, secondTime);
    const restored = restoreProjectRevision(reloaded, projectId, originalRevisionId, secondTime);

    expect(restored.projects[1].project.videoPlan).toEqual(originalPlan);
    expect(restored.projects[2].project.videoPlan).toEqual(editedPlan);
    expect(restored.projects[1].plannerSource).toEqual({ brief, draft, sceneDescription });
    expect(restored.projects[2].plannerSource).toEqual({ brief, draft, sceneDescription });
    expect(restored.projects[1].project.timeline).toEqual(generated.timeline);
    expect(restored.projects[2].project.timeline.tracks[0].clips[0].asset.uri).toBe("asset://clip/preserved_voice");
    expect(restored.projects[1].revisions[1].project.videoPlan).toEqual(editedPlan);
  });

  it.each(["an oversized scene", "a mismatched clip mapping"] as const)("drops video plans containing %s independently from audio and planning source", (damage) => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const sceneDescription = "应保留的策划场景。";
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, secondTime, undefined, sceneDescription);
    const generated = projectWithAcceptedAudio(library.projects[1].project);
    const shot = videoShotFixture(generated);
    generated.videoPlan!.shots[shot.clipId] = shot;
    library = updateLibraryProject(library, generated, secondTime);
    library = createProjectRevision(library, generated.project_id, secondTime, "已有音频与视频说明");
    const audioOnly = structuredClone(generated);
    delete audioOnly.videoPlan;
    const raw = structuredClone(library);
    raw.projects[1].project.videoPlan = damage === "an oversized scene"
      ? { ...generated.videoPlan!, sceneDescription: "景".repeat(4001) }
      : { ...generated.videoPlan!, shots: { [shot.clipId]: { ...shot, clipId: "foreign_clip" } } };
    raw.projects[1].revisions[0].project.videoPlan = {
      ...generated.videoPlan!,
      shots: { [shot.clipId]: { ...shot, audio: { ...shot.audio!, uri: "asset://clip/another_voice" } } },
    };
    const storage = createStorage({ [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify(raw) });
    const restored = loadProjectLibrary(storage, demoProject, secondTime);

    expect(restored.projects[1].project).toEqual(audioOnly);
    expect(restored.projects[1].plannerSource).toEqual({ brief, draft, sceneDescription });
    expect(restored.projects[1].revisions).toHaveLength(1);
    expect(restored.projects[1].revisions[0].project).toEqual(audioOnly);
    expect(restored.projects[1].revisions[0].plannerSource).toEqual({ brief, draft, sceneDescription });
    const saved = JSON.parse(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!);
    expect(saved.projects[1].project).not.toHaveProperty("videoPlan");
    expect(saved.projects[1].revisions[0].project).not.toHaveProperty("videoPlan");
    const revisionRestored = restoreProjectRevision(restored, generated.project_id, restored.projects[1].revisions[0].revisionId, secondTime);
    expect(revisionRestored.projects[1].project.timeline.tracks[0].clips[0].asset.uri).toBe("asset://clip/preserved_voice");
    expect(revisionRestored.projects[1].project.videoPlan).toBeUndefined();
  });

  it("versions storyboard-only edits and preserves each version through duplication, storage and restore", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const storyboard = storyboardFixture(draft);
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, secondTime, storyboard);
    const projectId = library.currentProjectId;
    library = createProjectRevision(library, projectId, secondTime, "完整分镜");
    const originalRevision = library.projects[1].revisions[0];
    const edited = { ...storyboard, shots: storyboard.shots.map((shot) => ({ ...shot, visual: "", camera: "我修改的镜头运动。" })) };
    library = { ...library, projects: library.projects.map((entry) => entry.projectId === projectId ? { ...entry, plannerSource: { brief, draft, storyboard: edited } } : entry) };
    library = createProjectRevision(library, projectId, secondTime, "只改分镜");
    expect(library.projects[1].revisions).toHaveLength(2);
    expect(library.projects[1].revisions[0].project).toEqual(library.projects[1].revisions[1].project);
    expect(library.projects[1].revisions[0].plannerSource?.storyboard).toEqual(storyboard);
    expect(library.projects[1].revisions[1].plannerSource?.storyboard).toEqual(edited);

    library = updateLibraryProject(library, library.projects[1].project, secondTime);
    library = duplicateLibraryProject(library, projectId, secondTime);
    expect(library.projects[2].plannerSource?.storyboard).toEqual(edited);
    expect(library.projects[2].plannerSource?.storyboard).not.toBe(library.projects[1].plannerSource?.storyboard);
    const storage = createStorage();
    saveProjectLibrary(storage, library);
    const reloaded = loadProjectLibrary(storage, demoProject, secondTime);
    const restored = restoreProjectRevision(reloaded, projectId, originalRevision.revisionId, secondTime);
    expect(restored.projects[1].plannerSource).toEqual({ brief, draft, storyboard });
    expect(restored.projects[2].plannerSource).toEqual({ brief, draft, storyboard: edited });
    expect(restored.projects[1].revisions[1].plannerSource?.storyboard).toEqual(edited);
    expect(serializeProject(restored.projects[1].project)).not.toContain("storyboard");
  });

  it("drops damaged storyboard metadata independently from current and revision scripts and keeps adopted audio", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const storyboard = storyboardFixture(draft);
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, secondTime, storyboard);
    const entry = library.projects[1];
    const generatedProject = structuredClone(entry.project);
    const generatedClip = generatedProject.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
    generatedClip.generation.status = "asset_generated";
    generatedClip.asset = { asset_id: "preserved_voice", uri: "asset://clip/preserved_voice", duration: 2 };
    library = updateLibraryProject(library, generatedProject, secondTime);
    library = createProjectRevision(library, entry.projectId, secondTime, "已有音频与分镜");
    const expectedAudioJson = serializeProject(library.projects[1].project);
    const raw = structuredClone(library);
    const source = raw.projects[1].plannerSource!;
    source.storyboard = { ...storyboard, shots: [] };
    raw.projects[1].revisions[0].plannerSource!.storyboard = { ...storyboard, shots: [storyboard.shots[0], storyboard.shots[0]] };
    const storage = createStorage({ [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify(raw) });
    const restored = loadProjectLibrary(storage, demoProject, secondTime);
    expect(restored.projects[1].plannerSource).toEqual({ brief, draft, storyboard: undefined });
    expect(restored.projects[1].revisions[0].plannerSource).toEqual({ brief, draft, storyboard: undefined });
    expect(serializeProject(restored.projects[1].project)).toBe(expectedAudioJson);
    expect(restored.projects[1].project.timeline.tracks[0].clips[0].asset.uri).toBe("asset://clip/preserved_voice");
    expect(JSON.parse(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!).projects[1].plannerSource).toEqual({ brief, draft });
    expect(serializeProject(restored.projects[1].project)).not.toMatch(/storyboard|sourceFingerprint|sourceSectionIds/);
    const revisionRestored = restoreProjectRevision(restored, entry.projectId, restored.projects[1].revisions[0].revisionId, secondTime);
    expect(revisionRestored.projects[1].plannerSource?.draft).toEqual(draft);
    expect(revisionRestored.projects[1].project.timeline.tracks[0].clips[0].asset.uri).toBe("asset://clip/preserved_voice");
  });

  it("protects the current project, creates a new project and retains the planning source", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const before = structuredClone(initial);
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const adopted = adoptPlannerDraft(initial, brief, draft, secondTime);

    expect(initial).toEqual(before);
    expect(adopted.projects).toHaveLength(2);
    expect(adopted.currentProjectId).not.toBe(initial.currentProjectId);
    expect(adopted.projects[0].project).toEqual(demoProject);
    expect(adopted.projects[0].revisions.at(-1)).toMatchObject({ label: "采用策划前", project: demoProject });
    expect(adopted.projects[1].plannerSource).toEqual({ brief, draft });
    expect(adopted.projects[1].plannerSource?.draft).not.toBe(draft);
    expect(adopted.projects[1].project.title).toBe("深夜书店");
    expect(serializeProject(adopted.projects[1].project)).not.toContain("plannerSource");
    expect(serializeProject(adopted.projects[1].project)).not.toContain("在此轻轻翻书");
  });

  it("allocates collision-safe ids when adopting repeatedly at the same instant", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    let library = createInitialProjectLibrary(demoProject, firstTime);
    library = adoptPlannerDraft(library, brief, plannerFixture(), secondTime);
    library = adoptPlannerDraft(library, brief, plannerFixture(), secondTime);
    expect(library.projects).toHaveLength(3);
    expect(new Set(library.projects.map((entry) => entry.projectId)).size).toBe(3);
    const clipIds = library.projects.slice(1).flatMap((entry) => entry.project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    expect(new Set(clipIds).size).toBe(clipIds.length);
  });

  it("adopts multi-sentence semantic units without changing their boundaries or pauses", () => {
    const draft = plannerFixture(); draft.segmentation = "semantic";
    draft.sections[0].text = "回来啦。我还没睡，就猜你快到了。";
    const original = structuredClone(draft);
    const library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), PlannerBriefSchema.parse({ theme: "书店" }), draft, secondTime);
    const project = library.projects.find(entry => entry.projectId === library.currentProjectId)!.project;
    const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    expect(clips.map(clip => clip.text)).toEqual(draft.sections.map(section => section.text));
    expect(clips.every(clip => clip.semantic_unit)).toBe(true);
    expect(project.speechWorkspace!.paragraph.clips.map(clip => [clip.id, clip.text, clip.pause_after])).toEqual(clips.map(clip => [clip.id, clip.text, clip.pause_after]));
    expect(draft).toEqual(original);
  });

  it("fails adoption atomically if the edited draft is invalid", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const before = structuredClone(initial);
    const draft = plannerFixture();
    draft.sections[0].text = " ";
    expect(() => adoptPlannerDraft(initial, PlannerBriefSchema.parse({ theme: "书店" }), draft, secondTime)).toThrow();
    expect(initial).toEqual(before);
  });

  it("preserves the source on autosave, duplication and storage reload", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, secondTime);
    const adoptedProject = library.projects[1].project;
    library = updateLibraryProject(library, { ...adoptedProject, title: "改过的工程" }, secondTime);
    library = duplicateLibraryProject(library, adoptedProject.project_id, secondTime);
    const storage = createStorage();
    saveProjectLibrary(storage, library);
    const restored = loadProjectLibrary(storage, demoProject, secondTime);
    expect(restored.projects[1].plannerSource).toEqual({ brief, draft });
    expect(restored.projects[2].plannerSource).toEqual({ brief, draft });
    expect(restored.projects[1].project.title).toBe("改过的工程");
  });

  it("drops invalid planner metadata while preserving a valid project", () => {
    const library = createInitialProjectLibrary(demoProject, firstTime);
    const storage = createStorage({
      [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify({
        ...library,
        projects: [{ ...library.projects[0], plannerSource: { brief: { theme: "" }, draft: { secret: "invalid" } } }],
      }),
    });
    const restored = loadProjectLibrary(storage, demoProject, secondTime);
    expect(restored.projects[0].project).toEqual(demoProject);
    expect(restored.projects[0].plannerSource).toBeUndefined();
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).not.toContain("secret");
  });
});

describe("project library", () => {
  it("creates a versioned library and migrates the legacy single project", () => {
    const legacy = { ...demoProject, title: "旧项目" };
    const storage = createStorage({
      [PROJECT_STORAGE_KEY]: serializeProject(legacy),
    });

    const loaded = loadProjectLibrary(storage, demoProject, firstTime);

    expect(loaded.currentProjectId).toBe(legacy.project_id);
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0]).toMatchObject({
      projectId: legacy.project_id,
      title: "旧项目",
      updatedAt: firstTime.toISOString(),
    });
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toContain("旧项目");
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
  });

  it("ignores invalid stored records and falls back to the demo", () => {
    const storage = createStorage({
      [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        currentProjectId: "broken",
        projects: [{ projectId: "broken", project: { nope: true } }],
      }),
    });

    const loaded = loadProjectLibrary(storage, demoProject, firstTime);

    expect(loaded.currentProjectId).toBe(demoProject.project_id);
    expect(loaded.projects.map((entry) => entry.projectId)).toEqual([
      demoProject.project_id,
    ]);
  });

  it("drops stored revisions whose project id differs from their parent", () => {
    const storage = createStorage({
      [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        currentProjectId: demoProject.project_id,
        projects: [
          {
            projectId: demoProject.project_id,
            title: demoProject.title,
            updatedAt: firstTime.toISOString(),
            project: demoProject,
            revisions: [
              {
                revisionId: "wrong-revision",
                createdAt: firstTime.toISOString(),
                label: "错误版本",
                project: { ...demoProject, project_id: "another_project" },
              },
            ],
          },
        ],
      }),
    });

    const loaded = loadProjectLibrary(storage, demoProject, firstTime);

    expect(loaded.projects[0].revisions).toEqual([]);
  });

  it("updates and selects projects without changing other entries", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const created = createLibraryProject(initial, demoProject, secondTime);
    const renamed = { ...created.projects[1].project, title: "白噪声练习" };
    const updated = updateLibraryProject(created, renamed, secondTime);
    const selected = selectLibraryProject(updated, demoProject.project_id);

    expect(updated.currentProjectId).toBe(renamed.project_id);
    expect(updated.projects[1].title).toBe("白噪声练习");
    expect(selected.currentProjectId).toBe(demoProject.project_id);
    expect(selected.projects[1].title).toBe("白噪声练习");
  });

  it("preserves mix fingerprints across project autosaves", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const fingerprinted = setLibraryProjectMixFingerprint(
      initial,
      demoProject.project_id,
      "mix-fingerprint-1",
    );
    const updated = updateLibraryProject(
      fingerprinted,
      { ...demoProject, title: "已编辑" },
      secondTime,
    );

    expect(updated.projects[0].mixFingerprint).toBe("mix-fingerprint-1");
  });

  it("protects any existing project before replacement and clears its mix fingerprint", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const created = createLibraryProject(initial, demoProject, secondTime);
    const fingerprinted = setLibraryProjectMixFingerprint(
      created,
      demoProject.project_id,
      "old-fingerprint",
    );
    const replacement = { ...demoProject, title: "外部导入版本" };
    const replaced = replaceLibraryProject(
      fingerprinted,
      replacement,
      new Date("2026-07-12T03:00:00.000Z"),
      "导入前",
    );
    const entry = replaced.projects.find(
      (item) => item.projectId === demoProject.project_id,
    );

    expect(entry?.project.title).toBe("外部导入版本");
    expect(entry?.mixFingerprint).toBeUndefined();
    expect(entry?.revisions.at(-1)).toMatchObject({
      label: "导入前",
      project: expect.objectContaining({ title: demoProject.title }),
    });
  });

  it("creates a clean project from the template", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);
    const created = createLibraryProject(initial, demoProject, secondTime);
    const project = created.projects[1].project;

    expect(project.project_id).toBe("asmr_20260712_020304");
    expect(project.title).toBe("未命名项目");
    expect(project.status).toBe("draft");
    expect(project.timeline.tracks.flatMap<TimelineClip>((track) => track.clips)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: expect.objectContaining({
            status: "asset_pending",
            retry_count: 0,
            error: null,
          }),
          asset: { asset_id: null, uri: null, duration: null },
        }),
      ]),
    );
    expect(project.exports.every((entry) => entry.status === "not_started")).toBe(
      true,
    );
  });

  it("duplicates a project with a collision-safe id and keeps its assets", () => {
    const generatedProject = {
      ...demoProject,
      timeline: {
        ...demoProject.timeline,
        tracks: demoProject.timeline.tracks.map((track) =>
          track.track_type === "voice"
            ? {
                ...track,
                clips: track.clips.map((clip, index) =>
                  index === 0
                    ? {
                        ...clip,
                        generation: {
                          ...clip.generation,
                          status: "asset_generated" as const,
                        },
                        asset: {
                          asset_id: "voice_asset",
                          uri: "asset://clip/voice_asset",
                          duration: 1,
                        },
                      }
                    : clip,
                ),
              }
            : track,
        ),
      },
    };
    const initial = createInitialProjectLibrary(generatedProject, firstTime);
    const duplicatedOnce = duplicateLibraryProject(
      initial,
      generatedProject.project_id,
      secondTime,
    );
    const duplicatedTwice = duplicateLibraryProject(
      duplicatedOnce,
      generatedProject.project_id,
      secondTime,
    );

    expect(duplicatedOnce.projects[1].project.title).toBe("雨夜睡前陪伴 副本");
    expect(duplicatedOnce.projects[1].project.project_id).toBe(
      "asmr_demo_001_copy_20260712_020304",
    );
    expect(duplicatedTwice.projects[2].project.project_id).toBe(
      "asmr_demo_001_copy_20260712_020304_2",
    );
    expect(
      duplicatedOnce.projects[1].project.timeline.tracks[0].clips[0].asset.uri,
    ).toBe("asset://clip/voice_asset");
  });

  it("prevents deleting the last project and selects a survivor", () => {
    const initial = createInitialProjectLibrary(demoProject, firstTime);

    expect(deleteLibraryProject(initial, demoProject.project_id)).toBe(initial);

    const created = createLibraryProject(initial, demoProject, secondTime);
    const deleted = deleteLibraryProject(created, created.currentProjectId);

    expect(deleted.projects).toHaveLength(1);
    expect(deleted.currentProjectId).toBe(demoProject.project_id);
  });
});

describe("project revisions", () => {
  it.each(["重置前", "导入前"])("clears the active planning source on replacement (%s) and keeps it in the safety revision", (label) => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const adopted = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, firstTime);
    const original = adopted.projects[1];
    const replacement = { ...demoProject, project_id: original.projectId, title: label === "重置前" ? demoProject.title : "导入项目" };

    const replaced = replaceLibraryProject(adopted, replacement, secondTime, label);
    const entry = replaced.projects[1];
    expect(entry.plannerSource).toBeUndefined();
    expect(entry.project).toEqual(replacement);
    expect(entry.revisions.at(-1)).toMatchObject({ label, project: original.project, plannerSource: { brief, draft } });
    expect(adopted.projects[1].plannerSource).toEqual({ brief, draft });
    expect(serializeProject(entry.project)).not.toContain("plannerSource");
  });

  it("restores complete planning sources after storage reload, including source-free revisions", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    const draft = plannerFixture();
    const adopted = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, draft, firstTime);
    const original = adopted.projects[1];
    const replacement = { ...demoProject, project_id: original.projectId };
    const replaced = replaceLibraryProject(adopted, replacement, secondTime);
    const sourceRevisionId = replaced.projects[1].revisions[0].revisionId;
    const storage = createStorage();
    saveProjectLibrary(storage, replaced);
    const loaded = loadProjectLibrary(storage, demoProject, secondTime);
    const restored = restoreProjectRevision(loaded, original.projectId, sourceRevisionId, secondTime);
    const restoredEntry = restored.projects[1];

    expect(restoredEntry.project).toEqual(original.project);
    expect(restoredEntry.plannerSource).toEqual({ brief, draft });
    expect(restoredEntry.plannerSource).not.toBe(restoredEntry.revisions[0].plannerSource);
    expect(restoredEntry.revisions.at(-1)).toMatchObject({ label: "恢复前", project: replacement });
    expect(restoredEntry.revisions.at(-1)?.plannerSource).toBeUndefined();
    expect(serializeProject(restoredEntry.project)).not.toContain("plannerSource");
    expect(serializeProject(restoredEntry.project)).not.toContain("在此轻轻翻书");

    const sourceFreeRevisionId = restoredEntry.revisions.at(-1)!.revisionId;
    const restoredWithoutSource = restoreProjectRevision(restored, original.projectId, sourceFreeRevisionId, secondTime);
    expect(restoredWithoutSource.projects[1].plannerSource).toBeUndefined();
    expect(restoredWithoutSource.projects[1].project).toEqual(replacement);
  });

  it("deduplicates revisions only when both the project and source match", () => {
    const brief = PlannerBriefSchema.parse({ theme: "书店" });
    let library = adoptPlannerDraft(createInitialProjectLibrary(demoProject, firstTime), brief, plannerFixture(), firstTime);
    const project = library.projects[1].project;
    library = createProjectRevision(library, project.project_id, firstTime);
    expect(createProjectRevision(library, project.project_id, secondTime)).toBe(library);
    library = replaceLibraryProject(library, project, secondTime);
    library = createProjectRevision(library, project.project_id, secondTime);
    expect(library.projects[1].revisions).toHaveLength(2);
    expect(library.projects[1].revisions[0].plannerSource).toBeDefined();
    expect(library.projects[1].revisions[1].plannerSource).toBeUndefined();
    expect(createProjectRevision(library, project.project_id, secondTime)).toBe(library);
  });

  it("ignores malformed source metadata in stored revisions without discarding the project snapshot", () => {
    const library = createProjectRevision(createInitialProjectLibrary(demoProject, firstTime), demoProject.project_id, firstTime);
    const storage = createStorage({
      [PROJECT_LIBRARY_STORAGE_KEY]: JSON.stringify({
        ...library,
        projects: [{
          ...library.projects[0],
          revisions: [{ ...library.projects[0].revisions[0], plannerSource: { secret: "invalid" } }],
        }],
      }),
    });
    const loaded = loadProjectLibrary(storage, demoProject, secondTime);
    expect(loaded.projects[0].revisions).toHaveLength(1);
    expect(loaded.projects[0].revisions[0].project).toEqual(demoProject);
    expect(loaded.projects[0].revisions[0].plannerSource).toBeUndefined();
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).not.toContain("secret");
  });

  it("deduplicates equal revisions and retains the newest limit", () => {
    let library = createInitialProjectLibrary(demoProject, firstTime);

    library = createProjectRevision(
      library,
      demoProject.project_id,
      firstTime,
      "初始",
    );
    library = createProjectRevision(
      library,
      demoProject.project_id,
      secondTime,
      "重复",
    );
    expect(library.projects[0].revisions).toHaveLength(1);

    for (let index = 0; index < MAX_PROJECT_REVISIONS + 3; index += 1) {
      const changed = {
        ...library.projects[0].project,
        title: `版本 ${index}`,
      };
      library = updateLibraryProject(
        library,
        changed,
        new Date(Date.UTC(2026, 6, 13, 0, index)),
      );
      library = createProjectRevision(
        library,
        changed.project_id,
        new Date(Date.UTC(2026, 6, 13, 0, index)),
      );
    }

    expect(library.projects[0].revisions).toHaveLength(MAX_PROJECT_REVISIONS);
    expect(library.projects[0].revisions[0].project.title).toBe("版本 3");
    expect(library.projects[0].revisions.at(-1)?.project.title).toBe("版本 14");
  });

  it("restores a revision after protecting the current state", () => {
    let library = createInitialProjectLibrary(demoProject, firstTime);
    library = createProjectRevision(
      library,
      demoProject.project_id,
      firstTime,
      "可恢复版本",
    );
    const revisionId = library.projects[0].revisions[0].revisionId;
    library = updateLibraryProject(
      library,
      { ...demoProject, title: "当前修改" },
      secondTime,
    );

    const restored = restoreProjectRevision(
      library,
      demoProject.project_id,
      revisionId,
      new Date("2026-07-12T03:00:00.000Z"),
    );

    expect(restored.projects[0].project.title).toBe(demoProject.title);
    expect(restored.projects[0].revisions.at(-1)).toMatchObject({
      label: "恢复前",
      project: expect.objectContaining({ title: "当前修改" }),
    });
  });
});
