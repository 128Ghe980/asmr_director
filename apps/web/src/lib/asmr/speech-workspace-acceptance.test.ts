import { describe, expect, it } from "vitest";
import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { adoptAudioCandidate, canUndoLastAudioCandidate, undoLastAudioCandidate } from "./candidate-acceptance";
import { demoProject } from "./mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary, updateLibraryProject, type ProjectLibrary } from "./project-library";
import type { AsmrProject, SpeechWorkspaceMode } from "./schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getParagraphGroup, switchSpeechWorkspace } from "./speech-workspace";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";

function voices(project: AsmrProject) { return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips; }
function fixture(): AsmrProject {
  const project = structuredClone(demoProject);
  const source = voices(project)[0];
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track,
    clips: ["先坐一会儿。", "我给你倒茶。"].map((text, index) => ({ ...structuredClone(source), id: `voice_${index}`, text,
      start: index * 5, duration: 4, pause_after: 1, generation: { ...source.generation, status: "asset_generated" as const },
      asset: { asset_id: `old_short_${index}`, uri: `asset://clip/old_short_${index}`, duration: 4 } })) } : { ...track, clips: [] });
  project.duration = 15;
  project.emotion_curve = [{ start: 0, end: 15, emotion: "gentle" }];
  project.videoPlan = { version: 1, sceneDescription: "雨夜", shots: {} };
  return ensureSpeechWorkspaces(project);
}
function take(project: AsmrProject, id: string): AudioCandidate {
  const clip = voices(project)[0];
  const paragraph = project.speechWorkspace?.activeMode === "paragraph";
  const context = paragraph ? getVoiceParagraphContext(project, clip.id)! : undefined;
  const asset = { assetId: `${id}_0`, uri: `asset://clip/${id}_0`, duration: 2 };
  const result = makeVoiceCandidateFixture({ candidateId: id, projectId: project.project_id, clipId: clip.id, asset,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, context) });
  if (paragraph) {
    const members = getParagraphGroup(project, clip.id);
    result.provenance = { ...result.provenance, generationMode: "paragraph", paragraph: {
      version: 1, groupId: context!.groupId, text: context!.text, clipIds: members.map((member) => member.id),
      sourceAsset: { assetId: `${id}_source`, uri: `asset://clip/${id}_source`, duration: 2 * members.length }, checkStatus: "passed",
      segments: members.map((member, index) => ({ clipId: member.id, text: member.text,
        asset: { assetId: `${id}_${index}`, uri: `asset://clip/${id}_${index}`, duration: 2 }, cutStartSeconds: index * 2, cutEndSeconds: (index + 1) * 2 })),
    } };
  }
  return result;
}
function switchLibrary(library: ProjectLibrary, mode: SpeechWorkspaceMode): ProjectLibrary {
  return updateLibraryProject(library, switchSpeechWorkspace(getCurrentLibraryEntry(library).project, mode));
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("independent candidate adoption and undo for speech workspaces", () => {
  it("keeps an existing legacy adoption undo usable after initializing and visiting both workspaces", () => {
    const legacy = fixture();
    delete legacy.speechWorkspace;
    let library = adoptAudioCandidate(createInitialProjectLibrary(legacy), take(legacy, "legacy_take"));
    expect(getCurrentLibraryEntry(library).candidateAcceptance?.workspaceMode).toBeUndefined();
    expect(canUndoLastAudioCandidate(library)).toBe(true);
    library = switchLibrary(library, "paragraph");
    library = adoptAudioCandidate(library, take(getCurrentLibraryEntry(library).project, "new_paragraph_take"));
    const paragraphAfter = structuredClone(getCurrentLibraryEntry(library).project.speechWorkspace!.paragraph);
    library = switchLibrary(library, "short");
    expect(canUndoLastAudioCandidate(library)).toBe(true);
    const edited = structuredClone(getCurrentLibraryEntry(library).project);
    voices(edited)[0].text = "此后修改过的源文案。";
    expect(canUndoLastAudioCandidate(updateLibraryProject(library, edited))).toBe(false);
    library = undoLastAudioCandidate(library);
    expect(voices(getCurrentLibraryEntry(library).project)[0].asset.asset_id).toBe("old_short_0");
    expect(getCurrentLibraryEntry(library).project.speechWorkspace!.paragraph).toEqual(paragraphAfter);
    expect(getCurrentLibraryEntry(library).candidateAcceptances?.paragraph?.candidateId).toBe("new_paragraph_take");
  });

  it("adopts and undoes each mode without erasing results adopted later in the other mode", () => {
    const initial = fixture();
    let library = createInitialProjectLibrary(initial);
    library = adoptAudioCandidate(library, take(initial, "short_take"));
    const shortAfter = structuredClone(getCurrentLibraryEntry(library).project.speechWorkspace!.short);
    library = switchLibrary(library, "paragraph");
    expect(canUndoLastAudioCandidate(library)).toBe(false);
    const paragraphBefore = getCurrentLibraryEntry(library).project;
    library = adoptAudioCandidate(library, take(paragraphBefore, "paragraph_take"));
    const paragraphAfter = structuredClone(getCurrentLibraryEntry(library).project.speechWorkspace!.paragraph);
    expect(getCurrentLibraryEntry(library).project.speechWorkspace!.short).toEqual(shortAfter);
    expect(voices(getCurrentLibraryEntry(library).project).map((clip) => clip.asset.asset_id)).toEqual(["paragraph_take_0", "paragraph_take_1"]);
    library = switchLibrary(library, "short");
    expect(canUndoLastAudioCandidate(library)).toBe(true);
    library = undoLastAudioCandidate(library);
    expect(voices(getCurrentLibraryEntry(library).project)[0].asset.asset_id).toBe("old_short_0");
    expect(getCurrentLibraryEntry(library).project.speechWorkspace!.paragraph).toEqual(paragraphAfter);
    expect(getCurrentLibraryEntry(library).candidateAcceptances?.paragraph?.candidateId).toBe("paragraph_take");
    expect(canUndoLastAudioCandidate(library)).toBe(false);
    library = switchLibrary(library, "paragraph");
    expect(canUndoLastAudioCandidate(library)).toBe(true);
    library = undoLastAudioCandidate(library);
    expect(voices(getCurrentLibraryEntry(library).project).every((clip) => clip.asset.uri === null)).toBe(true);
    expect(getCurrentLibraryEntry(library).project.speechWorkspace!.short.clips[0].asset.asset_id).toBe("old_short_0");
  });

  it("persists separate undo records across reload and preserves the other mode's later visual and mix edits", () => {
    const initial = fixture();
    let library = adoptAudioCandidate(createInitialProjectLibrary(initial), take(initial, "short_take"));
    library = switchLibrary(library, "paragraph");
    let paragraph = getCurrentLibraryEntry(library).project;
    library = adoptAudioCandidate(library, take(paragraph, "paragraph_take"));
    paragraph = structuredClone(getCurrentLibraryEntry(library).project);
    paragraph.videoPlan = { version: 1, sceneDescription: "新整段分镜背景", shots: {} };
    paragraph.exports = [{ type: "wav", status: "exported", uri: "asset://mix/paragraph_mix" }];
    paragraph = captureSpeechWorkspace(paragraph, { mixFingerprint: "paragraph_mix_fingerprint" });
    library = updateLibraryProject(library, paragraph);
    const paragraphAfter = structuredClone(paragraph.speechWorkspace!.paragraph);
    library = switchLibrary(library, "short");
    const persisted = storage(); saveProjectLibrary(persisted, library);
    library = loadProjectLibrary(persisted, initial);
    expect(getCurrentLibraryEntry(library).candidateAcceptances?.short?.candidateId).toBe("short_take");
    expect(getCurrentLibraryEntry(library).candidateAcceptances?.paragraph?.candidateId).toBe("paragraph_take");
    expect(canUndoLastAudioCandidate(library)).toBe(true);
    const undone = undoLastAudioCandidate(library);
    expect(getCurrentLibraryEntry(undone).project.speechWorkspace!.paragraph).toEqual(paragraphAfter);
  });

  it("rejects candidates from the other workspace despite identical canonical sentence IDs", () => {
    const short = fixture();
    const paragraph = switchSpeechWorkspace(short, "paragraph");
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(short), take(paragraph, "paragraph_take"))).toThrow(/语音工作区/);
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(paragraph), take(short, "short_take"))).toThrow(/语音工作区/);
  });
});
