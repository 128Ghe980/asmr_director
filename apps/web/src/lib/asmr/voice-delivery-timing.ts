import type { AsmrProject, TimelineClip } from "./schema";

type VoiceClip = Extract<TimelineClip, { type: "voice" }>;
export const DEFAULT_SEGMENT_PAUSE_SECONDS = 0.35;

export function getOrderedVoiceClips(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap((track) => track.track_type === "voice" ? track.clips : [])
    .sort((left, right) => left.start - right.start);
}

/** Delivery silence does not change the recording or invalidate TTS / D processing. */
export function getSegmentPauseSeconds(project: AsmrProject, clipId: string): number {
  const ordered = getOrderedVoiceClips(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  if (index < 0 || index === ordered.length - 1) return 0;
  const clip = ordered[index];
  if (clip.tail_pause_seconds !== undefined) return clip.tail_pause_seconds;
  if (clip.pause_after !== undefined && clip.pause_after > 0) return clip.pause_after;
  if (clip.pause_after === undefined) {
    const assetDuration = clip.kind !== "silent" && (clip.asset.asset_id || clip.asset.uri)
      ? clip.asset.duration : null;
    const duration = assetDuration !== null && Number.isFinite(assetDuration) && assetDuration > 0
      ? assetDuration : clip.duration;
    const gap = Math.max(0, ordered[index + 1].start - clip.start - duration);
    if (gap > 1e-6) return gap;
  }
  return clip.kind === "silent" ? 0 : DEFAULT_SEGMENT_PAUSE_SECONDS;
}
