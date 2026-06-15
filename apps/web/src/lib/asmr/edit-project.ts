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

export type ClipFieldValidationKey =
  | "text"
  | "emotion"
  | "style"
  | "pace"
  | "breath"
  | "sfx"
  | "ambience"
  | "loop"
  | "start"
  | "duration"
  | "volume_db"
  | "position.pan"
  | "position.distance"
  | "position.movement";

export type ClipFieldValidationIssues = Partial<
  Record<ClipFieldValidationKey, ProjectValidationIssue[]>
>;

const clipFieldValidationKeys = new Set<ClipFieldValidationKey>([
  "text",
  "emotion",
  "style",
  "pace",
  "breath",
  "sfx",
  "ambience",
  "loop",
  "start",
  "duration",
  "volume_db",
  "position.pan",
  "position.distance",
  "position.movement",
]);

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

function getClipPathPrefix(
  project: AsmrProject,
  clipId: string,
): string | undefined {
  for (const [trackIndex, track] of project.timeline.tracks.entries()) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);

    if (clipIndex >= 0) {
      return `timeline.tracks.${trackIndex}.clips.${clipIndex}`;
    }
  }

  return undefined;
}

function getClipFieldValidationKey(
  relativePath: string,
): ClipFieldValidationKey | undefined {
  return clipFieldValidationKeys.has(relativePath as ClipFieldValidationKey)
    ? (relativePath as ClipFieldValidationKey)
    : undefined;
}

export function getClipFieldValidationIssues(
  project: AsmrProject,
  clipId: string,
  issues: ProjectValidationIssue[],
): ClipFieldValidationIssues {
  const clipPathPrefix = getClipPathPrefix(project, clipId);

  if (!clipPathPrefix) {
    return {};
  }

  return issues.reduce<ClipFieldValidationIssues>((fieldIssues, issue) => {
    const clipPath = `${clipPathPrefix}.`;

    if (!issue.path.startsWith(clipPath)) {
      return fieldIssues;
    }

    const relativePath = issue.path.slice(clipPath.length);
    const fieldKey = getClipFieldValidationKey(relativePath);

    if (!fieldKey) {
      return fieldIssues;
    }

    fieldIssues[fieldKey] = [...(fieldIssues[fieldKey] ?? []), issue];
    return fieldIssues;
  }, {});
}
