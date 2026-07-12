import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  MAX_PROJECT_REVISIONS,
  PROJECT_LIBRARY_STORAGE_KEY,
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
  updateLibraryProject,
} from "./project-library";
import { PROJECT_STORAGE_KEY, serializeProject } from "./project-persistence";

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
    expect(project.timeline.tracks.flatMap((track) => track.clips)).toEqual(
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
