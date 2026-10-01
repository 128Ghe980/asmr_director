import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { commitGenerationSuccess } from "./generation-project-state";
import { createProjectRevision, getCurrentLibraryEntry, updateLibraryProject, type ProjectLibrary, type ProjectLibraryEntry } from "./project-library";
import { serializeProject } from "./project-persistence";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";

function undoFingerprint(entry: Pick<ProjectLibraryEntry, "project" | "plannerSource">): string {
  // Rendering an export does not edit the arrangement and should not remove undo.
  return JSON.stringify({ project: JSON.parse(serializeProject({ ...entry.project, exports: [] })), plannerSource: entry.plannerSource });
}

export function adoptAudioCandidate(library: ProjectLibrary, inputCandidate: AudioCandidate, now = new Date()): ProjectLibrary {
  const candidate = AudioCandidateSchema.parse(inputCandidate);
  const entry = getCurrentLibraryEntry(library);
  if (entry.projectId !== candidate.projectId) throw new Error("请回到候选所属的当前工程后采用。");
  if (candidate.status !== "ready") throw new Error("已放弃的候选不能采用。");
  const target = entry.project.timeline.tracks.flatMap((track) => track.clips as TimelineClip[]).find((clip) => clip.id === candidate.clipId);
  if (!target || target.type !== "voice") throw new Error("候选对应的人声片段已不存在。");
  const context = candidate.provenance.generationMode === "long_text" ? getVoiceGenerationContext(entry.project, target.id) : undefined;
  if (getVoiceCandidateSourceFingerprint(target, context) !== candidate.sourceFingerprint) throw new Error("片段内容或后续文案已修改，请重新生成候选。");
  if (target.asset.asset_id === candidate.asset.assetId) return library;

  const timedProject = commitGenerationSuccess(entry.project, candidate.clipId, candidate.asset, { fitVoiceTiming: true });
  const project: AsmrProject = {
    ...timedProject,
    timeline: { ...timedProject.timeline, tracks: timedProject.timeline.tracks.map((track) => ({
      ...track,
      clips: (track.clips as TimelineClip[]).map((clip) => clip.id === candidate.clipId ? {
        ...clip, generation: { ...clip.generation, model: candidate.provenance.model, seed: candidate.provenance.seed, temperature: candidate.provenance.temperature },
      } : clip),
    } as TimelineTrack)) },
  };
  const protectedLibrary = createProjectRevision(library, entry.projectId, now, "采用音频候选前");
  const updated = updateLibraryProject(protectedLibrary, project, now);
  const updatedEntry = getCurrentLibraryEntry(updated);
  return {
    ...updated,
    projects: updated.projects.map((item) => item.projectId === entry.projectId ? {
      ...item,
      mixFingerprint: undefined,
      candidateAcceptance: {
        version: 1,
        candidateId: candidate.candidateId,
        clipId: candidate.clipId,
        adoptedAt: now.toISOString(),
        beforeProject: structuredClone(entry.project),
        beforePlannerSource: entry.plannerSource ? structuredClone(entry.plannerSource) : undefined,
        afterFingerprint: undoFingerprint(updatedEntry),
      },
    } : item),
  };
}

export function canUndoLastAudioCandidate(library: ProjectLibrary, projectId = library.currentProjectId): boolean {
  const entry = library.projects.find((item) => item.projectId === projectId);
  return Boolean(entry?.candidateAcceptance && entry.candidateAcceptance.afterFingerprint === undoFingerprint(entry));
}

export function undoLastAudioCandidate(library: ProjectLibrary, projectId = library.currentProjectId, now = new Date()): ProjectLibrary {
  const entry = library.projects.find((item) => item.projectId === projectId);
  if (!entry?.candidateAcceptance) throw new Error("没有可撤回的音频采用记录。");
  if (!canUndoLastAudioCandidate(library, projectId)) throw new Error("工程已编辑，请从版本记录恢复采用前的版本。");
  const recovery = entry.candidateAcceptance;
  const protectedLibrary = createProjectRevision(library, projectId, now, "撤回音频采用前");
  const restored = updateLibraryProject(protectedLibrary, recovery.beforeProject, now);
  return {
    ...restored,
    projects: restored.projects.map((item) => item.projectId === projectId ? {
      ...item, mixFingerprint: undefined, candidateAcceptance: undefined,
      plannerSource: recovery.beforePlannerSource ? structuredClone(recovery.beforePlannerSource) : undefined,
    } : item),
  };
}
