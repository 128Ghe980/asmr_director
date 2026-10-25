import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyAudioPostProcessingPlan, applyAudioPostProcessingResult, createAudioPostProcessingInputFingerprint,
  createAudioPostProcessingSettingsFingerprint, getAudioPostProcessingRenderSettings } from "./audio-post-processing";
import { AUDIO_POST_PROCESSING_RENDERER_VERSION, type AudioPostProcessing } from "./audio-post-processing-schema";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createClipVideoSourceFingerprint } from "./video-plan";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Real stored WAVs and receipts, shared by delivery tests; no render or model calls. */
export async function makePreparedAudioFixture(config: LocalRuntimeConfig, count = 2, binaural = true) {
  let project = structuredClone(demoProject);
  const originals = project.timeline.tracks.find(track => track.track_type === "voice")!.clips.slice(0, count);
  project.timeline.tracks = project.timeline.tracks.map(track => track.track_type === "voice" ? { ...track, clips: originals } : { ...track, clips: [] });
  project.duration = Math.max(1, count * .1 + .65);
  project.emotion_curve = [{ start: 0, end: project.duration, emotion: "平静" }];
  project.timeline.mixing = { ...project.timeline.mixing, binaural, master_limiter: false };
  project.videoPlan = { version: 1, sceneDescription: "安静木屋，角色接过外套后在近处坐下。", shots: {} };
  const raw = Buffer.from(writePcm16Wav(new Float32Array(4800).fill(.25), 48000));
  const samples = new Float32Array(36000 * 2);
  for (let frame = 0; frame < 36000; frame++) { samples[frame * 2] = .04; samples[frame * 2 + 1] = .02; }
  const processed = Buffer.from(writePcm16Wav(samples, 48000, 2));
  await mkdir(config.clipAssetRoot, { recursive: true });
  for (const [index, clip] of originals.entries()) {
    clip.start = index * .1; clip.duration = .1; clip.pause_after = 25;
    clip.fade_in = .05; clip.fade_out = .05; clip.volume_db = -12;
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `original_${index}`, uri: `asset://clip/original_${index}`, duration: .1 };
    await writeFile(path.join(config.clipAssetRoot, `original_${index}.wav`), raw);
    await writeFile(path.join(config.clipAssetRoot, `prepared_${index}.wav`), processed);
    project.videoPlan.shots[clip.id] = { version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: .1 },
      title: "递毛巾", visual: "S1 sits beside the listener.", action: "S1 offers a towel and remains nearby.", camera: "Static medium shot.", referenceMode: "new" };
  }
  const state: AudioPostProcessing = { version: 1, provider: "api", model: "fixture-model", results: {},
    inputFingerprint: createAudioPostProcessingInputFingerprint(project),
    shots: originals.map((clip, index) => ({ clipId: clip.id, sourceAssetId: clip.asset.asset_id!, sourceSha256: digest(raw),
      durationSeconds: .1, reason: index ? "保持近处" : "递毛巾时靠近", reset: index === 0,
      start: { pan: 0, distance: index ? "near" : "mid" }, end: { pan: 0, distance: "near" }, movement: index ? "static" : "approach" })) };
  project = applyAudioPostProcessingPlan(project, state);
  for (const [index, shot] of project.audioPostProcessing!.shots.entries()) {
    project = applyAudioPostProcessingResult(project, shot.clipId, { clipId: shot.clipId, sourceAssetId: shot.sourceAssetId,
      inputFingerprint: state.inputFingerprint, sourceSha256: digest(raw), outputSha256: digest(processed),
      settingsFingerprint: createAudioPostProcessingSettingsFingerprint(getAudioPostProcessingRenderSettings(project, shot)),
      rendererVersion: AUDIO_POST_PROCESSING_RENDERER_VERSION,
      asset: { assetId: `prepared_${index}`, uri: `asset://clip/prepared_${index}`, duration: .75 } });
  }
  return { project, raw, processed, clipIds: originals.map(clip => clip.id) };
}

export function readStoredZip(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = bytes.readUInt32LE(bytes.length - 6);
  for (let index = 0; index < bytes.readUInt16LE(bytes.length - 12); index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid stored ZIP");
    const local = bytes.readUInt32LE(offset + 42), nameLength = bytes.readUInt16LE(offset + 28);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    result.set(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"), bytes.subarray(start, start + bytes.readUInt32LE(offset + 24)));
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return result;
}
