import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

type ClipGenerationFingerprintInput = {
  id: string;
  track: TimelineClip["track"];
  type: TimelineClip["type"];
  start: number;
  duration: number;
  volume_db: number;
  fade_in: number;
  fade_out: number;
  position: TimelineClip["position"];
  typed: Record<string, boolean | string>;
};

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

export function getClipGenerationFingerprint(clip: TimelineClip): string {
  const input: ClipGenerationFingerprintInput = {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    start: clip.start,
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
): boolean {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  return clip ? getClipGenerationFingerprint(clip) === fingerprint : false;
}
