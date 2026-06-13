import type { AsmrProject, TimelineClip } from "./schema";
import { getAllClips } from "./validate";

export function formatSeconds(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (wholeSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export function formatTimeRange(start: number, duration: number): string {
  return `${formatSeconds(start)}-${formatSeconds(start + duration)}`;
}

export function getPositionLabel(position: TimelineClip["position"]): string {
  const ear =
    position.pan < -0.35
      ? "左耳"
      : position.pan > 0.35
        ? "右耳"
        : "中间";

  return `${ear} · ${position.distance}`;
}

export function flattenClips(project: AsmrProject): TimelineClip[] {
  return [...getAllClips(project)].sort((a, b) => a.start - b.start);
}

export function getTrackSummary(project: AsmrProject): Record<string, number> {
  return Object.fromEntries(
    project.timeline.tracks.map((track) => [
      track.track_type,
      track.clips.length,
    ]),
  );
}
