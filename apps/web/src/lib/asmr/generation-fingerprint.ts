import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";
import { SPATIAL_RENDER_VERSION } from "./spatial-settings";

type ClipGenerationFingerprintInput = {
  id: string;
  track: TimelineClip["track"];
  type: TimelineClip["type"];
  start: number | undefined;
  duration: number;
  volume_db: number;
  fade_in: number;
  fade_out: number;
  position: TimelineClip["position"];
  typed: Record<string, boolean | string>;
};

type ProjectMixExportType = "wav";

type ProjectMixFingerprintInput = {
  spatial_renderer?: string;
  project_id: string;
  duration: number;
  exportType: ProjectMixExportType;
  mixing: AsmrProject["timeline"]["mixing"];
  clips: Array<{
    id: string;
    track: TimelineClip["track"];
    type: TimelineClip["type"];
    start: number;
    duration: number;
    volume_db: number;
    fade_in: number;
    fade_out: number;
    position: TimelineClip["position"];
    asset: {
      uri: string | null;
      duration: number | null;
    };
  }>;
};

const projectMixClipTracks = new Set<TimelineClip["track"]>([
  "voice",
  "breath",
  "sfx",
  "ambience",
]);

function getTypedFingerprintInput(
  clip: TimelineClip,
): ClipGenerationFingerprintInput["typed"] {
  switch (clip.type) {
    case "voice":
      return {
        emotion: clip.emotion,
        pace: clip.pace,
        style: clip.style,
        text: clip.text,
      };
    case "breath":
      return { breath: clip.breath };
    case "sfx":
      return { sfx: clip.sfx };
    case "ambience":
      return {
        ambience: clip.ambience,
        loop: clip.loop,
      };
  }
}

type ClipGenerationFingerprintOptions = {
  ignoreVoiceStart?: boolean;
};

export function getClipGenerationFingerprint(
  clip: TimelineClip,
  options: ClipGenerationFingerprintOptions = {},
): string {
  const input: ClipGenerationFingerprintInput = {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    // Planner fitting can move a concurrently generating voice without changing
    // its audio. User timing edits still cancel the job in the workspace.
    start: options.ignoreVoiceStart && clip.type === "voice" ? undefined : clip.start,
    duration: clip.duration,
    volume_db: clip.volume_db,
    fade_in: clip.fade_in,
    fade_out: clip.fade_out,
    position: clip.position,
    typed: getTypedFingerprintInput(clip),
  };

  return JSON.stringify(input);
}

export function isCurrentClipGenerationFingerprint(
  project: AsmrProject,
  clipId: string,
  fingerprint: string,
  options: ClipGenerationFingerprintOptions = {},
): boolean {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  return clip ? getClipGenerationFingerprint(clip, options) === fingerprint : false;
}

function getProjectMixClipFingerprintInput(
  clip: TimelineClip,
): ProjectMixFingerprintInput["clips"][number] {
  return {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    start: clip.start,
    duration: clip.duration,
    volume_db: clip.volume_db,
    fade_in: clip.fade_in,
    fade_out: clip.fade_out,
    position: {
      pan: clip.position.pan,
      distance: clip.position.distance,
      movement: clip.position.movement,
    },
    asset: {
      uri: clip.asset.uri,
      duration: clip.asset.duration,
    },
  };
}

export function getProjectMixFingerprint(
  project: AsmrProject,
  exportType: ProjectMixExportType = "wav",
): string {
  const input: ProjectMixFingerprintInput = {
    ...(project.timeline.mixing.binaural ? { spatial_renderer: SPATIAL_RENDER_VERSION } : {}),
    project_id: project.project_id,
    duration: project.duration,
    exportType,
    mixing: {
      target_lufs: project.timeline.mixing.target_lufs,
      binaural: project.timeline.mixing.binaural,
      master_limiter: project.timeline.mixing.master_limiter,
    },
    clips: flattenClips(project)
      .filter((clip) => projectMixClipTracks.has(clip.track))
      .map(getProjectMixClipFingerprintInput),
  };

  return JSON.stringify(input);
}

export function isCurrentProjectMixFingerprint(
  project: AsmrProject,
  fingerprint: string,
  exportType: ProjectMixExportType = "wav",
): boolean {
  return getProjectMixFingerprint(project, exportType) === fingerprint;
}
