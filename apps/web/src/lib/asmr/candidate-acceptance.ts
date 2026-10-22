import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { commitGenerationSuccess } from "./generation-project-state";
import { createProjectRevision, getCurrentLibraryEntry, updateLibraryProject, type AudioCandidateAcceptance, type ProjectLibrary, type ProjectLibraryEntry } from "./project-library";
import { serializeProject } from "./project-persistence";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { captureSpeechWorkspace, getParagraphGroup, getSpeechWorkspaceMode, getSpeechWorkspaceProject, restoreSpeechWorkspaceBank } from "./speech-workspace";

function undoFingerprint(entry: Pick<ProjectLibraryEntry, "project" | "plannerSource">): string {
  if (entry.project.speechWorkspace) {
    const current = captureSpeechWorkspace(entry.project);
    const bank = { ...current.speechWorkspace![getSpeechWorkspaceMode(current)], exports: [] };
    delete bank.videoPlan;
    delete bank.mixFingerprint;
    return JSON.stringify({ projectId: current.project_id, title: current.title, language: current.language, scene: current.scene,
      character: current.character, status: current.status, bank, plannerSource: entry.plannerSource });
  }
  // Video notes and rendered exports do not edit the audio arrangement.
  const project = { ...entry.project, exports: [] };
  delete project.videoPlan;
  return JSON.stringify({ project: JSON.parse(serializeProject(project)), plannerSource: entry.plannerSource });
}

export function getLastAudioCandidateAcceptance(entry: ProjectLibraryEntry): AudioCandidateAcceptance | undefined {
  const mode = getSpeechWorkspaceMode(entry.project);
  return entry.candidateAcceptances?.[mode] ?? (entry.candidateAcceptance
    && (entry.candidateAcceptance.workspaceMode ?? "short") === mode ? entry.candidateAcceptance : undefined);
}

export function adoptAudioCandidate(library: ProjectLibrary, inputCandidate: AudioCandidate, now = new Date()): ProjectLibrary {
  const candidate = AudioCandidateSchema.parse(inputCandidate);
  const entry = getCurrentLibraryEntry(library);
  if (entry.projectId !== candidate.projectId) throw new Error("请回到候选所属的当前工程后采用。");
  if (candidate.status !== "ready") throw new Error("已放弃的候选不能采用。");
  const target = entry.project.timeline.tracks.flatMap((track) => track.clips as TimelineClip[]).find((clip) => clip.id === candidate.clipId);
  if (!target || target.type !== "voice" || target.kind === "silent") throw new Error("候选对应的人声片段已不存在。");
  const mode = getSpeechWorkspaceMode(entry.project);
  const candidateMode = candidate.provenance.generationMode === "paragraph" ? "paragraph" : "short";
  if (mode !== candidateMode) throw new Error("请回到候选所属的语音工作区后采用。");
  const context = candidate.provenance.generationMode === "long_text" ? getVoiceGenerationContext(entry.project, target.id) : undefined;
  const paragraphContext = candidateMode === "paragraph" ? getVoiceParagraphContext(entry.project, target.id) : undefined;
  if (getVoiceCandidateSourceFingerprint(target, context, paragraphContext) !== candidate.sourceFingerprint) throw new Error("片段内容或后续文案已修改，请重新生成候选。");
  const adoptedIds = new Set([candidate.clipId]);
  let timedProject: AsmrProject;
  const paragraph = candidate.provenance.paragraph;
  if (candidateMode === "paragraph") {
    if (!paragraph || paragraph.checkStatus === "review") throw new Error("请先确认安全切分位置，再采用整段短句。");
    const members = getParagraphGroup(entry.project, target.id);
    if (!paragraphContext || paragraph.groupId !== paragraphContext.groupId || paragraph.text !== paragraphContext.text
      || paragraph.clipIds.length !== members.length || paragraph.segments.length !== members.length
      || members.some((clip, index) => paragraph.clipIds[index] !== clip.id || paragraph.segments[index].clipId !== clip.id || paragraph.segments[index].text !== clip.text)) {
      throw new Error("整段成员或文案已修改，请重新生成整段候选。");
    }
    const requested = paragraph.segments.find((segment) => segment.clipId === target.id)!;
    if (JSON.stringify(requested.asset) !== JSON.stringify(candidate.asset)) throw new Error("整段候选与对应短句音频不一致。");
    if (members.every((clip, index) => clip.asset.asset_id === paragraph.segments[index].asset.assetId
      && clip.asset.uri === paragraph.segments[index].asset.uri && clip.asset.duration === paragraph.segments[index].asset.duration && !clip.audio_stale)) return library;
    timedProject = entry.project;
    for (const segment of paragraph.segments) {
      adoptedIds.add(segment.clipId);
      timedProject = commitGenerationSuccess(timedProject, segment.clipId, segment.asset, { fitVoiceTiming: true });
    }
  } else {
    if (target.asset.asset_id === candidate.asset.assetId && !target.audio_stale) return library;
    timedProject = commitGenerationSuccess(entry.project, candidate.clipId, candidate.asset, { fitVoiceTiming: true });
  }

  let project: AsmrProject = {
    ...timedProject,
    timeline: { ...timedProject.timeline, tracks: timedProject.timeline.tracks.map((track) => ({
      ...track,
      clips: (track.clips as TimelineClip[]).map((clip) => adoptedIds.has(clip.id) ? {
        ...clip, generation: { ...clip.generation, model: candidate.provenance.model, seed: candidate.provenance.seed, temperature: candidate.provenance.temperature },
      } : clip),
    } as TimelineTrack)) },
  };
  if (project.speechWorkspace) project = captureSpeechWorkspace(project, { mixFingerprint: undefined });
  const protectedLibrary = createProjectRevision(library, entry.projectId, now, "采用音频候选前");
  const updated = updateLibraryProject(protectedLibrary, project, now);
  const updatedEntry = getCurrentLibraryEntry(updated);
  const record: AudioCandidateAcceptance = {
    version: 1, candidateId: candidate.candidateId, clipId: candidate.clipId, adoptedAt: now.toISOString(),
    beforeProject: structuredClone(entry.project),
    beforePlannerSource: entry.plannerSource ? structuredClone(entry.plannerSource) : undefined,
    afterFingerprint: undoFingerprint(updatedEntry), ...(project.speechWorkspace ? { workspaceMode: mode } : {}),
  };
  const priorRecords = entry.candidateAcceptances ?? (entry.candidateAcceptance
    ? { [entry.candidateAcceptance.workspaceMode ?? "short"]: entry.candidateAcceptance } : {});
  return {
    ...updated,
    projects: updated.projects.map((item) => item.projectId === entry.projectId ? {
      ...item,
      mixFingerprint: undefined,
      candidateAcceptance: record,
      ...(project.speechWorkspace ? { candidateAcceptances: { ...priorRecords, [mode]: record } } : {}),
    } : item),
  };
}

export function canUndoLastAudioCandidate(library: ProjectLibrary, projectId = library.currentProjectId): boolean {
  const entry = library.projects.find((item) => item.projectId === projectId);
  const recovery = entry ? getLastAudioCandidateAcceptance(entry) : undefined;
  if (!entry || !recovery) return false;
  if (recovery.afterFingerprint === undoFingerprint(entry)) return true;
  if (entry.project.speechWorkspace && getSpeechWorkspaceMode(entry.project) === "short"
    && recovery.workspaceMode === undefined && !recovery.beforeProject.speechWorkspace) {
    const legacyProjection = { ...getSpeechWorkspaceProject(entry.project, "short") };
    delete legacyProjection.speechWorkspace;
    return recovery.afterFingerprint === undoFingerprint({ ...entry, project: legacyProjection });
  }
  return false;
}

export function undoLastAudioCandidate(library: ProjectLibrary, projectId = library.currentProjectId, now = new Date()): ProjectLibrary {
  const entry = library.projects.find((item) => item.projectId === projectId);
  const recovery = entry ? getLastAudioCandidateAcceptance(entry) : undefined;
  if (!entry || !recovery) throw new Error("没有可撤回的音频采用记录。");
  if (!canUndoLastAudioCandidate(library, projectId)) throw new Error("工程已编辑，请从版本记录恢复采用前的版本。");
  const protectedLibrary = createProjectRevision(library, projectId, now, "撤回音频采用前");
  let project: AsmrProject = {
    ...recovery.beforeProject,
    videoPlan: entry.project.videoPlan ? structuredClone(entry.project.videoPlan) : undefined,
  };
  if (project.videoPlan === undefined) delete project.videoPlan;
  const mode = getSpeechWorkspaceMode(entry.project);
  if (entry.project.speechWorkspace) {
    const current = captureSpeechWorkspace(entry.project);
    const before = getSpeechWorkspaceProject(recovery.beforeProject, mode).speechWorkspace![mode];
    const bank = { ...structuredClone(before), videoPlan: current.speechWorkspace![mode].videoPlan };
    delete bank.mixFingerprint;
    project = restoreSpeechWorkspaceBank(current, mode, bank);
  }
  const restored = updateLibraryProject(protectedLibrary, project, now);
  const records = { ...entry.candidateAcceptances };
  delete records[mode];
  return {
    ...restored,
    projects: restored.projects.map((item) => item.projectId === projectId ? {
      ...item, mixFingerprint: undefined, candidateAcceptance: undefined,
      ...(entry.project.speechWorkspace ? { candidateAcceptances: records } : {}),
      plannerSource: recovery.beforePlannerSource ? structuredClone(recovery.beforePlannerSource) : undefined,
    } : item),
  };
}
