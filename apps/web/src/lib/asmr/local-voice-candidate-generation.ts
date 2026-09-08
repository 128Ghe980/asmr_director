import { randomUUID } from "node:crypto";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, getVoiceCandidateRequestFingerprint } from "./audio-candidate";
import { ensureAudioCandidateCapacity, saveAudioCandidate } from "./local-candidate-store";
import { saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./project-mix-renderer";
import type { AsmrProject, TimelineClip } from "./schema";
import type { VoiceGenerationOptions } from "./voice-generation-options";
import { generateVoxCpm2 } from "./voxcpm2-provider";

export async function generateLocalVoiceCandidate({ project, clip, config, voiceOptions, signal, now = new Date() }: {
  project: AsmrProject; clip: Extract<TimelineClip, { type: "voice" }>; config: LocalRuntimeConfig;
  voiceOptions: VoiceGenerationOptions; signal?: AbortSignal; now?: Date;
}) {
  signal?.throwIfAborted();
  const ownership = { config, projectId: project.project_id, clipId: clip.id, adoptedAssetId: clip.asset.asset_id ?? undefined };
  await ensureAudioCandidateCapacity(ownership);
  const result = await generateVoxCpm2({ text: clip.text, voicePackId: voiceOptions.voicePackId,
    referenceMode: voiceOptions.referenceMode, config, signal, now });
  signal?.throwIfAborted();
  const wav = decodePcmWav(result.wav);
  const duration = wav.samples.length / wav.channels / wav.sampleRate;
  if (!Number.isFinite(duration) || duration <= 0 || wav.samples.length % wav.channels !== 0) {
    throw new Error("Invalid voice WAV duration");
  }
  const asset = await saveClipAsset({ config, clipId: clip.id, wav: result.wav, duration, now });
  signal?.throwIfAborted();
  const candidate = AudioCandidateSchema.parse({
    version: 1, candidateId: `vox_${randomUUID().replaceAll("-", "")}`,
    projectId: project.project_id, clipId: clip.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip),
    requestFingerprint: getVoiceCandidateRequestFingerprint(clip, voiceOptions),
    asset, wav: { sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: 16 },
    provenance: result.provenance, qualityWarnings: result.qualityWarnings,
    createdAt: now.toISOString(), status: "ready",
  });
  await saveAudioCandidate({ config, candidate, adoptedAssetId: ownership.adoptedAssetId });
  return { candidate };
}
