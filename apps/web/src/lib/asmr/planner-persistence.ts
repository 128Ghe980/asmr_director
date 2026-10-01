import { z } from "zod";

import {
  PlannerBriefSchema,
  PlannerDraftSchema,
  PlannerSectionSchema,
  createEmptyPlannerBrief,
  type PlannerBrief,
  type PlannerDraft,
} from "./planner";
import type { StorageLike } from "./project-persistence";
import { EditableStoryboardSchema, type PlannerStoryboard } from "./storyboard";

export const PLANNER_DRAFT_STORAGE_KEY = "ai-asmr-studio:v1:planner-draft";
const MAX_STORED_DRAFT_CHARACTERS = 200000;

// Local work can contain a new/temporarily cleared paragraph. Adoption and model
// calls still validate against the complete PlannerDraftSchema.
const EditableDraftSchema = PlannerDraftSchema.safeExtend({
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
  brief: PlannerBriefSchema.extend({ theme: z.string().trim().max(2000) }),
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

export function loadPlannerDraft(storage: StorageLike): {
  state: PlannerWorkingState;
  restored: boolean;
  error?: string;
} {
  try {
    const stored = storage.getItem(PLANNER_DRAFT_STORAGE_KEY);
    if (!stored) {
      return { state: createEmptyPlannerWorkingState(), restored: false };
    }
    if (stored.length > MAX_STORED_DRAFT_CHARACTERS) {
      throw new Error("Stored draft exceeds the size limit.");
    }
    const parsed = parseWorkingState(JSON.parse(stored));
    if (!parsed.success) {
      throw new Error("Stored draft is invalid.");
    }
    return { state: parsed.data, restored: true };
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
    storage.setItem(PLANNER_DRAFT_STORAGE_KEY, serialized);
    return { success: true };
  } catch {
    return { success: false, error: "策划草稿无法保存到此浏览器，请保留当前页面后重试。" };
  }
}
