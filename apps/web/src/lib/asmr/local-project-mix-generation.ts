import { readFile } from "node:fs/promises";

import type { GeneratedAssetResult } from "./generation-bridge";
import {
  resolveClipAssetPath,
  saveMixAsset,
} from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getMissingProjectMixClipIds } from "./project-mix-state";
import { renderProjectMixWav } from "./project-mix-renderer";
import type { AsmrProject } from "./schema";
import { decodePcmWav } from "./pcm-audio";
import { getCurrentAudioPostProcessingReceipts } from "./audio-post-processing";
import { readPreparedAudioSource } from "./prepared-audio-source";

export type GenerateLocalProjectMixInput = {
  project: AsmrProject;
  config: LocalRuntimeConfig;
  exportType?: "wav";
  now?: Date;
  sampleRate?: number;
  signal?: AbortSignal;
};

export async function generateLocalProjectMix({
  project,
  config,
  exportType = "wav",
  now,
  sampleRate,
  signal,
}: GenerateLocalProjectMixInput): Promise<GeneratedAssetResult> {
  const missingClipIds = getMissingProjectMixClipIds(project);

  if (missingClipIds.length > 0) {
    throw new Error(
      `Missing project mix clip assets: ${missingClipIds.join(", ")}`,
    );
  }

  const voices = project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []).filter(clip => clip.kind !== "silent");
  const receipts = getCurrentAudioPostProcessingReceipts(project);
  const usePrepared = voices.length > 0 && voices.every(clip => receipts.has(clip.id));
  const wav = await renderProjectMixWav({
    project,
    sampleRate,
    signal,
    loadClipAsset: async (clip) => {
      if (!clip.asset.asset_id) {
        throw new Error(`Missing project mix clip asset id: ${clip.id}`);
      }

      if (clip.type === "voice") {
        if (usePrepared) {
          const prepared = await readPreparedAudioSource(project, clip.id, config, signal);
          if (!prepared) throw new Error("后处理结果已更新，请重新生成后处理。");
          return { wav: prepared.wav, spatialized: project.timeline.mixing.binaural, prepared: true };
        }
        return { wav: await readFile(resolveClipAssetPath(clip.asset.asset_id, config)), spatialized: false, original: true };
      }
      return readFile(resolveClipAssetPath(clip.asset.asset_id, config));
    },
  });

  signal?.throwIfAborted();
  const decoded = decodePcmWav(wav);
  return saveMixAsset({
    config,
    projectId: project.project_id,
    exportType,
    wav,
    duration: decoded.samples.length / decoded.channels / decoded.sampleRate,
    now,
  });
}
