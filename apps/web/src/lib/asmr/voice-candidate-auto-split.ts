import { getAudioCandidateWorkspaceMode, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import type { AsmrProject } from "./schema";
import { getSpeechWorkspaceMode } from "./speech-workspace";
import { flattenClips } from "./view-model";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceParagraphContext } from "./voice-paragraph-context";

export function canForceSplitVoiceCandidate(candidate: AudioCandidate) {
  if (candidate.status !== "ready" || candidate.provenance.forcedSegmentation) return false;
  return candidate.provenance.generationMode === "paragraph"
    ? candidate.provenance.paragraph?.checkStatus === "review"
    : candidate.provenance.generationMode === "long_text"
      && Boolean(candidate.provenance.longText?.groups.some((group) => group.checkStatus === "review"));
}

export function forceSplitAttemptKey(candidate: AudioCandidate) {
  return JSON.stringify([candidate.projectId, candidate.candidateId]);
}

export function getNextAutomaticForceSplitCandidate(
  project: AsmrProject,
  candidates: AudioCandidate[],
  attempted: ReadonlySet<string>,
) {
  const mode = getSpeechWorkspaceMode(project);
  const currentCandidates = candidates.filter((candidate) => candidate.projectId === project.project_id
    && getAudioCandidateWorkspaceMode(candidate) === mode);
  const completedSources = new Set(currentCandidates.map((candidate) => candidate.provenance.forcedSegmentation?.sourceCandidateId));
  for (const clip of flattenClips(project)) {
    if (clip.type !== "voice" || clip.kind === "silent") continue;
    const candidate = currentCandidates.find((item) => item.clipId === clip.id && canForceSplitVoiceCandidate(item)
      && !attempted.has(forceSplitAttemptKey(item)) && !completedSources.has(item.candidateId)
      && item.sourceFingerprint === getVoiceCandidateSourceFingerprint(clip,
        item.provenance.generationMode === "paragraph" ? undefined : getVoiceGenerationContext(project, clip.id),
        item.provenance.generationMode === "paragraph" ? getVoiceParagraphContext(project, clip.id) : undefined));
    if (candidate) return candidate;
  }
}
