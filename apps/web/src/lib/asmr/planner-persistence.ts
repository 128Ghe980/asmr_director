import { z } from "zod";

import {
  PlannerBriefSchema,
  PlannerDraftSchema,
  PlannerSectionSchema,
  createEmptyPlannerBrief,
  type PlannerBrief,
  type PlannerDraft,
  type PlannerSource,
} from "./planner";
import type { StorageLike } from "./project-persistence";
import { EditableStoryboardSchema, type PlannerStoryboard } from "./storyboard";
import { CreativeTemplateSchema } from "./reference-template";

export const PLANNER_DRAFT_STORAGE_KEY = "ai-asmr-studio:v1:planner-draft";
export const PLANNER_DRAFT_LEGACY_OWNER_STORAGE_KEY = `${PLANNER_DRAFT_STORAGE_KEY}:legacy-project`;
export function getPlannerDraftStorageKey(projectId?: string) {
  return projectId ? `${PLANNER_DRAFT_STORAGE_KEY}:project:${encodeURIComponent(projectId)}` : PLANNER_DRAFT_STORAGE_KEY;
}
const MAX_STORED_DRAFT_CHARACTERS = 200000;

// Local work can contain a new/temporarily cleared paragraph. Adoption and model
// calls still validate against the complete PlannerDraftSchema.
const EditableDraftSchema = PlannerDraftSchema.safeExtend({
  scene: z.string().max(4000),
  sections: z.array(PlannerSectionSchema.extend({
    title: z.string().max(200),
    text: z.string().max(3000),
  })).max(200),
});

export type PlannerWorkingState = {
  version: 1;
  brief: PlannerBrief;
  draftBrief: PlannerBrief | null;
  draft: PlannerDraft | null;
  provider: "ollama" | "api";
  storyboard?: PlannerStoryboard | null;
  sceneDescription?: string | null;
};

const WorkingStateSchema = z.object({
  version: z.literal(1),
  // A theme is required for generation, but the local editor starts empty.
  brief: PlannerBriefSchema.extend({ theme: z.string().trim().max(2000), referenceTemplate: CreativeTemplateSchema.safeExtend({
    creativePrompt: z.string().max(6000), sceneDescription: z.string().max(4000), storyboardRules: z.string().max(6000),
  }).optional() }),
  draftBrief: PlannerBriefSchema.nullable(),
  draft: EditableDraftSchema.nullable(),
  provider: z.enum(["ollama", "api"]),
  storyboard: EditableStoryboardSchema.nullable().optional().catch(undefined),
  sceneDescription: z.string().max(4000).nullable().optional().catch(undefined),
}).strict().refine(
  (state) => (state.draft === null) === (state.draftBrief === null),
  { message: "草稿必须保留生成时的主题。", path: ["draftBrief"] },
);

function parseWorkingState(input: unknown) {
  // Earlier V1 workspaces attached one brief to both the form and the draft.
  const migrated = input && typeof input === "object" && !("draftBrief" in input)
    ? {
        ...input,
        draftBrief: "draft" in input && input.draft && "brief" in input ? input.brief : null,
      }
    : input;
  return WorkingStateSchema.safeParse(migrated);
}

export function createEmptyPlannerWorkingState(): PlannerWorkingState {
  return {
    version: 1,
    brief: createEmptyPlannerBrief(),
    draftBrief: null,
    draft: null,
    provider: "ollama",
  };
}

export function loadPlannerDraft(storage: StorageLike, projectId?: string, source?: PlannerSource): {
  state: PlannerWorkingState;
  restored: boolean;
  error?: string;
  legacyAvailable?: boolean;
} {
  try {
    let stored = storage.getItem(getPlannerDraftStorageKey(projectId));
    let migrating = false;
    let legacyAvailable = false;
    if (projectId) {
      const owner = storage.getItem(PLANNER_DRAFT_LEGACY_OWNER_STORAGE_KEY);
      const legacy = storage.getItem(PLANNER_DRAFT_STORAGE_KEY);
      legacyAvailable = !owner && Boolean(legacy);
      if (!stored && legacy) {
        let matchesSource = false;
        if (!owner && source && legacy.length <= MAX_STORED_DRAFT_CHARACTERS) {
          try {
            const parsed = parseWorkingState(JSON.parse(legacy));
            const originalBrief = PlannerBriefSchema.safeParse(source.brief);
            const originalDraft = PlannerDraftSchema.safeParse(source.draft);
            matchesSource = parsed.success && originalBrief.success && originalDraft.success && Boolean(parsed.data.draft)
              && JSON.stringify(parsed.data.draftBrief) === JSON.stringify(originalBrief.data)
              && JSON.stringify(parsed.data.draft) === JSON.stringify(originalDraft.data);
          } catch { /* An unattributed legacy value stays intact for explicit recovery. */ }
        }
        if (owner === projectId || matchesSource) {
          stored = legacy;
          migrating = true;
          legacyAvailable = false;
        }
      }
    }
    if (!stored) {
      return { state: createEmptyPlannerWorkingState(), restored: false, ...(legacyAvailable ? { legacyAvailable: true } : {}) };
    }
    if (stored.length > MAX_STORED_DRAFT_CHARACTERS) {
      throw new Error("Stored draft exceeds the size limit.");
    }
    const parsed = parseWorkingState(JSON.parse(stored));
    if (!parsed.success) {
      throw new Error("Stored draft is invalid.");
    }
    if (migrating && projectId) {
      try {
        // Keep the legacy bytes intact. Only matching project provenance or an
        // already recorded owner can claim them automatically.
        storage.setItem(PLANNER_DRAFT_LEGACY_OWNER_STORAGE_KEY, projectId);
        const saved = savePlannerDraft(storage, parsed.data, projectId);
        if (!saved.success) return { state: parsed.data, restored: true, error: saved.error };
      } catch {
        return { state: parsed.data, restored: true, error: "原策划草稿已恢复，但按项目保存失败，请及时下载文案。" };
      }
    }
    return { state: parsed.data, restored: true, ...(legacyAvailable ? { legacyAvailable: true } : {}) };
  } catch {
    return {
      state: createEmptyPlannerWorkingState(),
      restored: false,
      error: "本地策划草稿无法读取，已打开空白策划；原保存内容未覆盖。",
    };
  }
}

export function savePlannerDraft(
  storage: StorageLike,
  state: PlannerWorkingState,
  projectId?: string,
): { success: true } | { success: false; error: string } {
  const parsed = parseWorkingState(state);
  if (!parsed.success) {
    return { success: false, error: "策划草稿尚不完整，暂未保存；请补全提示的字段。" };
  }
  try {
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > MAX_STORED_DRAFT_CHARACTERS) {
      return { success: false, error: "策划草稿过长，请缩短后再保存。" };
    }
    storage.setItem(getPlannerDraftStorageKey(projectId), serialized);
    return { success: true };
  } catch {
    return { success: false, error: "策划草稿无法保存到此浏览器，请保留当前页面后重试。" };
  }
}
