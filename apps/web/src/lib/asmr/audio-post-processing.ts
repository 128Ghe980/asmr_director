import type { AsmrProject, VoiceClip } from "./schema";
import { captureSpeechWorkspace } from "./speech-workspace";
import { getUsableClipH3Prompts } from "./video-plan";
import { AUDIO_POST_PROCESSING_RENDERER_VERSION, AudioPostProcessingReceiptSchema, AudioPostProcessingSchema,
  type AudioPostProcessing, type AudioPostProcessingAnchor, type AudioPostProcessingMovement, type AudioPostProcessingReceipt, type AudioPostProcessingShot } from "./audio-post-processing-schema";

export type { AudioPostProcessing, AudioPostProcessingAnchor, AudioPostProcessingReceipt, AudioPostProcessingShot } from "./audio-post-processing-schema";
export function getAudioPostProcessingClips(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []);
}
/** Compact change identity, not a substitute for the server's source/output SHA-256. */
function compactFingerprint(value: string): string {
  const state = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x85ebca77];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < state.length; lane++) state[lane] = Math.imul(state[lane] ^ code, primes[lane]) >>> 0;
  }
  return `audio-post-v1:${state.map(part => part.toString(16).padStart(8, "0")).join("")}`;
}
export function createAudioPostProcessingInputFingerprint(project: AsmrProject): string {
  return compactFingerprint(JSON.stringify({ version: 1, projectId: project.project_id, workspace: project.speechWorkspace?.activeMode ?? "short",
    title: project.title, scene: { id: project.scene.id, name: project.scene.name },
    character: { id: project.character.id, role: project.character.role, personality: project.character.personality, speech_style: project.character.speech_style },
    sceneDescription: project.videoPlan?.sceneDescription,
    clips: getAudioPostProcessingClips(project).map(clip => {
      const shot = project.videoPlan?.shots[clip.id];
      return { id: clip.id, kind: clip.kind ?? "speech", text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace,
        ...(clip.kind === "silent" ? {} : { source: { assetId: clip.asset.asset_id, uri: clip.asset.uri, duration: clip.asset.duration }, audioStale: Boolean(clip.audio_stale), status: clip.generation.status }),
        shot: shot ? { title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera, ambientSound: shot.ambientSound,
          referenceMode: shot.referenceMode, sourceFingerprint: shot.sourceFingerprint } : null };
    }) }));
}
export type AudioPostProcessingSettings = {
  clipId: string; sourceAssetId: string; start: AudioPostProcessingAnchor; end: AudioPostProcessingAnchor;
  movement: AudioPostProcessingMovement; volumeDb: number; fadeInSeconds: number; fadeOutSeconds: number; binaural: boolean;
};
export function createAudioPostProcessingSettingsFingerprint(input: AudioPostProcessingSettings): string {
  return JSON.stringify({ version: AUDIO_POST_PROCESSING_RENDERER_VERSION, clipId: input.clipId, sourceAssetId: input.sourceAssetId,
    start: { pan: input.start.pan, distance: input.start.distance },
    end: input.movement === "static" ? { pan: input.start.pan, distance: input.start.distance } : { pan: input.end.pan, distance: input.end.distance },
    movement: input.movement, volumeDb: input.volumeDb, fadeInSeconds: input.fadeInSeconds, fadeOutSeconds: input.fadeOutSeconds, binaural: input.binaural });
}
function anchorEqual(a: AudioPostProcessingAnchor, b: AudioPostProcessingAnchor) { return a.pan === b.pan && a.distance === b.distance; }
export function getAudioPostProcessingRenderSettings(project: AsmrProject, shot: AudioPostProcessingShot): AudioPostProcessingSettings {
  const clip = getAudioPostProcessingClips(project).find(item => item.id === shot.clipId);
  if (!clip || clip.kind === "silent") throw new Error("找不到后处理原音片段。");
  const end = { pan: clip.position.pan, distance: clip.position.distance };
  return { clipId: clip.id, sourceAssetId: shot.sourceAssetId, start: clip.position.movement === "static" ? end : shot.start,
    end, movement: clip.position.movement, volumeDb: clip.volume_db, fadeInSeconds: clip.fade_in, fadeOutSeconds: clip.fade_out, binaural: project.timeline.mixing.binaural };
}
function currentReceipt(project: AsmrProject, clipId: string, fingerprint: string) {
  const state = project.audioPostProcessing;
  if (!state || state.inputFingerprint !== fingerprint) return undefined;
  const clip = getAudioPostProcessingClips(project).find(item => item.id === clipId);
  const shot = state.shots.find(item => item.clipId === clipId), receipt = state.results[clipId];
  if (!clip || clip.kind === "silent" || clip.audio_stale || !shot || !receipt || receipt.clipId !== clipId || clip.asset.asset_id !== shot.sourceAssetId
    || receipt.inputFingerprint !== state.inputFingerprint || receipt.sourceAssetId !== shot.sourceAssetId || receipt.sourceSha256 !== shot.sourceSha256
    || receipt.rendererVersion !== AUDIO_POST_PROCESSING_RENDERER_VERSION || !anchorEqual(shot.end, clip.position) || shot.movement !== clip.position.movement) return undefined;
  return receipt.settingsFingerprint === createAudioPostProcessingSettingsFingerprint(getAudioPostProcessingRenderSettings(project, shot)) ? receipt : undefined;
}
export function getCurrentAudioPostProcessingReceipt(project: AsmrProject, clipId: string) {
  if (!project.audioPostProcessing) return undefined;
  return currentReceipt(project, clipId, createAudioPostProcessingInputFingerprint(project));
}
/** One input hash per batch, including when readers only need part of the current set. */
export function getCurrentAudioPostProcessingReceipts(project: AsmrProject): Map<string, AudioPostProcessingReceipt> {
  const result = new Map<string, AudioPostProcessingReceipt>();
  if (!project.audioPostProcessing) return result;
  const fingerprint = createAudioPostProcessingInputFingerprint(project);
  for (const clip of getAudioPostProcessingClips(project)) {
    const receipt = currentReceipt(project, clip.id, fingerprint);
    if (receipt) result.set(clip.id, receipt);
  }
  return result;
}
export function getCurrentProcessedVoiceAsset(project: AsmrProject, clipId: string) { return getCurrentAudioPostProcessingReceipt(project, clipId)?.asset; }
export function getAudioPostProcessingSummary(project: AsmrProject) {
  const all = getAudioPostProcessingClips(project), clips = all.filter(clip => clip.kind !== "silent");
  let reason = "";
  if (!clips.length) reason = "请先添加并采用人声音频。";
  else if (new Set(all.map(clip => clip.id)).size !== all.length) reason = "片段编号重复，请检查工程。";
  else if (clips.some(clip => clip.audio_stale || clip.generation.status !== "asset_generated" || !clip.asset.asset_id || clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`)) reason = "请先生成并采用全部当前原音。";
  else {
    const prompts = getUsableClipH3Prompts(project);
    if (all.some(clip => !prompts.has(clip.id))) reason = "请先补齐全部当前分镜。";
  }
  const fingerprint = createAudioPostProcessingInputFingerprint(project);
  const pendingClipIds = clips.filter(clip => !currentReceipt(project, clip.id, fingerprint)).map(clip => clip.id);
  const ready = !reason, hasPlan = Boolean(project.audioPostProcessing);
  const planCurrent = Boolean(hasPlan && project.audioPostProcessing!.inputFingerprint === fingerprint);
  return { ready, complete: ready && pendingClipIds.length === 0, total: clips.length, completed: clips.length - pendingClipIds.length,
    pending: pendingClipIds.length, pendingClipIds, reason, hasPlan, planCurrent };
}
/** Keep manual positions while reusing one source-bound AI plan. */
export function synchronizeAudioPostProcessingPlan(project: AsmrProject, input: AudioPostProcessing): AudioPostProcessing {
  const state = structuredClone(input), clips = getAudioPostProcessingClips(project);
  let previous: AudioPostProcessingAnchor | undefined;
  state.shots = state.shots.map(shot => {
    const clip = clips.find(item => item.id === shot.clipId);
    if (!clip) throw new Error("后处理片段已变化，请重新规划。");
    const manual = !anchorEqual(shot.end, clip.position) || shot.movement !== clip.position.movement;
    const end = manual ? { pan: clip.position.pan, distance: clip.position.distance } : shot.end;
    const movement = manual ? clip.position.movement : shot.movement;
    const reset = shot.reset || (manual && movement === "static");
    const start = manual && movement === "static" ? end : !reset && previous ? previous : shot.start;
    const updated = { ...shot, reset, start, end: movement === "static" ? start : end, movement };
    previous = updated.end;
    return updated;
  });
  return state;
}
export function applyAudioPostProcessingPlan(project: AsmrProject, input: AudioPostProcessing): AsmrProject {
  const state = AudioPostProcessingSchema.parse(structuredClone(input));
  if (state.inputFingerprint !== createAudioPostProcessingInputFingerprint(project)) throw new Error("剧情、原音或分镜已变化，请重新生成后处理规划。");
  const clips = getAudioPostProcessingClips(project).filter(clip => clip.kind !== "silent");
  if (state.shots.length !== clips.length || state.shots.some((shot, index) => shot.clipId !== clips[index].id || shot.sourceAssetId !== clips[index].asset.asset_id)) throw new Error("后处理规划与当前片段不一致。");
  let previous: AudioPostProcessingAnchor | undefined;
  for (const shot of state.shots) {
    if (!shot.reset && previous) shot.start = { ...previous };
    if (shot.movement === "static") shot.end = { ...shot.start };
    previous = shot.end;
  }
  const shots = new Map(state.shots.map(shot => [shot.clipId, shot]));
  return captureSpeechWorkspace({ ...project, audioPostProcessing: state, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.track_type !== "voice" ? track : {
    ...track, clips: track.clips.map(clip => { const shot = shots.get(clip.id); return shot ? { ...clip, position: { ...shot.end, movement: shot.movement } } : clip; }),
  }) } });
}
export function applyAudioPostProcessingResult(project: AsmrProject, clipId: string, input: unknown): AsmrProject {
  const receipt = AudioPostProcessingReceiptSchema.parse(input);
  if (!project.audioPostProcessing || receipt.clipId !== clipId) throw new Error("后处理回执与当前片段不一致。");
  const updated = { ...project, audioPostProcessing: { ...project.audioPostProcessing, results: { ...project.audioPostProcessing.results, [clipId]: receipt } } };
  if (!getCurrentAudioPostProcessingReceipt(updated, clipId)) throw new Error("后处理输入或参数已变化，保留原音并重新处理。");
  return captureSpeechWorkspace(updated);
}
