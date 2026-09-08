import { z } from "zod";

import { AsmrProjectSchema, PositionSchema, type AsmrProject } from "./schema";

export const PlannerBriefSchema = z.object({
  theme: z.string().trim().min(1).max(2000),
  durationSeconds: z.number().int().min(60).max(600).default(300),
  language: z.literal("zh").default("zh"),
  role: z.string().trim().max(200).default(""),
  style: z.string().trim().min(1).max(200).default("温柔自然"),
  notes: z.string().trim().max(4000).default(""),
}).strict();

export const PlannerSectionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(3000),
  emotion: z.string().trim().min(1).max(120),
  style: z.string().trim().min(1).max(120),
  pace: z.string().trim().min(1).max(120),
  direction: z.string().trim().max(1200),
  soundSuggestions: z.string().trim().max(1200),
  pauseAfter: z.enum(["short", "medium", "long"]),
  position: PositionSchema.strict(),
}).strict();

export const PlannerDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scene: z.string().trim().min(1).max(2000),
  character: z.object({
    role: z.string().trim().min(1).max(200),
    personality: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    speechStyle: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  }).strict(),
  sections: z.array(PlannerSectionSchema).min(2).max(12),
}).strict().superRefine((draft, context) => {
  const ids = new Set<string>();
  for (const [index, section] of draft.sections.entries()) {
    if (ids.has(section.id)) {
      context.addIssue({
        code: "custom", message: "段落 ID 必须唯一。", path: ["sections", index, "id"],
      });
    }
    ids.add(section.id);
  }
  if (draft.sections.reduce((total, section) => total + section.text.length, 0) > 12000) {
    context.addIssue({
      code: "custom", message: "台词总长度不能超过 12000 字符。", path: ["sections"],
    });
  }
});

export const PlannerSourceSchema = z.object({
  brief: PlannerBriefSchema,
  draft: PlannerDraftSchema,
}).strict();

export type PlannerBrief = z.infer<typeof PlannerBriefSchema>;
export type PlannerSection = z.infer<typeof PlannerSectionSchema>;
export type PlannerDraft = z.infer<typeof PlannerDraftSchema>;
export type PlannerSource = z.infer<typeof PlannerSourceSchema>;

export function createEmptyPlannerBrief(): PlannerBrief {
  return {
    theme: "", durationSeconds: 300, language: "zh", role: "", style: "温柔自然", notes: "",
  };
}

// Planning silence is deliberately independent of the voice engine's internal pauses.
const PLANNED_PAUSE_SECONDS = { short: 1.5, medium: 3, long: 6 } as const;

function estimateSpeechDuration(text: string): number {
  const spokenCharacters = Array.from(text.replace(/\s/gu, "")).length;
  const punctuationCount = (text.match(/[，。！？；：、,.!?;:…]/gu) ?? []).length;
  return Math.max(2, Math.ceil(spokenCharacters / 2.8 + punctuationCount * 0.35));
}

export function compilePlannerDraft(
  briefInput: PlannerBrief,
  draftInput: PlannerDraft,
  projectId: string,
): AsmrProject {
  const brief = PlannerBriefSchema.parse(briefInput);
  const draft = PlannerDraftSchema.parse(draftInput);
  z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).parse(projectId);

  let cursor = 0;
  const clips = draft.sections.map((section, index) => {
    const duration = estimateSpeechDuration(section.text);
    const clip = {
      id: `${projectId}_voice_${String(index + 1).padStart(3, "0")}`,
      track: "voice" as const,
      type: "voice" as const,
      start: cursor,
      duration,
      text: section.text,
      emotion: section.emotion,
      style: section.style,
      pace: section.pace,
      volume_db: -3,
      fade_in: 0.05,
      fade_out: 0.1,
      position: section.position,
      generation: {
        status: "asset_pending" as const,
        model: "gpt-sovits",
        seed: index + 1,
        retry_count: 0,
        error: null,
      },
      asset: { asset_id: null, uri: null, duration: null },
    };
    cursor += duration + PLANNED_PAUSE_SECONDS[section.pauseAfter];
    return clip;
  });

  // The requested duration guides writing. Never shorten speech or pad the whole
  // project to force it to match the target; generated WAVs provide actual timing.
  return AsmrProjectSchema.parse({
    project_id: projectId,
    status: "draft",
    title: draft.title,
    language: brief.language,
    duration: cursor,
    scene: { id: `${projectId}_scene`, name: draft.scene },
    character: {
      id: `${projectId}_character`,
      role: draft.character.role,
      personality: draft.character.personality,
      speech_style: draft.character.speechStyle,
    },
    emotion_curve: clips.map((clip) => ({
      start: clip.start,
      end: clip.start + clip.duration,
      emotion: clip.emotion,
    })),
    timeline: {
      tracks: [
        { track_type: "voice", clips },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ],
      mixing: { target_lufs: -18, binaural: true, master_limiter: true },
    },
    exports: ["project_json", "srt", "mp3", "wav", "stems_wav"].map((type) => ({
      type, status: "not_started", uri: null,
    })),
  });
}
