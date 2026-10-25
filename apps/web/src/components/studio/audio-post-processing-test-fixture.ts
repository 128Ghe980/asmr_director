import { demoProject } from "@/lib/asmr/mock-project";
import { applyAudioPostProcessingPlan, applyAudioPostProcessingResult, createAudioPostProcessingInputFingerprint,
  createAudioPostProcessingSettingsFingerprint, getAudioPostProcessingClips, getAudioPostProcessingRenderSettings } from "@/lib/asmr/audio-post-processing";
import { AUDIO_POST_PROCESSING_RENDERER_VERSION, type AudioPostProcessing, type AudioPostProcessingReceipt } from "@/lib/asmr/audio-post-processing-schema";
import type { AsmrProject } from "@/lib/asmr/schema";
import { createClipVideoSourceFingerprint } from "@/lib/asmr/video-plan";

export function postProcessingProject() {
  const project = structuredClone(demoProject);
  project.project_id = "post_processing_ui";
  project.title = "合成后处理工程";
  project.timeline.tracks = project.timeline.tracks.map(track => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 2).map((clip, index) => ({ ...clip, start: index * 3, duration: 1, text: `第${index + 1}句合成测试。`,
      asset: { asset_id: `raw_${index}`, uri: `asset://clip/raw_${index}`, duration: 1 }, audio_stale: false,
      generation: { ...clip.generation, status: "asset_generated" as const, error: null } })) } : { ...track, clips: [] });
  project.videoPlan = { version: 1, sceneDescription: "安静木屋。", shots: {} };
  for (const clip of getAudioPostProcessingClips(project)) project.videoPlan.shots[clip.id] = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id), referenceMode: "new",
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 1 }, title: "合成一镜", visual: "Warm room", action: "Sits still", camera: "Medium shot",
  };
  return project;
}

export function postProcessingPlan(project: AsmrProject): AudioPostProcessing {
  return { version: 1, inputFingerprint: createAudioPostProcessingInputFingerprint(project), provider: "api", model: "mock-planner", results: {},
    shots: getAudioPostProcessingClips(project).filter(clip => clip.kind !== "silent").map((clip, index) => ({ clipId: clip.id,
      sourceAssetId: clip.asset.asset_id!, sourceSha256: "a".repeat(64), durationSeconds: clip.asset.duration!, reason: "随剧情自然靠近。",
      start: { pan: index ? .2 : 0, distance: "near" }, end: { pan: .2, distance: "near" }, movement: "approach", reset: index === 0 })) };
}

export function postProcessingReceipt(project: AsmrProject, clipId: string): AudioPostProcessingReceipt {
  const state = project.audioPostProcessing!;
  const shot = state.shots.find(item => item.clipId === clipId)!;
  const index = state.shots.indexOf(shot);
  return { clipId, sourceAssetId: shot.sourceAssetId, inputFingerprint: state.inputFingerprint,
    asset: { assetId: `processed_${index}`, uri: `asset://clip/processed_${index}`, duration: 1.65 },
    sourceSha256: shot.sourceSha256, outputSha256: "b".repeat(64), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION,
    settingsFingerprint: createAudioPostProcessingSettingsFingerprint(getAudioPostProcessingRenderSettings(project, shot)) };
}

export function processedProject(count = 2) {
  const original = postProcessingProject();
  let project = applyAudioPostProcessingPlan(original, postProcessingPlan(original));
  for (const clip of getAudioPostProcessingClips(project).slice(0, count)) project = applyAudioPostProcessingResult(project, clip.id, postProcessingReceipt(project, clip.id));
  return project;
}
