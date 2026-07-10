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

export type GenerateLocalProjectMixInput = {
  project: AsmrProject;
  config: LocalRuntimeConfig;
  exportType?: "wav";
  now?: Date;
  sampleRate?: number;
};

export async function generateLocalProjectMix({
  project,
  config,
  exportType = "wav",
  now,
  sampleRate,
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
    loadClipAsset: async (clip) => {
      if (!clip.asset.asset_id) {
        throw new Error(`Missing project mix clip asset id: ${clip.id}`);
      }

      return readFile(resolveClipAssetPath(clip.asset.asset_id, config));
    },
  });

  return saveMixAsset({
    config,
    projectId: project.project_id,
    exportType,
    wav,
    duration: project.duration,
    now,
  });
}
