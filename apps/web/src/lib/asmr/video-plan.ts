import { z } from "zod";

import type { AsmrProject, TimelineClip } from "./schema";
import { renderConciseH3Prompt } from "./h3-prompt";
import { CreativeTemplateSchema, TemplateDirectionsSchema, getMatchingTemplateDirections } from "./reference-template";
import { AsmrSoundSchema } from "./asmr-sound";
import { StoryboardStyleSchema, resolveStoryboardStyle } from "./storyboard-style";

type VoiceClip = Extract<TimelineClip, { type: "voice" }>;
const assetIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const fingerprintSchema = z.string().min(1).max(64_000);

export const StoryboardReferenceModeSchema = z.enum(["continuous", "new"]);
export type StoryboardReferenceMode = z.infer<typeof StoryboardReferenceModeSchema>;

export const ClipVideoStoryboardSchema = z.object({
  version: z.literal(1),
  promptFormat: z.literal("minimax-h3"),
  clipId: z.string().min(1).max(200),
  sourceFingerprint: fingerprintSchema,
  kind: z.enum(["speech", "silent"]).optional(),
  duration: z.number().finite().positive().max(600).optional(),
  audio: z.object({
    assetId: assetIdSchema,
    uri: z.string().min(1).max(240),
    duration: z.number().finite().positive(),
  }).strict().optional(),
  // Editing can temporarily clear these fields. Copying requires complete text.
  title: z.string().max(120),
  visual: z.string().max(800),
  action: z.string().max(600),
  camera: z.string().max(400),
  ambientSound: z.string().max(600).optional(),
  asmrSound: AsmrSoundSchema.optional(),
  storyboardStyle: StoryboardStyleSchema.optional(),
  previousClipId: z.string().min(1).max(200).optional(),
  previousPromptFingerprint: fingerprintSchema.optional(),
  referenceMode: StoryboardReferenceModeSchema.optional(),
}).strict().superRefine((shot, context) => {
  if (shot.kind === "silent") {
    if (shot.audio !== undefined || shot.duration === undefined) {
      context.addIssue({ code: "custom", message: "无对白分镜必须保存镜头时长，且不能关联人声音频。", path: ["duration"] });
    }
  } else if (!shot.audio || shot.audio.uri !== `asset://clip/${shot.audio.assetId}`) {
    context.addIssue({ code: "custom", message: "视频分镜必须关联一致的本地已采用音频。", path: ["audio", "uri"] });
  }
  if ((shot.previousClipId === undefined) !== (shot.previousPromptFingerprint === undefined)) {
    context.addIssue({ code: "custom", message: "前一镜关联必须同时保存片段与提示词来源。", path: ["previousClipId"] });
  }
});

export const ProjectVideoPlanSchema = z.object({
  version: z.literal(1),
  sceneDescription: z.string().max(4000),
  shots: z.record(z.string().min(1).max(200), ClipVideoStoryboardSchema),
  referenceModes: z.record(z.string().min(1).max(200), StoryboardReferenceModeSchema).optional(),
  referenceTemplate: CreativeTemplateSchema.optional(),
  templateDirections: TemplateDirectionsSchema.optional(),
  storyboardStyle: StoryboardStyleSchema.optional(),
}).strict().superRefine((plan, context) => {
  for (const [clipId, shot] of Object.entries(plan.shots)) {
    if (clipId !== shot.clipId) {
      context.addIssue({ code: "custom", message: "视频分镜的片段编号必须与保存位置一致。", path: ["shots", clipId, "clipId"] });
    }
  }
});

export type ClipVideoStoryboard = z.infer<typeof ClipVideoStoryboardSchema>;
export type ProjectVideoPlan = z.infer<typeof ProjectVideoPlanSchema>;

function orderedVoiceClips(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap<VoiceClip>((track) => track.track_type === "voice" ? track.clips : [])
    .sort((a, b) => a.start - b.start);
}

function effectiveSceneDescription(project: AsmrProject): string {
  return project.videoPlan?.sceneDescription ?? project.scene.name;
}

function isAdoptedVoiceClip(clip: VoiceClip): boolean {
  return clip.kind !== "silent" && !clip.audio_stale && Boolean(clip.text.trim()) && clip.generation.status === "asset_generated"
    && assetIdSchema.safeParse(clip.asset.asset_id).success
    && clip.asset.uri === `asset://clip/${clip.asset.asset_id}`;
}

function storyboardSourceClip(project: AsmrProject, clipId: string): VoiceClip {
  const matches = orderedVoiceClips(project).filter((clip) => clip.id === clipId);
  const clip = matches.length === 1 ? matches[0] : undefined;
  if (!clip || !(clip.kind === "silent" ? Boolean(clip.text.trim()) && clip.duration > 0 && clip.duration <= 600 : isAdoptedVoiceClip(clip))) {
    throw new Error("请先生成并采用当前片段的本地人声音频。");
  }
  return clip;
}

/** Adjacent voice in timeline order; ambience and SFX are never continuity sources. */
export function getPreviousVoiceClip(project: AsmrProject, clipId: string): VoiceClip | undefined {
  const clips = orderedVoiceClips(project);
  const index = clips.findIndex((clip) => clip.id === clipId);
  return index > 0 && clips.filter((clip) => clip.id === clipId).length === 1 ? clips[index - 1] : undefined;
}

/** Preferences apply to the next generation, while saved shots retain their own provenance. */
export function getClipStoryboardReferenceMode(project: AsmrProject, clipId: string): StoryboardReferenceMode {
  if (orderedVoiceClips(project)[0]?.id === clipId) return "new";
  const shot = project.videoPlan?.shots[clipId];
  const selected = project.videoPlan?.referenceModes?.[clipId] ?? shot?.referenceMode;
  if (selected) return selected;
  // Legacy saved shots retain their original mode, including independent shots
  // without mode metadata. Only uninitialized short-workspace shots use the default.
  if (shot) return shot.previousClipId ? "continuous" : "new";
  return project.speechWorkspace?.activeMode !== "paragraph" && getPreviousVoiceClip(project, clipId)
    ? "continuous" : "new";
}

/** Source identity excludes timeline waiting, clip estimates, gain and spatial DSP. */
export function createClipVideoSourceFingerprint(project: AsmrProject, clipId: string): string {
  const clip = storyboardSourceClip(project, clipId);
  return sourceFingerprint(project, clip);
}

function sourceFingerprint(project: AsmrProject, clip: VoiceClip): string {
  return JSON.stringify({
    clipId: clip.id, text: clip.text,
    ...(clip.kind === "silent" ? { kind: "silent", duration: clip.duration }
      : { asset: { assetId: clip.asset.asset_id, uri: clip.asset.uri, declaredDuration: clip.asset.duration } }),
    scene: project.scene, character: project.character,
    sceneDescription: effectiveSceneDescription(project),
    ...(resolveStoryboardStyle(project.videoPlan) === "listener_pov" ? { storyboardStyle: "listener_pov" } : {}),
    ...(project.videoPlan?.referenceTemplate ? { referenceTemplate: project.videoPlan.referenceTemplate } : {}),
    ...(getMatchingTemplateDirections(project.videoPlan?.templateDirections, clip.text).length
      ? { templateDirections: getMatchingTemplateDirections(project.videoPlan?.templateDirections, clip.text) } : {}),
  });
}

function completeShot(shot: ClipVideoStoryboard): boolean {
  return [shot.title, shot.visual, shot.action, shot.camera].every((value) => Boolean(value.trim()))
    && (shot.kind !== "silent" || Boolean(shot.ambientSound?.trim()) && (shot.duration ?? 0) <= 5);
}

function previousContentFingerprint(shot: ClipVideoStoryboard): string {
  // No nested previous fingerprints: an iterative validity pass checks the chain.
  return JSON.stringify({
    clipId: shot.clipId, sourceFingerprint: shot.sourceFingerprint, audio: shot.audio,
    ...(shot.kind === "silent" ? { kind: shot.kind, duration: shot.duration } : {}),
    title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera,
    ...(shot.ambientSound === undefined ? {} : { ambientSound: shot.ambientSound }),
    ...(shot.referenceMode === undefined ? {} : { referenceMode: shot.referenceMode }),
    ...(shot.storyboardStyle === undefined ? {} : { storyboardStyle: shot.storyboardStyle }),
  });
}

function storyboardStates(project: AsmrProject, clips = orderedVoiceClips(project)) {
  const states = new Map<string, { shot: ClipVideoStoryboard; current: boolean }>();
  const counts = new Map<string, number>();
  for (const clip of clips) counts.set(clip.id, (counts.get(clip.id) ?? 0) + 1);
  const hasScene = Boolean(effectiveSceneDescription(project).trim());
  for (const [index, clip] of clips.entries()) {
    const parsed = ClipVideoStoryboardSchema.safeParse(project.videoPlan?.shots[clip.id]);
    if (!parsed.success) continue;
    const shot = parsed.data;
    // Source lookup/fingerprinting and predecessor checks share one ordered pass.
    const currentSource = counts.get(clip.id) === 1 && (clip.kind === "silent"
      ? Boolean(clip.text.trim()) && clip.duration > 0 && clip.duration <= 600 : isAdoptedVoiceClip(clip));
    let current = currentSource && shot.clipId === clip.id && shot.sourceFingerprint === sourceFingerprint(project, clip)
      && (clip.kind === "silent" ? shot.kind === "silent" && shot.duration === clip.duration && !shot.audio
        : shot.kind !== "silent" && shot.audio?.assetId === clip.asset.asset_id && shot.audio?.uri === clip.asset.uri);
    if (current && shot.previousClipId !== undefined) {
      const previous = clips[index - 1];
      const previousState = previous ? states.get(previous.id) : undefined;
      current = previous?.id === shot.previousClipId && !!previousState?.current
        && completeShot(previousState.shot) && hasScene
        && shot.previousPromptFingerprint === previousContentFingerprint(previousState.shot);
    }
    states.set(clip.id, { shot, current });
  }
  return states;
}

export function isClipVideoStoryboardCurrent(project: AsmrProject, clipId: string): boolean {
  return storyboardStates(project).get(clipId)?.current ?? false;
}

/** Fingerprint for this clip's usable adjacent predecessor, including hand edits. */
export function getPreviousClipPromptFingerprint(project: AsmrProject, clipId: string): string | undefined {
  const previous = getPreviousVoiceClip(project, clipId);
  if (!previous || !effectiveSceneDescription(project).trim()) return undefined;
  const previousState = storyboardStates(project).get(previous.id);
  return previousState?.current && completeShot(previousState.shot) ? previousContentFingerprint(previousState.shot) : undefined;
}

/** Both modes may use a usable adjacent shot; callers require it only for continuous mode. */
export function getClipStoryboardReferenceContext(project: AsmrProject, clipId: string, mode: StoryboardReferenceMode): {
  previousClipId: string; previousPromptFingerprint: string;
} | undefined {
  if (!StoryboardReferenceModeSchema.safeParse(mode).success) return undefined;
  const previous = getPreviousVoiceClip(project, clipId);
  const previousPromptFingerprint = getPreviousClipPromptFingerprint(project, clipId);
  return previous && previousPromptFingerprint ? { previousClipId: previous.id, previousPromptFingerprint } : undefined;
}

/** One clip, one measured complete TTS track and one continuous video shot. */
export function createClipH3Prompt(project: AsmrProject, clipId: string): string {
  const clip = storyboardSourceClip(project, clipId);
  const state = storyboardStates(project).get(clipId);
  if (!state) throw new Error("当前片段还没有视频分镜。");
  if (!state.current) throw new Error("文案、音频、场景或前一镜已更新，请重新生成当前视频分镜。");
  if (clip.kind === "silent" && clip.duration > 5) throw new Error("请将无对白镜头时长调整为不超过 5 秒，再重新生成分镜。");
  if (clip.kind === "silent" && !state.shot.ambientSound?.trim()) throw new Error("旧无对白分镜缺少环境底噪描述，请重新生成分镜。");
  if (!completeShot(state.shot) || !effectiveSceneDescription(project).trim()) {
    throw new Error("请补全全局场景及当前镜头的标题、画面、动作和镜头说明。");
  }
  return renderClipH3Prompt(clip, state.shot);
}

function renderClipH3Prompt(clip: VoiceClip, shot: ClipVideoStoryboard): string {
  return renderConciseH3Prompt({ visual: shot.visual, action: shot.action, camera: shot.camera,
    dialogue: clip.kind === "silent" ? "" : clip.text, silent: clip.kind === "silent",
    durationSeconds: clip.kind === "silent" ? shot.duration : shot.audio?.duration, ambientSound: shot.ambientSound,
    storyboardStyle: shot.storyboardStyle });
}

/** Evaluate every saved shot once; values are identical to usable single-clip prompts. */
export function getUsableClipH3Prompts(project: AsmrProject): Map<string, string> {
  const prompts = new Map<string, string>();
  if (!effectiveSceneDescription(project).trim()) return prompts;
  const clips = orderedVoiceClips(project);
  const states = storyboardStates(project, clips);
  for (const clip of clips) {
    const state = states.get(clip.id);
    if (state?.current && completeShot(state.shot)) prompts.set(clip.id, renderClipH3Prompt(clip, state.shot));
  }
  return prompts;
}

/** Text-only batch changes may rebind existing valid links, never repair stale provenance. */
export function rebindCurrentStoryboardReferences(before: AsmrProject, after: AsmrProject): AsmrProject {
  if (!after.videoPlan) return after;
  const original = storyboardStates(before), updated = structuredClone(after), clips = orderedVoiceClips(updated);
  const counts = new Map<string, number>();
  for (const clip of clips) counts.set(clip.id, (counts.get(clip.id) ?? 0) + 1);
  const metadata = (shot: ClipVideoStoryboard) => JSON.stringify({ clipId: shot.clipId, kind: shot.kind, duration: shot.duration,
    sourceFingerprint: shot.sourceFingerprint, audio: shot.audio, referenceMode: shot.referenceMode,
    previousClipId: shot.previousClipId, previousPromptFingerprint: shot.previousPromptFingerprint });
  for (const clip of clips) {
    const prior = original.get(clip.id), shot = updated.videoPlan!.shots[clip.id];
    if (!prior?.current || !shot?.previousClipId || counts.get(clip.id) !== 1 || metadata(prior.shot) !== metadata(shot)
      || shot.sourceFingerprint !== sourceFingerprint(updated, clip)) continue;
    const fingerprint = getPreviousClipPromptFingerprint(updated, clip.id);
    if (fingerprint !== undefined) shot.previousPromptFingerprint = fingerprint;
  }
  return updated;
}
