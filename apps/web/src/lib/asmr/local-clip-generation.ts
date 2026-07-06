import {
  buildGptSovitsRequest,
  requestGptSovitsWav,
} from "./gpt-sovits-provider";
import { saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { GeneratedAssetResult } from "./generation-bridge";
import type { AsmrProject } from "./schema";
import { flattenClips } from "./view-model";
import { loadVoicePack } from "./voice-pack";

export type GenerateLocalVoiceClipInput = {
  project: AsmrProject;
  clipId: string;
  config: LocalRuntimeConfig;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function generateLocalVoiceClip({
  project,
  clipId,
  config,
  fetchImpl,
  now,
}: GenerateLocalVoiceClipInput): Promise<GeneratedAssetResult> {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error("Clip not found");
  }

  const voicePack = await loadVoicePack(config);
  const request = buildGptSovitsRequest(clip, voicePack);
  const wav = await requestGptSovitsWav({
    endpoint: voicePack.endpoint || config.gptSovitsBaseUrl,
    request,
    fetchImpl,
  });

  return saveClipAsset({
    config,
    clipId,
    wav,
    duration: clip.duration,
    now,
  });
}
