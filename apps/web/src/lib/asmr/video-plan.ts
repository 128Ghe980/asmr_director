import { z } from "zod";

import type { AsmrProject, TimelineClip } from "./schema";
import { renderConciseH3Prompt } from "./h3-prompt";

type VoiceClip = Extract<TimelineClip, { type: "voice" }>;
const assetIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const fingerprintSchema = z.string().min(1).max(64_000);

export const ClipVideoStoryboardSchema = z.object({
  version: z.literal(1),
  promptFormat: z.literal("minimax-h3"),
  clipId: z.string().min(1).max(200),
  sourceFingerprint: fingerprintSchema,
  audio: z.object({
    assetId: assetIdSchema,
    uri: z.string().min(1).max(240),
    duration: z.number().finite().positive(),
  }).strict(),
  // Editing can temporarily clear these fields. Copying requires complete text.
  title: z.string().max(120),
  visual: z.string().max(800),
  action: z.string().max(600),
  camera: z.string().max(400),
  previousClipId: z.string().min(1).max(200).optional(),
  previousPromptFingerprint: fingerprintSchema.optional(),
}).strict().superRefine((shot, context) => {
  if (shot.audio.uri !== `asset://clip/${shot.audio.assetId}`) {
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

function adoptedVoiceClip(project: AsmrProject, clipId: string): VoiceClip {
  const matches = orderedVoiceClips(project).filter((clip) => clip.id === clipId);
  const clip = matches.length === 1 ? matches[0] : undefined;
  if (!clip || !clip.text.trim() || clip.generation.status !== "asset_generated"
    || !assetIdSchema.safeParse(clip.asset.asset_id).success
    || clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`) {
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

/** Source identity excludes timeline waiting, clip estimates, gain and spatial DSP. */
export function createClipVideoSourceFingerprint(project: AsmrProject, clipId: string): string {
  const clip = adoptedVoiceClip(project, clipId);
  return JSON.stringify({
    clipId: clip.id, text: clip.text,
    asset: { assetId: clip.asset.asset_id, uri: clip.asset.uri, declaredDuration: clip.asset.duration },
    scene: project.scene, character: project.character,
    sceneDescription: effectiveSceneDescription(project),
  });
}

function completeShot(shot: ClipVideoStoryboard): boolean {
  return [shot.title, shot.visual, shot.action, shot.camera].every((value) => Boolean(value.trim()));
}

function previousContentFingerprint(shot: ClipVideoStoryboard): string {
  // No nested previous fingerprints: an iterative validity pass checks the chain.
  return JSON.stringify({
    clipId: shot.clipId, sourceFingerprint: shot.sourceFingerprint, audio: shot.audio,
    title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera,
  });
}

function storyboardStates(project: AsmrProject) {
  const states = new Map<string, { shot: ClipVideoStoryboard; current: boolean }>();
  const clips = orderedVoiceClips(project);
  for (const [index, clip] of clips.entries()) {
    const parsed = ClipVideoStoryboardSchema.safeParse(project.videoPlan?.shots[clip.id]);
    if (!parsed.success) continue;
    const shot = parsed.data;
    let current = false;
    try {
      const source = adoptedVoiceClip(project, clip.id);
      current = shot.clipId === clip.id && shot.sourceFingerprint === createClipVideoSourceFingerprint(project, clip.id)
        && shot.audio.assetId === source.asset.asset_id && shot.audio.uri === source.asset.uri;
    } catch { /* Unadopted or edited sources stay visible, but cannot be exported. */ }
    if (current && shot.previousClipId !== undefined) {
      const previous = clips[index - 1];
      const previousState = previous ? states.get(previous.id) : undefined;
      current = previous?.id === shot.previousClipId && !!previousState?.current
        && completeShot(previousState.shot) && Boolean(effectiveSceneDescription(project).trim())
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

/** One clip, one measured complete TTS track and one continuous video shot. */
export function createClipH3Prompt(project: AsmrProject, clipId: string): string {
  const clip = adoptedVoiceClip(project, clipId);
  const state = storyboardStates(project).get(clipId);
  if (!state) throw new Error("当前片段还没有视频分镜。");
  if (!state.current) throw new Error("文案、音频、场景或前一镜已更新，请重新生成当前视频分镜。");
  if (!completeShot(state.shot) || !effectiveSceneDescription(project).trim()) {
    throw new Error("请补全全局场景及当前镜头的标题、画面、动作和镜头说明。");
  }
  const shot = state.shot;
  return renderConciseH3Prompt({ visual: shot.visual, action: shot.action, camera: shot.camera, dialogue: clip.text, durationSeconds: shot.audio.duration });
}
