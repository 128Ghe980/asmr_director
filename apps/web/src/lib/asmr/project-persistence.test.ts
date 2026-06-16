import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  PROJECT_STORAGE_KEY,
  clearSavedProject,
  loadSavedProject,
  parseImportedProject,
  saveProject,
  serializeProject,
} from "./project-persistence";

function createStorage(initialValue?: string) {
  const values = new Map<string, string>();

  if (initialValue !== undefined) {
    values.set(PROJECT_STORAGE_KEY, initialValue);
  }

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

describe("project persistence", () => {
  it("serializes project JSON that can be imported again", () => {
    const serialized = serializeProject(demoProject);
    const imported = parseImportedProject(serialized);

    expect(imported.success).toBe(true);
    if (imported.success) {
      expect(imported.project.project_id).toBe(demoProject.project_id);
      expect(imported.project.timeline.tracks).toHaveLength(5);
    }
  });

  it("reports invalid JSON without throwing", () => {
    const imported = parseImportedProject("{not-json");

    expect(imported).toEqual({
      success: false,
      error: "JSON 解析失败。",
    });
  });

  it("reports schema issues for JSON that is not an ASMR project", () => {
    const imported = parseImportedProject(
      JSON.stringify({ project_id: "", timeline: {} }),
    );

    expect(imported.success).toBe(false);
    if (!imported.success) {
      expect(imported.error).toContain("project_id");
    }
  });

  it("loads a valid saved project from storage", () => {
    const storage = createStorage(serializeProject(demoProject));
    const loaded = loadSavedProject(storage, {
      fallbackProject: demoProject,
    });

    expect(loaded.restored).toBe(true);
    expect(loaded.project.project_id).toBe(demoProject.project_id);
  });

  it("falls back when saved storage is invalid", () => {
    const storage = createStorage("{broken");
    const loaded = loadSavedProject(storage, {
      fallbackProject: demoProject,
    });

    expect(loaded.restored).toBe(false);
    expect(loaded.project).toBe(demoProject);
  });

  it("saves and clears the current project", () => {
    const storage = createStorage();

    saveProject(storage, demoProject);
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toBe(serializeProject(demoProject));

    clearSavedProject(storage);
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
  });
});
