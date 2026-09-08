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

export type GenerateLocalClipInput = {
  project: AsmrProject;
  clipId: string;
  config: LocalRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function generateLocalClip({
  project,
  clipId,
  config,
  fetchImpl,
  now,
}: GenerateLocalClipInput): Promise<GeneratedAssetResult> {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error("Clip not found");
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
  input: GenerateLocalClipInput,
): Promise<GeneratedAssetResult> {
  return generateLocalClip(input);
}
