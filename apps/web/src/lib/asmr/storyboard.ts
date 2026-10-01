import { z } from "zod";

import type { PlannerDraft } from "./planner";

export const StoryboardShotSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  sourceSectionIds: z.array(z.string().trim().min(1).max(100)).min(1).max(200),
  visual: z.string().trim().min(1).max(800),
  action: z.string().trim().min(1).max(600),
  camera: z.string().trim().min(1).max(400),
}).strict();

export const StoryboardGeneratedSchema = z.object({
  title: z.string().trim().min(1).max(120),
  shots: z.array(StoryboardShotSchema).min(1).max(24),
}).strict().superRefine((storyboard, context) => {
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  for (const [index, shot] of storyboard.shots.entries()) {
    if (ids.has(shot.id)) context.addIssue({
      code: "custom", message: "镜头 ID 必须唯一。", path: ["shots", index, "id"],
    });
    ids.add(shot.id);
    for (const sourceId of shot.sourceSectionIds) {
      if (sourceIds.has(sourceId)) context.addIssue({
        code: "custom", message: "同一条台词只能关联一个镜头。", path: ["shots", index, "sourceSectionIds"],
      });
      sourceIds.add(sourceId);
    }
  }
});

export const StoryboardSchema = StoryboardGeneratedSchema.safeExtend({
  version: z.literal(1),
  sourceFingerprint: z.string().min(1).max(64_000),
  // Optional so earlier V1 storyboards and their editable notes remain readable.
  promptFormat: z.literal("minimax-h3").optional(),
});

export const EditableStoryboardSchema = StoryboardSchema.safeExtend({
  title: z.string().max(120),
  shots: z.array(StoryboardShotSchema.extend({
    title: z.string().max(120),
    visual: z.string().max(800),
    action: z.string().max(600),
    camera: z.string().max(400),
  })).min(1).max(24),
});

export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;
export type PlannerStoryboard = z.infer<typeof StoryboardSchema>;

/** The exact writing source, independent of audio settings or generated assets. */
export function createStoryboardSourceFingerprint(draft: PlannerDraft): string {
  return JSON.stringify({
    title: draft.title,
    scene: draft.scene,
    character: {
      role: draft.character.role,
      personality: draft.character.personality,
      speechStyle: draft.character.speechStyle,
    },
    sections: draft.sections.map(({ id, text }) => ({ id, text })),
  });
}

export function isStoryboardCurrent(storyboard: PlannerStoryboard | null | undefined, draft: PlannerDraft | null | undefined): boolean {
  return Boolean(storyboard && draft && storyboard.sourceFingerprint === createStoryboardSourceFingerprint(draft)
    && validateStoryboardSourceSections(storyboard, draft));
}

/** A storyboard partitions the source; semantic voice units are not shot boundaries. */
export function validateStoryboardSourceSections(storyboard: Pick<PlannerStoryboard, "shots">, draft: PlannerDraft): boolean {
  const sourceIds = storyboard.shots.flatMap((shot) => shot.sourceSectionIds);
  return sourceIds.length === draft.sections.length
    && sourceIds.every((id, index) => id === draft.sections[index].id);
}

export function exportStoryboardMarkdown(storyboard: PlannerStoryboard, draft: PlannerDraft): string {
  const current = isStoryboardCurrent(storyboard, draft);
  const sections = new Map(draft.sections.map((section) => [section.id, section]));
  return [
    `# ${storyboard.title}`,
    ...(current ? [] : ["文案已更新：以下分镜基于生成时的原稿。"]),
    ...storyboard.shots.map((shot, index) => [
      `## 镜头 ${String(index + 1).padStart(2, "0")} · ${shot.title}`,
      ...(current ? [`关联台词：${shot.sourceSectionIds.map((id) => sections.get(id)?.text ?? "").join("")}`] : []),
      `画面：${shot.visual}`,
      `动作：${shot.action}`,
      `镜头：${shot.camera}`,
    ].join("\n\n")),
  ].join("\n\n") + "\n";
}
