import { AudioCandidateSchema, getAudioCandidateWorkspaceMode, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import type { AsmrProject, VoiceClip } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { getSpeechWorkspaceMode } from "./speech-workspace";
import { isVoiceParagraphManuallyConfirmed } from "./voice-paragraph-result";

export type StudioAudioOverview = {
  adopted: number;
  pending: number;
  unadopted: number;
  total: number;
  needsUpdate?: number;
};

export type StudioAudioState = "adopted" | "pending" | "unadopted" | "needs_update";

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
  const workspaceMode = getSpeechWorkspaceMode(project);
  for (const input of candidates) {
    const parsed = AudioCandidateSchema.safeParse(input);
    if (!parsed.success || parsed.data.projectId !== project.project_id || parsed.data.status !== "ready") continue;
    const candidate = parsed.data;
    if (getAudioCandidateWorkspaceMode(candidate) !== workspaceMode) continue;
    const takes = readyByClip.get(candidate.clipId) ?? [];
    takes.push(candidate);
    readyByClip.set(candidate.clipId, takes);
  }

  const overview: StudioAudioOverview = { adopted: 0, pending: 0, unadopted: 0, total: 0 };
  const byClip: Record<string, StudioAudioState> = Object.create(null);
  for (const track of project.timeline.tracks) {
    if (track.track_type !== "voice") continue;
    for (const clip of track.clips) {
      if (clip.kind === "silent" || !clip.text.trim()) continue;
      overview.total += 1;
      if (hasAdoptedAudio(clip) && !clip.audio_stale) {
        overview.adopted += 1;
        byClip[clip.id] = "adopted";
        continue;
      }

      const directSource = getVoiceCandidateSourceFingerprint(clip);
      let windowSource: string | undefined;
      let paragraphSource: string | undefined;
      const hasCurrentTake = readyByClip.get(clip.id)?.some((candidate) => {
        if (candidate.provenance.generationMode === "clip") return candidate.sourceFingerprint === directSource;
        if (candidate.provenance.generationMode === "paragraph") {
          const paragraph = candidate.provenance.paragraph;
          if (!paragraph || (paragraph.checkStatus !== "passed" && !isVoiceParagraphManuallyConfirmed(paragraph))) return false;
          paragraphSource ??= getVoiceCandidateSourceFingerprint(clip, undefined, getVoiceParagraphContext(project, clip.id));
          return candidate.sourceFingerprint === paragraphSource;
        }
        windowSource ??= getVoiceCandidateSourceFingerprint(clip, getVoiceGenerationContext(project, clip.id));
        return candidate.sourceFingerprint === windowSource;
      });
      const state: StudioAudioState = hasCurrentTake ? "unadopted" : clip.audio_stale && hasAdoptedAudio(clip) ? "needs_update" : "pending";
      if (state === "needs_update") overview.needsUpdate = (overview.needsUpdate ?? 0) + 1;
      else overview[state] += 1;
      byClip[clip.id] = state;
    }
  }
  return { overview, byClip };
}

export function getStudioAudioOverview(project: AsmrProject, candidates: readonly AudioCandidate[]): StudioAudioOverview {
  return getStudioAudioProgress(project, candidates).overview;
}
