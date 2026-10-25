import type { AsmrProject, VoiceClip } from "./schema";

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
  // Existing notes are optional semantic context, never an inherited camera or H3 prompt.
  return shot ? { title: shot.title, visual: shot.visual, action: shot.action,
    ...(shot.ambientSound ? { ambientSound: shot.ambientSound } : {}) } : undefined;
}

/** No audio bytes, asset locations, timeline starts, waits or estimated speech lengths. */
export function createStoryboardScriptContext(project: AsmrProject, currentClipId: string, currentMeasuredDuration?: number) {
  const clips = scriptClips(project);
  return {
    currentIndex: clips.findIndex(clip => clip.id === currentClipId),
    scriptOrder: clips.map((clip, index) => {
      const durationSeconds = clip.id === currentClipId && typeof currentMeasuredDuration === "number" && Number.isFinite(currentMeasuredDuration) && currentMeasuredDuration > 0
        ? currentMeasuredDuration : knownDuration(clip);
      const storyboardContext = clip.id === currentClipId ? undefined : visibleContext(project, clip.id);
      return { index, clipId: clip.id, kind: clip.kind === "silent" ? "silent" as const : "speech" as const, text: clip.text,
        ...(durationSeconds === undefined ? {} : { durationSeconds }), ...(storyboardContext ? { storyboardContext } : {}) };
    }),
  };
}

/** In-flight identity only: saved-shot source fingerprints and validity stay unchanged. */
export function createStoryboardGenerationContextFingerprint(project: AsmrProject): string {
  return JSON.stringify({ version: "storyboard-generation-context-v1", baseScene: project.videoPlan?.sceneDescription ?? project.scene.name,
    role: project.character.role, scriptOrder: scriptClips(project).map((clip, index) => ({ index, clipId: clip.id,
      kind: clip.kind === "silent" ? "silent" : "speech", text: clip.text, durationSeconds: knownDuration(clip),
      storyboardContext: visibleContext(project, clip.id) })) });
}
