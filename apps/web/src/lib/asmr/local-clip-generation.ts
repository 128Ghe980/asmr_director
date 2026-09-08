import {
  buildGptSovitsRequest,
  requestGptSovitsWav,
} from "./gpt-sovits-provider";
import {
  canRenderProceduralClip,
  renderProceduralClipWav,
} from "./procedural-audio";
import { saveClipAsset } from "./local-asset-store";
import { decodePcmWav } from "./project-mix-renderer";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { GeneratedAssetResult } from "./generation-bridge";
import type { AsmrProject } from "./schema";
import { flattenClips } from "./view-model";
import { loadVoicePack } from "./voice-pack";
import { generateLocalVoiceCandidate } from "./local-voice-candidate-generation";
import type { AudioCandidate } from "./audio-candidate";
import { VoiceGenerationOptionsSchema, type VoiceGenerationOptions, type LongTextRetry } from "./voice-generation-options";
import type { VoiceGenerationProgress } from "./voice-longtext-generation";

export type GenerateLocalClipInput = {
  project: AsmrProject;
  clipId: string;
  config: LocalRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
  voiceOptions?: VoiceGenerationOptions;
  longTextRetry?: LongTextRetry;
  signal?: AbortSignal;
  onProgress?: (progress: VoiceGenerationProgress) => void;
};

export function generateLocalClip(input: GenerateLocalClipInput & { voiceOptions?: undefined }): Promise<GeneratedAssetResult>;
export function generateLocalClip(input: GenerateLocalClipInput): Promise<GeneratedAssetResult | { candidate: AudioCandidate }>;
export async function generateLocalClip({
  project,
  clipId,
  config,
  fetchImpl,
  now,
  voiceOptions,
  longTextRetry,
  signal,
  onProgress,
}: GenerateLocalClipInput): Promise<GeneratedAssetResult | { candidate: AudioCandidate }> {
  signal?.throwIfAborted();
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error("Clip not found");
  }

  if (voiceOptions) {
    voiceOptions = VoiceGenerationOptionsSchema.parse(voiceOptions);
    if (clip.type !== "voice") throw new Error("Voice options require a voice clip");
    if (voiceOptions.provider === "voxcpm2") {
      return generateLocalVoiceCandidate({ project, clip, config, voiceOptions, signal, now, onProgress, longTextRetry });
    }
  }

  if (canRenderProceduralClip(clip)) {
    const wav = renderProceduralClipWav({ clip });

    return saveClipAsset({
      config,
      clipId,
      wav,
      duration: clip.duration,
      now,
    });
  }

  const voicePack = await loadVoicePack(config);
  const request = buildGptSovitsRequest(clip, voicePack);
  const wav = await requestGptSovitsWav({
    endpoint: voicePack.endpoint || config.gptSovitsBaseUrl,
    request,
    fetchImpl,
  });
  const decoded = decodePcmWav(new Uint8Array(wav));
  const duration = decoded.samples.length / decoded.channels / decoded.sampleRate;

  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    decoded.samples.length % decoded.channels !== 0
  ) {
    throw new Error("Invalid voice WAV duration or sample frames");
  }

  return saveClipAsset({
    config,
    clipId,
    wav,
    duration,
    now,
  });
}

export async function generateLocalVoiceClip(
  input: GenerateLocalClipInput & { voiceOptions?: undefined },
): Promise<GeneratedAssetResult> {
  return generateLocalClip(input);
}
