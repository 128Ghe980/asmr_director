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
  options: { fitVoiceTiming?: boolean } = {},
): AsmrProject {
  const timedProject = options.fitVoiceTiming
    ? fitGeneratedVoiceTiming(project, clipId, asset.duration)
    : project;

  return updateClipGeneration(timedProject, clipId, (clip) => ({
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

function fitGeneratedVoiceTiming(
  project: AsmrProject,
  clipId: string,
  duration: number,
): AsmrProject {
  const voice = project.timeline.tracks
    .flatMap((track) => track.clips as TimelineClip[])
    .find((clip) => clip.id === clipId && clip.type === "voice");

  if (!voice) {
    return project;
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Invalid generated voice duration");
  }

  // Shorter takes retain the director's planned silence. Repeated generation
  // inserts only new growth, using the voice's current end as the boundary.
  if (duration <= voice.duration) {
    return project;
  }

  const delta = duration - voice.duration;
  const boundary = voice.start + voice.duration;
  const shift = (time: number) => time >= boundary ? time + delta : time;
  const tracks = project.timeline.tracks.map((track) => ({
    ...track,
    clips: (track.clips as TimelineClip[]).map((clip) => {
      if (clip.id === clipId) {
        return { ...clip, duration };
      }

      if (clip.start >= boundary) {
        return { ...clip, start: shift(clip.start) };
      }

      if (
        clip.type === "ambience" &&
        clip.loop &&
        clip.start + clip.duration >= boundary
      ) {
        return { ...clip, duration: clip.duration + delta };
      }

      return clip;
    }),
  } as TimelineTrack));
  const emotionCurve = project.emotion_curve.map((point) => ({
    ...point,
    start: shift(point.start),
    end: shift(point.end),
  }));
  // Floating-point association can put a clip end a fraction above the total.
  // Keep the expanded project valid without rounding down real audio duration.
  const projectDuration = Math.max(
    project.duration + delta,
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
    ...emotionCurve.map((point) => point.end),
  );

  if (!Number.isFinite(projectDuration)) {
    throw new Error("Invalid generated voice duration");
  }

  return {
    ...project,
    duration: projectDuration,
    emotion_curve: emotionCurve,
    timeline: { ...project.timeline, tracks },
  };
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
