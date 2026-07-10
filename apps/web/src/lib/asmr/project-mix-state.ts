import type { GeneratedAssetResult } from "./generation-bridge";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

export type ProjectMixFailureReason = "mix" | "remix" | "retry";

export type ProjectMixFailureInput = {
  reason: ProjectMixFailureReason;
  error: string;
};

type ProjectExport = AsmrProject["exports"][number];

const localClipAssetPrefix = "asset://clip/";
const localMixAssetPrefix = "asset://mix/";
const audioBearingTracks = new Set<TimelineClip["track"]>([
  "voice",
  "breath",
  "sfx",
  "ambience",
]);

function isAudioBearingClip(clip: TimelineClip): boolean {
  return audioBearingTracks.has(clip.track);
}

function hasGeneratedLocalClipAsset(clip: TimelineClip): boolean {
  return (
    clip.generation.status === "asset_generated" &&
    Boolean(clip.asset.asset_id) &&
    Boolean(clip.asset.uri?.startsWith(localClipAssetPrefix))
  );
}

export function getMissingProjectMixClipIds(project: AsmrProject): string[] {
  return flattenClips(project)
    .filter(
      (clip) => isAudioBearingClip(clip) && !hasGeneratedLocalClipAsset(clip),
    )
    .map((clip) => clip.id);
}

export function canGenerateProjectMix(project: AsmrProject): boolean {
  return getMissingProjectMixClipIds(project).length === 0;
}

export function getWavExport(
  project: AsmrProject,
): ProjectExport | undefined {
  return project.exports.find((entry) => entry.type === "wav");
}

function upsertWavExport(
  project: AsmrProject,
  nextWavExport: ProjectExport,
): AsmrProject {
  const hasWavExport = Boolean(getWavExport(project));
  const exports = hasWavExport
    ? project.exports.map((entry) =>
        entry.type === "wav" ? nextWavExport : entry,
      )
    : [...project.exports, nextWavExport];

  return {
    ...project,
    exports,
  };
}

export function commitProjectMixSuccess(
  project: AsmrProject,
  asset: GeneratedAssetResult,
): AsmrProject {
  return upsertWavExport(project, {
    type: "wav",
    status: "exported",
    uri: asset.uri,
  });
}

export function commitProjectMixFailure(
  project: AsmrProject,
  _failure: ProjectMixFailureInput,
): AsmrProject {
  const previousWavExport = getWavExport(project);

  if (
    previousWavExport?.status === "exported" &&
    previousWavExport.uri?.startsWith(localMixAssetPrefix)
  ) {
    return project;
  }

  return upsertWavExport(project, {
    type: "wav",
    status: "export_failed",
    uri: null,
  });
}
