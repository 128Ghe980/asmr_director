import { updateClipInProject, type ClipPatch } from "./edit-project";
import type { AsmrProject, TimelineClip } from "./schema";

export type DirectorPreset =
  | "softer"
  | "closer"
  | "left-ear"
  | "right-ear"
  | "add-pause"
  | "quieter";

const MIN_VOLUME_DB = -80;
const MAX_VOLUME_DB = 12;
const LEFT_EAR_PAN = -0.82;
const RIGHT_EAR_PAN = 0.82;
const PAUSE_SECONDS = 0.5;
const PAUSE_MARKER = " ...";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampVolume(value: number): number {
  return clamp(value, MIN_VOLUME_DB, MAX_VOLUME_DB);
}

function findClip(project: AsmrProject, clipId: string): TimelineClip | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);

    if (clip) {
      return clip;
    }
  }

  return undefined;
}

function preserveSpatialMovement(
  movement: TimelineClip["position"]["movement"],
): TimelineClip["position"]["movement"] {
  return movement === "left_to_right" || movement === "right_to_left" || movement === "orbit" || movement === "orbit_approach"
    ? movement
    : "static";
}

function getAddPauseDuration(project: AsmrProject, clip: TimelineClip): number {
  const proposedDuration = clip.duration + PAUSE_SECONDS;
  const maxDuration = project.duration - clip.start;

  return proposedDuration <= maxDuration ? proposedDuration : clip.duration;
}

function buildPresetPatch(
  project: AsmrProject,
  clip: TimelineClip,
  preset: DirectorPreset,
): ClipPatch | undefined {
  if (clip.type !== "voice") {
    return undefined;
  }

  switch (preset) {
    case "softer":
      return {
        emotion: "gentle",
        style: "soft whisper",
        pace: "slow",
        volume_db: clampVolume(clip.volume_db - 2),
      };
    case "closer":
      if (clip.position.movement === "orbit_approach") return undefined;
      return {
        volume_db: clampVolume(clip.volume_db - 1),
        position: {
          distance: "very_close",
          movement: preserveSpatialMovement(clip.position.movement),
        },
      };
    case "left-ear":
      return {
        position: {
          pan: LEFT_EAR_PAN,
          distance: "very_close",
          movement: "static",
        },
      };
    case "right-ear":
      return {
        position: {
          pan: RIGHT_EAR_PAN,
          distance: "very_close",
          movement: "static",
        },
      };
    case "add-pause": {
      const hasPauseMarker = clip.text.endsWith(PAUSE_MARKER);

      return {
        text: hasPauseMarker ? clip.text : `${clip.text}${PAUSE_MARKER}`,
        duration: hasPauseMarker
          ? clip.duration
          : getAddPauseDuration(project, clip),
      };
    }
    case "quieter":
      return {
        volume_db: clampVolume(clip.volume_db - 3),
      };
  }
}

export function applyDirectorPreset(
  project: AsmrProject,
  clipId: string,
  preset: DirectorPreset,
): AsmrProject {
  const clip = findClip(project, clipId);

  if (!clip || clip.type !== "voice") {
    return project;
  }

  const patch = buildPresetPatch(project, clip, preset);

  if (!patch) {
    return project;
  }

  return updateClipInProject(project, clipId, patch);
}
