import type { AsmrProject } from "./schema";
import { safeParseAsmrProject } from "./validate";

export const PROJECT_STORAGE_KEY = "ai-asmr-studio:v0:project";

export type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type ImportProjectResult =
  | {
      success: true;
      project: AsmrProject;
    }
  | {
      success: false;
      error: string;
    };

export type LoadedProjectResult = {
  project: AsmrProject;
  restored: boolean;
};

export function serializeProject(project: AsmrProject): string {
  return JSON.stringify(project, null, 2);
}

function formatSchemaError(input: unknown): string {
  const parsed = safeParseAsmrProject(input);

  if (parsed.success) {
    return "";
  }

  return parsed.error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.join(".") || "project";

      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

export function parseImportedProject(text: string): ImportProjectResult {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch {
    return {
      success: false,
      error: "Import JSON could not be parsed.",
    };
  }

  const parsedProject = safeParseAsmrProject(parsedJson);

  if (!parsedProject.success) {
    return {
      success: false,
      error: formatSchemaError(parsedJson),
    };
  }

  return {
    success: true,
    project: parsedProject.data,
  };
}

export function loadSavedProject(
  storage: StorageLike,
  { fallbackProject }: { fallbackProject: AsmrProject },
): LoadedProjectResult {
  const savedProject = storage.getItem(PROJECT_STORAGE_KEY);

  if (!savedProject) {
    return {
      project: fallbackProject,
      restored: false,
    };
  }

  const imported = parseImportedProject(savedProject);

  if (!imported.success) {
    return {
      project: fallbackProject,
      restored: false,
    };
  }

  return {
    project: imported.project,
    restored: true,
  };
}

export function saveProject(storage: StorageLike, project: AsmrProject) {
  storage.setItem(PROJECT_STORAGE_KEY, serializeProject(project));
}

export function clearSavedProject(storage: StorageLike) {
  storage.removeItem(PROJECT_STORAGE_KEY);
}
