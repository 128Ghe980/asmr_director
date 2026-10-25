import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { AsmrProjectSchema } from "./schema";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { switchSpeechWorkspace } from "./speech-workspace";
import { AUDIO_POST_PROCESSING_RENDERER_VERSION, AudioPostProcessingSchema } from "./audio-post-processing-schema";
import { applyAudioPostProcessingPlan, applyAudioPostProcessingResult, createAudioPostProcessingInputFingerprint, createAudioPostProcessingSettingsFingerprint, getAudioPostProcessingRenderSettings, getAudioPostProcessingSummary, getCurrentAudioPostProcessingReceipt, getCurrentAudioPostProcessingReceipts, getCurrentProcessedVoiceAsset } from "./audio-post-processing";

function fixture() {
  const project = structuredClone(demoProject);
  const voice = project.timeline.tracks.find(track => track.track_type === "voice")!;
  voice.clips = voice.clips.slice(0, 2);
  voice.clips.forEach((clip, index) => {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `raw_${index}`, uri: `asset://clip/raw_${index}`, duration: 1 };
  });
  project.videoPlan = { version: 1, sceneDescription: "安静木屋。", shots: {} };
  for (const clip of voice.clips) project.videoPlan.shots[clip.id] = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 1 }, title: "一镜", visual: "Warm room", action: "Sits still", camera: "Medium shot", referenceMode: "new",
  };
  const state = AudioPostProcessingSchema.parse({ version: 1, inputFingerprint: createAudioPostProcessingInputFingerprint(project), provider: "api", model: "configured-model", results: {},
    shots: voice.clips.map((clip, index) => ({ clipId: clip.id, sourceAssetId: clip.asset.asset_id, sourceSha256: "a".repeat(64), durationSeconds: 1, reason: "自然衔接", start: { pan: index ? .2 : 0, distance: "near" }, end: { pan: .2, distance: "near" }, movement: "approach", reset: index === 0 })) });
  return { project, voice, state };
}

describe("explicit audio post-processing project state", () => {
  it("requires adopted originals and complete current storyboards", () => {
    expect(getAudioPostProcessingSummary(demoProject).ready).toBe(false);
    const { project, voice } = fixture();
    expect(getAudioPostProcessingSummary(project)).toMatchObject({ ready: true, complete: false, total: 2, completed: 0, pending: 2 });
    project.videoPlan!.shots[voice.clips[0].id].visual = "";
    expect(getAudioPostProcessingSummary(project).ready).toBe(false);
  });

  it("binds script, original source, workspace and actual shots but excludes engineering timing and DSP", () => {
    const { project, voice } = fixture();
    const original = createAudioPostProcessingInputFingerprint(project);
    voice.clips[0].start += .1; voice.clips[0].duration += .2; voice.clips[0].pause_after = 30;
    voice.clips[0].position.pan = -.8; voice.clips[0].volume_db = -9; project.timeline.mixing.binaural = false;
    expect(createAudioPostProcessingInputFingerprint(project)).toBe(original);
    project.videoPlan!.shots[voice.clips[0].id].action = "Walks away";
    expect(createAudioPostProcessingInputFingerprint(project)).not.toBe(original);
  });

  it("uses a compact stable input identity without repeating the full script in every result", () => {
    const { project, voice, state } = fixture();
    const template = structuredClone(voice.clips[0]), shot = state.shots[0];
    voice.clips = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(template), id: `clip_${index}`, text: "安静地坐一会儿。".repeat(60) }));
    const fingerprint = createAudioPostProcessingInputFingerprint(project);
    expect(fingerprint).toMatch(/^audio-post-v1:[a-f0-9]{32}$/);
    expect(createAudioPostProcessingInputFingerprint(structuredClone(project))).toBe(fingerprint);
    const reordered = structuredClone(project);
    reordered.scene = { name: reordered.scene.name, id: reordered.scene.id };
    expect(createAudioPostProcessingInputFingerprint(reordered)).toBe(fingerprint);
    project.character.role += "变化";
    expect(createAudioPostProcessingInputFingerprint(project)).not.toBe(fingerprint);
    const shots = voice.clips.map(clip => ({ ...shot, clipId: clip.id }));
    const results = Object.fromEntries(shots.map(item => [item.clipId, { clipId: item.clipId, sourceAssetId: item.sourceAssetId, inputFingerprint: fingerprint,
      asset: { assetId: `processed_${item.clipId}`, uri: `asset://clip/processed_${item.clipId}`, duration: 1 }, sourceSha256: item.sourceSha256,
      outputSha256: "b".repeat(64), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION, settingsFingerprint: "settings" }]));
    const processing = AudioPostProcessingSchema.parse({ ...state, inputFingerprint: fingerprint, shots, results });
    expect(JSON.stringify(processing).length).toBeLessThan(100_000);
  });

  it("keeps raw adoption intact and only accepts receipts bound to current source and settings", () => {
    const { project, voice, state } = fixture();
    const planned = applyAudioPostProcessingPlan(project, state);
    const clip = planned.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    const shot = planned.audioPostProcessing!.shots[0];
    expect(clip.asset).toEqual(voice.clips[0].asset);
    const receipt = { clipId: clip.id, sourceAssetId: shot.sourceAssetId, inputFingerprint: state.inputFingerprint,
      asset: { assetId: "processed_1", uri: "asset://clip/processed_1", duration: 1.3 }, sourceSha256: shot.sourceSha256,
      outputSha256: "b".repeat(64), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION,
      settingsFingerprint: createAudioPostProcessingSettingsFingerprint({ clipId: clip.id, sourceAssetId: shot.sourceAssetId, start: shot.start, end: shot.end, movement: shot.movement, volumeDb: clip.volume_db, fadeInSeconds: clip.fade_in, fadeOutSeconds: clip.fade_out, binaural: planned.timeline.mixing.binaural }) };
    const ready = applyAudioPostProcessingResult(planned, clip.id, receipt);
    expect(getCurrentProcessedVoiceAsset(ready, clip.id)).toEqual(receipt.asset);
    const changed = structuredClone(ready);
    changed.timeline.tracks.find(track => track.track_type === "voice")!.clips[0].position.pan = -.4;
    expect(getCurrentProcessedVoiceAsset(changed, clip.id)).toBeUndefined();
    expect(changed.audioPostProcessing!.results[clip.id]).toEqual(receipt);
    expect(() => applyAudioPostProcessingResult(planned, clip.id, { ...receipt, sourceSha256: "c".repeat(64) })).toThrow();
  });

  it("canonicalizes static movement and rejects a late plan after script changes", () => {
    const { project, voice, state } = fixture();
    state.shots[0].movement = "static";
    const planned = applyAudioPostProcessingPlan(project, state);
    expect(planned.audioPostProcessing!.shots[0].end).toEqual(state.shots[0].start);
    voice.clips[0].text += "改变。";
    expect(() => applyAudioPostProcessingPlan(project, state)).toThrow();
  });

  it("round-trips processing separately across speech workspaces and tolerates legacy metadata", () => {
    const { project, state } = fixture();
    const planned = applyAudioPostProcessingPlan(project, state);
    const paragraph = switchSpeechWorkspace(planned, "paragraph");
    expect(paragraph.audioPostProcessing).toBeUndefined();
    const restored = switchSpeechWorkspace(paragraph, "short");
    expect(restored.audioPostProcessing).toEqual(planned.audioPostProcessing);
    expect(AsmrProjectSchema.parse({ ...project, audioPostProcessing: { broken: true } }).audioPostProcessing).toBeUndefined();
  });

  it("returns the same current receipts in a batch for absent, partial and stale plans", () => {
    const { project, state } = fixture();
    expect(getCurrentAudioPostProcessingReceipts(project).size).toBe(0);
    expect(getCurrentAudioPostProcessingReceipt(project, state.shots[0].clipId)).toBeUndefined();
    const planned = applyAudioPostProcessingPlan(project, state), shot = planned.audioPostProcessing!.shots[0];
    expect(getCurrentAudioPostProcessingReceipts(planned).size).toBe(0);
    const partial = applyAudioPostProcessingResult(planned, shot.clipId, {
      clipId: shot.clipId, sourceAssetId: shot.sourceAssetId, inputFingerprint: state.inputFingerprint,
      asset: { assetId: "processed_batch", uri: "asset://clip/processed_batch", duration: 1.3 }, sourceSha256: shot.sourceSha256,
      outputSha256: "b".repeat(64), rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION,
      settingsFingerprint: createAudioPostProcessingSettingsFingerprint(getAudioPostProcessingRenderSettings(planned, shot)),
    });
    const batch = getCurrentAudioPostProcessingReceipts(partial);
    expect([...batch.keys()]).toEqual([shot.clipId]);
    for (const item of state.shots) expect(batch.get(item.clipId)).toEqual(getCurrentAudioPostProcessingReceipt(partial, item.clipId));
    const changedSettings = structuredClone(partial);
    changedSettings.timeline.tracks.find(track => track.track_type === "voice")!.clips[0].volume_db -= 1;
    expect(getCurrentAudioPostProcessingReceipts(changedSettings).size).toBe(0);
    const changedInput = structuredClone(partial);
    changedInput.videoPlan!.shots[shot.clipId].action = "Walks away";
    expect(getCurrentAudioPostProcessingReceipts(changedInput).size).toBe(0);
    expect(partial.audioPostProcessing!.results[shot.clipId]).toBeDefined();
  });
});
