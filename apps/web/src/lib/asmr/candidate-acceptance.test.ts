import { describe, expect, it } from "vitest";
import { type AudioCandidate, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { adoptAudioCandidate, canUndoLastAudioCandidate, undoLastAudioCandidate } from "./candidate-acceptance";
import { demoProject } from "./mock-project";
import { PlannerBriefSchema, type PlannerDraft } from "./planner";
import { adoptPlannerDraft, createInitialProjectLibrary, createLibraryProject, getCurrentLibraryEntry, loadProjectLibrary, replaceLibraryProject, saveProjectLibrary, setLibraryProjectMixFingerprint, updateLibraryProject } from "./project-library";
import { serializeProject } from "./project-persistence";
import type { AsmrProject, TimelineClip } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { makeSemanticVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { createClipVideoSourceFingerprint, isClipVideoStoryboardCurrent, type ClipVideoStoryboard, type ProjectVideoPlan } from "./video-plan";

const now = new Date("2026-09-08T00:00:00.000Z");
function voice(project: AsmrProject) {
  return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
}
function candidate(project: AsmrProject = demoProject, duration = 12, id = "candidate_1"): AudioCandidate {
  return {
    version: 1, candidateId: id, projectId: project.project_id, clipId: voice(project).id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(voice(project)), requestFingerprint: "request",
    asset: { assetId: id, uri: `asset://clip/${id}`, duration }, wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
    provenance: { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip", model: "VoxCPM2", seed: 42, temperature: 1, parameters: { cfg: 2 } },
    qualityWarnings: [], createdAt: now.toISOString(), status: "ready",
  };
}
function storage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}
function editVoice(project: AsmrProject, text: string): AsmrProject {
  return { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: track.clips.map((clip, index) => index === 0 ? { ...clip, text } : clip) } : track) } };
}
function videoPlan(sceneDescription = "暖光中的书店"): ProjectVideoPlan {
  return { version: 1, sceneDescription, shots: {} };
}

describe("adopting voice candidates", () => {
  it("rejects a semantic candidate after a later window paragraph changes, while direct takes remain usable", () => {
    const project = structuredClone(demoProject);
    voice(project).semantic_unit = true;
    const context = getVoiceGenerationContext(project, voice(project).id)!;
    const windowTake = candidate(project);
    windowTake.sourceFingerprint = getVoiceCandidateSourceFingerprint(voice(project), context);
    windowTake.provenance = { ...windowTake.provenance, generationMode: "long_text",
      longText: makeSemanticVoiceLongTextResultFixture(voice(project).text, context) };
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(project), windowTake)).not.toThrow();
    const directTake = candidate(project);
    project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[1].text = "后文现在变了。";
    const library = createInitialProjectLibrary(project);
    expect(() => adoptAudioCandidate(library, windowTake)).toThrow(/后续文案/);
    expect(library.projects[0].revisions).toHaveLength(0);
    expect(() => adoptAudioCandidate(library, directTake)).not.toThrow();
  });

  it("atomically protects the old project, fits non-Planner timing and invalidates the mix", () => {
    const library = setLibraryProjectMixFingerprint(createInitialProjectLibrary(demoProject, now), demoProject.project_id, "old_mix");
    const before = structuredClone(library);
    const adopted = adoptAudioCandidate(library, candidate(), now);
    const entry = getCurrentLibraryEntry(adopted);
    expect(library).toEqual(before);
    expect(entry.revisions.at(-1)?.project).toEqual(demoProject);
    expect(entry.mixFingerprint).toBeUndefined();
    expect(voice(entry.project)).toMatchObject({ duration: 12, asset: { asset_id: "candidate_1", duration: 12 }, generation: { model: "VoxCPM2", seed: 42, temperature: 1, status: "asset_generated" } });
    expect(entry.project.duration).toBe(demoProject.duration + 4.5);
    expect(entry.project.emotion_curve[0].end).toBe(demoProject.emotion_curve[0].end + 4.5);
    const next = entry.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[1];
    expect(next.start).toBe(62.5);
    expect(serializeProject(entry.project)).not.toContain("candidateAcceptance");
    expect(serializeProject(entry.project)).not.toContain("requestFingerprint");
  });

  it("retains planned silence for short takes and allows swapping a different reference candidate", () => {
    const first = candidate(demoProject, 3);
    const second = candidate(demoProject, 4, "candidate_2");
    second.provenance.voicePackId = "normal_zh";
    const adopted = adoptAudioCandidate(adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), first, now), second, now);
    expect(voice(getCurrentLibraryEntry(adopted).project)).toMatchObject({ duration: 7.5, asset: { asset_id: "candidate_2" } });
    expect(voice(getCurrentLibraryEntry(undoLastAudioCandidate(adopted)).project).asset.asset_id).toBe("candidate_1");
  });

  it("rejects stale text, project switches, discarded candidates and missing clips without any revision changes", () => {
    const initial = createInitialProjectLibrary(demoProject, now);
    const changed = updateLibraryProject(initial, editVoice(demoProject, "修改后的台词。"), now);
    expect(() => adoptAudioCandidate(changed, candidate(), now)).toThrow(/内容/);
    const switched = createLibraryProject(initial, demoProject, new Date("2026-09-08T01:00:00Z"));
    expect(() => adoptAudioCandidate(switched, candidate(), now)).toThrow(/当前/);
    expect(() => adoptAudioCandidate(initial, { ...candidate(), status: "discarded" }, now)).toThrow(/放弃/);
    expect(() => adoptAudioCandidate(initial, { ...candidate(), clipId: "missing" }, now)).toThrow(/片段/);
    expect(initial.projects[0].revisions).toHaveLength(0);
  });

  it("persists undo across autosave/reload and restores all timing without erasing Planner source", () => {
    const draft: PlannerDraft = { title: "深夜书店", scene: "书店", character: { role: "店员", personality: ["温柔"], speechStyle: ["轻声"] }, sections: [0, 1].map((index) => ({ id: `s_${index}`, title: "欢迎", text: "坐一会儿吧。", emotion: "温暖", style: "柔和", pace: "缓慢", direction: "翻书", soundSuggestions: "", pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" } })) };
    const planned = adoptPlannerDraft(createInitialProjectLibrary(demoProject, now), PlannerBriefSchema.parse({ theme: "书店" }), draft, now);
    const original = getCurrentLibraryEntry(planned);
    let adopted = adoptAudioCandidate(planned, candidate(original.project, 40), now);
    adopted = updateLibraryProject(adopted, getCurrentLibraryEntry(adopted).project, now);
    const persistence = storage();
    saveProjectLibrary(persistence, adopted);
    const reloaded = loadProjectLibrary(persistence, demoProject, now);
    expect(canUndoLastAudioCandidate(reloaded)).toBe(true);
    const undone = getCurrentLibraryEntry(undoLastAudioCandidate(reloaded));
    expect(undone.project).toEqual(original.project);
    expect(undone.plannerSource).toEqual(original.plannerSource);
    expect(undone.mixFingerprint).toBeUndefined();
    expect(canUndoLastAudioCandidate(undoLastAudioCandidate(reloaded))).toBe(false);
  });

  it("blocks quick undo after edits or project replacement and keeps the safety version available", () => {
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), candidate(), now);
    const edited = updateLibraryProject(adopted, { ...getCurrentLibraryEntry(adopted).project, title: "用户编辑" }, now);
    expect(canUndoLastAudioCandidate(edited)).toBe(false);
    expect(() => undoLastAudioCandidate(edited)).toThrow(/版本/);
    expect(getCurrentLibraryEntry(edited).revisions[0].project).toEqual(demoProject);
    const replaced = replaceLibraryProject(adopted, getCurrentLibraryEntry(adopted).project, now);
    expect(canUndoLastAudioCandidate(replaced)).toBe(false);
  });

  it("allows undo after remix while clearing the no-longer-current mix", () => {
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), candidate(), now);
    const project = getCurrentLibraryEntry(adopted).project;
    const mixed = updateLibraryProject(adopted, { ...project, exports: project.exports.map((entry) => entry.type === "wav" ? { ...entry, status: "exported", uri: "asset://mix/latest" } : entry) }, now);
    expect(canUndoLastAudioCandidate(mixed)).toBe(true);
    const undone = undoLastAudioCandidate(mixed);
    expect(getCurrentLibraryEntry(undone).project).toEqual(demoProject);
    expect(getCurrentLibraryEntry(undone).mixFingerprint).toBeUndefined();
  });

  it.each(["add", "edit", "remove"] as const)("allows undo after a video-only %s and keeps the latest video metadata", (change) => {
    const originalProject: AsmrProject = {
      ...demoProject,
      ...(change === "add" ? {} : { videoPlan: videoPlan("采用音频前的旧场景") }),
    };
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(originalProject, now), candidate(originalProject), now);
    const entry = getCurrentLibraryEntry(adopted);
    const currentVideoPlan = change === "remove" ? undefined : videoPlan("用户后来修改的场景");
    const edited = updateLibraryProject(adopted, { ...entry.project, videoPlan: currentVideoPlan }, now);

    expect(canUndoLastAudioCandidate(edited)).toBe(true);
    const undone = getCurrentLibraryEntry(undoLastAudioCandidate(edited));
    const expected = structuredClone(originalProject);
    if (currentVideoPlan) expected.videoPlan = currentVideoPlan;
    else delete expected.videoPlan;
    expect(undone.project).toEqual(expected);
    expect(undone.project.videoPlan).toEqual(currentVideoPlan);
    expect(undone.candidateAcceptance).toBeUndefined();
    expect(undone.revisions.at(-1)?.project.videoPlan).toEqual(currentVideoPlan);
    expect(voice(undone.revisions.at(-1)!.project).asset.asset_id).toBe("candidate_1");
    expect(entry.candidateAcceptance?.beforeProject.videoPlan).toEqual(originalProject.videoPlan);
  });

  it("keeps a video shot bound to the adopted take visible and stale after audio undo", () => {
    const original = structuredClone(demoProject);
    voice(original).generation.status = "asset_generated";
    voice(original).asset = { asset_id: "prior_take", uri: "asset://clip/prior_take", duration: 7.5 };
    original.videoPlan = videoPlan();
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(original, now), candidate(original), now);
    const project = getCurrentLibraryEntry(adopted).project;
    const clip = voice(project);
    const shot: ClipVideoStoryboard = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: "candidate_1", uri: "asset://clip/candidate_1", duration: 12 },
      title: "书店近景", visual: "Warm light falls across the bookstore.",
      action: "The clerk slowly opens a book.", camera: "[Static shot] Medium close-up.",
    };
    const withShot = updateLibraryProject(adopted, { ...project, videoPlan: { ...project.videoPlan!, shots: { [clip.id]: shot } } }, now);
    expect(isClipVideoStoryboardCurrent(getCurrentLibraryEntry(withShot).project, clip.id)).toBe(true);
    expect(canUndoLastAudioCandidate(withShot)).toBe(true);

    const undone = getCurrentLibraryEntry(undoLastAudioCandidate(withShot));
    expect(voice(undone.project).asset.asset_id).toBe("prior_take");
    expect(undone.project.videoPlan?.shots[clip.id]).toEqual(shot);
    expect(undone.project.videoPlan?.shots[clip.id]).not.toBe(shot);
    expect(isClipVideoStoryboardCurrent(undone.project, clip.id)).toBe(false);
  });

  it.each([
    ["spoken text", (project: AsmrProject) => { voice(project).text = "已经修改的台词。"; }],
    ["voice gain", (project: AsmrProject) => { voice(project).volume_db += 1; }],
    ["the accepted audio asset", (project: AsmrProject) => { voice(project).asset.uri = "asset://clip/another_take"; }],
  ] as const)("still blocks undo when %s changes alongside video notes", (_, editAudio) => {
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), candidate(), now);
    const project = structuredClone(getCurrentLibraryEntry(adopted).project);
    project.videoPlan = videoPlan("后来修改的场景");
    editAudio(project);
    const edited = updateLibraryProject(adopted, project, now);

    expect(canUndoLastAudioCandidate(edited)).toBe(false);
    expect(() => undoLastAudioCandidate(edited)).toThrow(/版本/);
    expect(getCurrentLibraryEntry(edited).project).toEqual(project);
    expect(getCurrentLibraryEntry(edited).revisions[0].project).toEqual(demoProject);
  });

  it("loads a legacy fingerprint without video metadata and permits undo after adding video notes", () => {
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), candidate(), now);
    const entry = getCurrentLibraryEntry(adopted);
    const legacyFingerprint = JSON.stringify({
      project: JSON.parse(serializeProject({ ...entry.project, exports: [] })),
      plannerSource: entry.plannerSource,
    });
    expect(legacyFingerprint).not.toContain("videoPlan");
    const legacy = {
      ...adopted,
      projects: adopted.projects.map((item) => item.projectId === entry.projectId ? {
        ...item, candidateAcceptance: { ...item.candidateAcceptance!, afterFingerprint: legacyFingerprint },
      } : item),
    };
    const currentVideoPlan = videoPlan("旧采用记录之后新增的场景");
    const withVideo = updateLibraryProject(legacy, { ...entry.project, videoPlan: currentVideoPlan }, now);
    const persistence = storage();
    saveProjectLibrary(persistence, withVideo);
    const reloaded = loadProjectLibrary(persistence, demoProject, now);

    expect(getCurrentLibraryEntry(reloaded).candidateAcceptance?.afterFingerprint).toBe(legacyFingerprint);
    expect(canUndoLastAudioCandidate(reloaded)).toBe(true);
    const undone = getCurrentLibraryEntry(undoLastAudioCandidate(reloaded));
    expect(undone.project).toEqual({ ...demoProject, videoPlan: currentVideoPlan });
    expect(undone.candidateAcceptance).toBeUndefined();
  });

  it("does not load malformed or foreign recovery records", () => {
    const adopted = adoptAudioCandidate(createInitialProjectLibrary(demoProject, now), candidate(), now);
    const raw = JSON.parse(JSON.stringify(adopted));
    raw.projects[0].candidateAcceptance.beforeProject.project_id = "foreign";
    const persistence = storage();
    saveProjectLibrary(persistence, raw);
    const loaded = loadProjectLibrary(persistence, demoProject, now);
    expect(getCurrentLibraryEntry(loaded).project).toEqual(getCurrentLibraryEntry(adopted).project);
    expect(canUndoLastAudioCandidate(loaded)).toBe(false);
    expect((getCurrentLibraryEntry(loaded).project.timeline.tracks[0].clips as TimelineClip[])[0].asset.asset_id).toBe("candidate_1");
  });
});
