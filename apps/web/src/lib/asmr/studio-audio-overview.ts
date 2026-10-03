import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import type { AsmrProject, VoiceClip } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";

export type StudioAudioOverview = {
  adopted: number;
  pending: number;
  unadopted: number;
  total: number;
};

export type StudioAudioState = "adopted" | "pending" | "unadopted";

function hasAdoptedAudio(clip: VoiceClip): boolean {
  // Match audio batch eligibility, including existing non-Vox timeline assets.
  return clip.generation.status === "asset_generated"
    && Boolean(clip.asset.asset_id?.trim()) && Boolean(clip.asset.uri?.trim());
}

/** Counts paragraphs once, using candidate adoption eligibility rather than the selected voice recipe. */
export function getStudioAudioProgress(project: AsmrProject, candidates: readonly AudioCandidate[]): {
  overview: StudioAudioOverview;
  byClip: Record<string, StudioAudioState>;
} {
  const readyByClip = new Map<string, AudioCandidate[]>();
  for (const input of candidates) {
    const parsed = AudioCandidateSchema.safeParse(input);
    if (!parsed.success || parsed.data.projectId !== project.project_id || parsed.data.status !== "ready") continue;
    const candidate = parsed.data;
    const takes = readyByClip.get(candidate.clipId) ?? [];
    takes.push(candidate);
    readyByClip.set(candidate.clipId, takes);
  }

  const overview: StudioAudioOverview = { adopted: 0, pending: 0, unadopted: 0, total: 0 };
  const byClip: Record<string, StudioAudioState> = Object.create(null);
  for (const track of project.timeline.tracks) {
    if (track.track_type !== "voice") continue;
    for (const clip of track.clips) {
      if (!clip.text.trim()) continue;
      overview.total += 1;
      if (hasAdoptedAudio(clip)) {
        overview.adopted += 1;
        byClip[clip.id] = "adopted";
        continue;
      }

      const directSource = getVoiceCandidateSourceFingerprint(clip);
      let windowSource: string | undefined;
      const hasCurrentTake = readyByClip.get(clip.id)?.some((candidate) => {
        if (candidate.provenance.generationMode === "clip") return candidate.sourceFingerprint === directSource;
        windowSource ??= getVoiceCandidateSourceFingerprint(clip, getVoiceGenerationContext(project, clip.id));
        return candidate.sourceFingerprint === windowSource;
      });
      const state: StudioAudioState = hasCurrentTake ? "unadopted" : "pending";
      overview[state] += 1;
      byClip[clip.id] = state;
    }
  }
  return { overview, byClip };
}

export function getStudioAudioOverview(project: AsmrProject, candidates: readonly AudioCandidate[]): StudioAudioOverview {
  return getStudioAudioProgress(project, candidates).overview;
}
