import type {
  GeneratedAssetResult,
  GenerateClipReason,
} from "./generation-bridge";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";

type GenerationFailureInput = {
  reason: GenerateClipReason;
  error: string;
};

function hasAsset(clip: TimelineClip): boolean {
  return Boolean(clip.asset.asset_id || clip.asset.uri);
}

function updateClipGeneration(
  project: AsmrProject,
  clipId: string,
  update: (clip: TimelineClip) => TimelineClip,
): AsmrProject {
  let didUpdate = false;
  const tracks = project.timeline.tracks.map((track) => {
    const clips = track.clips as TimelineClip[];

    if (!clips.some((clip) => clip.id === clipId)) {
      return track;
    }

    didUpdate = true;

    return {
      ...track,
      clips: clips.map((clip) => (clip.id === clipId ? update(clip) : clip)),
    } as TimelineTrack;
  });

  if (!didUpdate) {
    return project;
  }

  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks,
    },
  };
}

export function commitGenerationSuccess(
  project: AsmrProject,
  clipId: string,
  asset: GeneratedAssetResult,
): AsmrProject {
  return updateClipGeneration(project, clipId, (clip) => ({
    ...clip,
    generation: {
      ...clip.generation,
      status: "asset_generated",
      error: null,
    },
    asset: {
      asset_id: asset.assetId,
      uri: asset.uri,
      duration: asset.duration,
    },
  }));
}

export function commitGenerationFailure(
  project: AsmrProject,
  clipId: string,
  { reason, error }: GenerationFailureInput,
): AsmrProject {
  return updateClipGeneration(project, clipId, (clip) => {
    if (reason === "regenerate" && hasAsset(clip)) {
      return {
        ...clip,
        generation: {
          ...clip.generation,
          status: "asset_generated",
          error: null,
        },
      };
    }

    return {
      ...clip,
      generation: {
        ...clip.generation,
        status: "asset_failed",
        error,
      },
      asset: {
        asset_id: null,
        uri: null,
        duration: null,
      },
    };
  });
}
