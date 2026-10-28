import { z } from "zod";

import { AsmrProjectSchema, PositionSchema, type AsmrProject } from "./schema";
import { EditableStoryboardSchema } from "./storyboard";
import { CreativeTemplateSchema } from "./reference-template";
import { StoryboardStyleSchema } from "./storyboard-style";
import { PerformancePurposeSchema } from "./performance-segment";

export const PlannerBriefSchema = z.object({
  theme: z.string().trim().min(1).max(2000),
  durationSeconds: z.number().int().min(60).max(600).default(300),
  language: z.literal("zh").default("zh"),
  role: z.string().trim().max(200).default(""),
  style: z.string().trim().min(1).max(200).default("温柔自然"),
  notes: z.string().trim().max(4000).default(""),
  referenceTemplate: CreativeTemplateSchema.optional(),
  storyboardStyle: StoryboardStyleSchema.optional(),
}).strict();

export const PlannerSectionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  // Missing kind is legacy speech. A silent section stores an action description
  // in text; it is never submitted to the voice engine.
  kind: z.enum(["speech", "silent"]).optional(),
  purpose: PerformancePurposeSchema.optional(),
  durationSeconds: z.number().finite().positive().max(600).optional(),
  // Offsets in the editor use the original UTF-16 string; never trim it.
  text: z.string().min(1).max(3000).regex(/\S/u),
  emotion: z.string().trim().min(1).max(120),
  style: z.string().trim().min(1).max(120),
  pace: z.string().trim().min(1).max(120),
  direction: z.string().trim().max(1200),
  soundSuggestions: z.string().trim().max(1200),
  pauseAfter: z.enum(["short", "medium", "long"]),
  pauseAfterSeconds: z.number().min(0).max(30).optional(),
  position: PositionSchema.strict(),
}).strict();

export const PlannerDraftSchema = z.object({
  performanceVersion: z.literal(1).optional(),
  segmentation: z.literal("semantic").optional(),
  title: z.string().trim().min(1).max(200),
  scene: z.string().trim().min(1).max(4000),
  character: z.object({
    role: z.string().trim().min(1).max(200),
    personality: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    speechStyle: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  }).strict(),
  sections: z.array(PlannerSectionSchema).min(1).max(200),
}).strict().superRefine((draft, context) => {
  const ids = new Set<string>();
  for (const [index, section] of draft.sections.entries()) {
    if (ids.has(section.id)) {
      context.addIssue({
        code: "custom", message: "段落 ID 必须唯一。", path: ["sections", index, "id"],
      });
    }
    ids.add(section.id);
    if (section.kind === "silent" && (section.durationSeconds === undefined || section.purpose === "dialogue")) {
      context.addIssue({ code: "custom", path: ["sections", index, "durationSeconds"], message: "无台词段需要有效时长及操作、过渡或互动用途。" });
    }
    if (section.kind !== "silent" && section.durationSeconds !== undefined) {
      context.addIssue({ code: "custom", path: ["sections", index, "durationSeconds"], message: "台词时长由实际采用的人声音频决定。" });
    }
  }
  if (draft.sections.reduce((total, section) => total + (section.kind === "silent" ? 0 : section.text.length), 0) > 12000) {
    context.addIssue({
      code: "custom", message: "台词总长度不能超过 12000 字符。", path: ["sections"],
    });
  }
});

export const PlannerSourceSchema = z.object({
  brief: PlannerBriefSchema,
  draft: PlannerDraftSchema,
  // Damaged optional visual notes must not discard the original script.
  storyboard: EditableStoryboardSchema.optional().catch(undefined),
  sceneDescription: z.string().max(4000).optional().catch(undefined),
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

export function getPlannerPauseSeconds(section: PlannerSection): number {
  if (section.kind === "silent") return 0;
  return section.pauseAfterSeconds ?? PLANNED_PAUSE_SECONDS[section.pauseAfter];
}

export function estimatePlannerSpeechDuration(text: string): number {
  const spokenCharacters = Array.from(text.replace(/\s/gu, "")).length;
  const punctuationCount = (text.match(/[，。！？；：、,.!?;:…]/gu) ?? []).length;
  return Math.max(2, Math.ceil(spokenCharacters / 2.8 + punctuationCount * 0.35));
}

/** Approximate speech plus explicit performance time; adopted WAVs replace estimates. */
export function getPlannerDurationSummary(draft: PlannerDraft) {
  let speechSeconds = 0, nonSpeechSeconds = 0, pauses = 0;
  for (const section of draft.sections) {
    if (section.kind === "silent") nonSpeechSeconds += section.durationSeconds ?? 0;
    else speechSeconds += section.text.trim() ? estimatePlannerSpeechDuration(section.text) : 0;
    if (draft.performanceVersion !== 1) pauses += getPlannerPauseSeconds(section);
  }
  return { speechSeconds, nonSpeechSeconds, totalSeconds: speechSeconds + nonSpeechSeconds + pauses };
}

/** Automatic creative budget. Ratios guide writing, never trim speech or fill output. */
export function getPlannerPerformanceBudget(brief: PlannerBrief) {
  const intent = `${brief.theme}\n${brief.notes}`;
  const noSpeech = /(?:全程|完全)(?:无|不含|没有)(?:对白|台词|人声)|(?:不要|无需)(?:任何)?(?:对白|台词|人声)(?=$|[\s，。；、!！?？])|(?:^|[，。；\n])(?:无|没有|不含)(?:对白|台词|人声)(?=$|[\s，。；、!！?？])|纯(?:音效|触发音)|(?:全程)?不说话|no\s+(?:talking|speech|dialogue)/iu.test(intent);
  const speechOnly = /纯(?:对白|台词|人声)|只(?:要|保留)(?:台词|对白)|不要无台词段/iu.test(intent);
  const soundLed = /传统\s*ASMR|麦(?:克风)?前|声音为主|少(?:量)?说话|少(?:量)?台词|触发音为主|mostly\s+(?:sound|asmr)/iu.test(intent);
  const speechRatio = noSpeech ? 0 : speechOnly ? 1 : soundLed ? 0.15 : brief.referenceTemplate?.performancePacing?.speechRatio ?? 0.45;
  const speechSeconds = Math.round(brief.durationSeconds * speechRatio);
  return { speechSeconds, nonSpeechSeconds: brief.durationSeconds - speechSeconds,
    spokenCharacters: Math.round(speechSeconds * 2.2), noSpeech };
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
    const silent = section.kind === "silent";
    const duration = silent ? section.durationSeconds! : estimatePlannerSpeechDuration(section.text);
    const pause = draft.performanceVersion === 1 ? 0 : getPlannerPauseSeconds(section);
    const clip = {
      id: `${projectId}_voice_${String(index + 1).padStart(3, "0")}`,
      track: "voice" as const,
      type: "voice" as const,
      start: cursor,
      duration,
      pause_after: pause,
      ...(silent ? { kind: "silent" as const } : {}),
      ...(draft.performanceVersion === 1 || silent ? { performance: { version: 1 as const,
        segmentId: section.id, purpose: section.purpose ?? (silent ? "asmr" as const : "dialogue" as const),
        direction: section.direction, soundIntent: section.soundSuggestions,
      } } : {}),
      ...(draft.segmentation === "semantic" ? { semantic_unit: true } : {}),
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
        model: silent ? "silent" : "gpt-sovits",
        seed: index + 1,
        retry_count: 0,
        error: null,
      },
      asset: { asset_id: null, uri: null, duration: null },
    };
    cursor += duration + pause;
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
