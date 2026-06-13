import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";
import { safeParseAsmrProject } from "./validate";

type EditableClipFields = Pick<
  TimelineClip,
  "start" | "duration" | "volume_db"
>;

type EditableTypedFields = {
  ambience?: string;
  breath?: string;
  emotion?: string;
  loop?: boolean;
  pace?: string;
  sfx?: string;
  style?: string;
  text?: string;
};

export type ClipPatch = Partial<EditableClipFields & EditableTypedFields> & {
  position?: Partial<TimelineClip["position"]>;
};

export type ProjectValidationIssue = {
  path: string;
  message: string;
};

function applyClipPatch<TClip extends TimelineClip>(
  clip: TClip,
  patch: ClipPatch,
): TClip {
  const { position, ...rest } = patch;
  const nextClip = {
    ...clip,
    ...rest,
  } as TimelineClip;

  if (position) {
    nextClip.position = {
      ...clip.position,
      ...position,
    };
  }

  return nextClip as TClip;
}

export function updateClipInProject(
  project: AsmrProject,
  clipId: string,
  patch: ClipPatch,
): AsmrProject {
  let didUpdate = false;

  const tracks = project.timeline.tracks.map((track) => {
    const clips = track.clips as TimelineClip[];
    const hasTargetClip = clips.some((clip) => clip.id === clipId);

    if (!hasTargetClip) {
      return track;
    }

    didUpdate = true;

    return {
      ...track,
      clips: clips.map((clip) =>
        clip.id === clipId ? applyClipPatch(clip, patch) : clip,
      ),
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

export function getProjectValidationIssues(
  project: AsmrProject,
): ProjectValidationIssue[] {
  const parsed = safeParseAsmrProject(project);

  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
