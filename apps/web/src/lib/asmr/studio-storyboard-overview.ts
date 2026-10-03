import type { AsmrProject } from "./schema";
import { getUsableClipH3Prompts } from "./video-plan";

export type StudioStoryboardState = "ready" | "pending" | "needs_update";
export type StudioStoryboardProgress = {
  total: number;
  ready: number;
  pending: number;
  needsUpdate: number;
  byClip: Record<string, StudioStoryboardState>;
};

/** A saved shot is ready exactly when its current single-clip H3 prompt can be used. */
export function getStudioStoryboardProgress(project: AsmrProject): StudioStoryboardProgress {
  const prompts = getUsableClipH3Prompts(project);
  const progress: StudioStoryboardProgress = { total: 0, ready: 0, pending: 0, needsUpdate: 0, byClip: Object.create(null) };
  for (const track of project.timeline.tracks) {
    if (track.track_type !== "voice") continue;
    for (const clip of track.clips) {
      if (!clip.text.trim()) {
        progress.byClip[clip.id] = "pending";
        continue;
      }
      progress.total += 1;
      if (prompts.has(clip.id)) {
        progress.ready += 1;
        progress.byClip[clip.id] = "ready";
      } else if (Object.hasOwn(project.videoPlan?.shots ?? {}, clip.id)) {
        progress.needsUpdate += 1;
        progress.byClip[clip.id] = "needs_update";
      } else {
        progress.pending += 1;
        progress.byClip[clip.id] = "pending";
      }
    }
  }
  return progress;
}
