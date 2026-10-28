import type { AsmrProject, VoiceClip } from "./schema";
import { creativeTemplateContext, getMatchingTemplateDirections } from "./reference-template";
import { resolveStoryboardStyle } from "./storyboard-style";

/** Script order is the voice-track array order, independent of engineering time. */
function scriptClips(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : []);
}
function knownDuration(clip: VoiceClip): number | undefined {
  const value = clip.kind === "silent" ? clip.duration
    : clip.generation.status === "asset_generated" && !clip.audio_stale && clip.asset.asset_id
      && clip.asset.uri === `asset://clip/${clip.asset.asset_id}` ? clip.asset.duration : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function visibleContext(project: AsmrProject, clipId: string) {
  const shot = project.videoPlan?.shots[clipId];
  // POV camera notes carry the listener's location/orientation; legacy camera framing stays local.
  return shot ? { title: shot.title, visual: shot.visual, action: shot.action,
    ...(shot.storyboardStyle === "listener_pov" ? { camera: shot.camera } : {}),
    ...(shot.ambientSound ? { ambientSound: shot.ambientSound } : {}),
    ...(shot.asmrSound ? { asmrSound: shot.asmrSound } : {}) } : undefined;
}

/** No audio bytes, asset locations, timeline starts, waits or estimated speech lengths. */
export function createStoryboardScriptContext(project: AsmrProject, currentClipId: string, currentMeasuredDuration?: number) {
  const clips = scriptClips(project);
  return {
    currentIndex: clips.findIndex(clip => clip.id === currentClipId),
    storyboardStyle: resolveStoryboardStyle(project.videoPlan),
    ...(project.videoPlan?.referenceTemplate ? { referenceTemplate: creativeTemplateContext(project.videoPlan.referenceTemplate) } : {}),
    scriptOrder: clips.map((clip, index) => {
      const durationSeconds = clip.id === currentClipId && typeof currentMeasuredDuration === "number" && Number.isFinite(currentMeasuredDuration) && currentMeasuredDuration > 0
        ? currentMeasuredDuration : knownDuration(clip);
      const storyboardContext = clip.id === currentClipId ? undefined : visibleContext(project, clip.id);
      const directorNotes = clip.kind === "silent" ? [] : getMatchingTemplateDirections(project.videoPlan?.templateDirections, clip.text);
      return { index, clipId: clip.id, kind: clip.kind === "silent" ? "silent" as const : "speech" as const, text: clip.text,
        ...(durationSeconds === undefined ? {} : { durationSeconds }), ...(storyboardContext ? { storyboardContext } : {}),
        ...(directorNotes.length ? { directorNotes } : {}) };
    }),
  };
}

/** In-flight identity only: saved-shot source fingerprints and validity stay unchanged. */
export function createStoryboardGenerationContextFingerprint(project: AsmrProject): string {
  return JSON.stringify({ version: "storyboard-generation-context-v1", baseScene: project.videoPlan?.sceneDescription ?? project.scene.name,
    storyboardStyle: resolveStoryboardStyle(project.videoPlan),
    ...(project.videoPlan?.referenceTemplate ? { referenceTemplate: creativeTemplateContext(project.videoPlan.referenceTemplate) } : {}),
    role: project.character.role, scriptOrder: scriptClips(project).map((clip, index) => ({ index, clipId: clip.id,
      kind: clip.kind === "silent" ? "silent" : "speech", text: clip.text, durationSeconds: knownDuration(clip),
      storyboardContext: visibleContext(project, clip.id),
      ...(clip.kind !== "silent" && getMatchingTemplateDirections(project.videoPlan?.templateDirections, clip.text).length
        ? { directorNotes: getMatchingTemplateDirections(project.videoPlan?.templateDirections, clip.text) } : {}) })) });
}
