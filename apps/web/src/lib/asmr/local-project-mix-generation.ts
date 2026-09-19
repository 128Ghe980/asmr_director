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
import { renderSpatialClip } from "./spatial-audio";
import { decodePcmWav } from "./pcm-audio";

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

  const wav = await renderProjectMixWav({
    project,
    sampleRate,
    signal,
    loadClipAsset: async (clip) => {
      if (!clip.asset.asset_id) {
        throw new Error(`Missing project mix clip asset id: ${clip.id}`);
      }

      if (clip.type === "voice" && project.timeline.mixing.binaural) {
        return renderSpatialClip({ assetId: clip.asset.asset_id, position: clip.position,
          durationSeconds: clip.duration, fadeInSeconds: clip.fade_in, fadeOutSeconds: clip.fade_out, config, signal });
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
