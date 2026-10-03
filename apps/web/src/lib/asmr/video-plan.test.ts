import { describe, expect, it } from "vitest";

import { getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { getClipGenerationFingerprint, getProjectMixFingerprint } from "./generation-fingerprint";
import { demoProject } from "./mock-project";
import { parseImportedProject, serializeProject } from "./project-persistence";
import { AsmrProjectSchema, type AsmrProject, type VoiceClip } from "./schema";
import {
  ClipVideoStoryboardSchema, ProjectVideoPlanSchema, createClipH3Prompt,
  StoryboardReferenceModeSchema, createClipVideoSourceFingerprint, getClipStoryboardReferenceContext,
  getClipStoryboardReferenceMode, getPreviousClipPromptFingerprint,
  getPreviousVoiceClip, isClipVideoStoryboardCurrent, type ClipVideoStoryboard,
} from "./video-plan";

const sceneDescription = "A quiet reading room in warm light, with rain outside the window.";
const firstId = "voice_001";
const secondId = "voice_002";
const thirdId = "voice_003";

function voice(project: AsmrProject, clipId = firstId): VoiceClip {
  return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.find((clip) => clip.id === clipId)!;
}

function makeProject(): AsmrProject {
  const project = structuredClone(demoProject);
  const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  for (const [index, clip] of voices.entries()) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${clip.id}`, uri: `asset://clip/adopted_${clip.id}`, duration: 3.21 + index };
  }
  project.videoPlan = { version: 1, sceneDescription, shots: {} };
  return project;
}

function putShot(project: AsmrProject, clipId = firstId, patch: Partial<ClipVideoStoryboard> = {}): ClipVideoStoryboard {
  const clip = voice(project, clipId);
  const shot: ClipVideoStoryboard = {
    version: 1, promptFormat: "minimax-h3", clipId,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clipId),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: clip.asset.duration ?? 3.21 },
    title: "窗边陪伴", visual: "S1 sits near the window in warm light.",
    action: "S1 rests one hand on the table with the mouth visible.", camera: "Static medium close-up.",
    ...patch,
  };
  project.videoPlan!.shots[clipId] = shot;
  return shot;
}

function putLinkedShot(project: AsmrProject, clipId: string): ClipVideoStoryboard {
  const previous = getPreviousVoiceClip(project, clipId)!;
  const previousPromptFingerprint = getPreviousClipPromptFingerprint(project, clipId);
  expect(previousPromptFingerprint).toBeTruthy();
  return putShot(project, clipId, { previousClipId: previous.id, previousPromptFingerprint });
}

describe("clip video plan metadata", () => {
  it("retains valid optional metadata in Project JSON and restores old V1 audio without adding a video plan", () => {
    const project = makeProject();
    putShot(project);
    const exported = serializeProject(project);
    expect(exported).toContain('"videoPlan"');
    const restored = parseImportedProject(exported);
    expect(restored).toEqual({ success: true, project });
    const legacy = structuredClone(demoProject);
    expect(parseImportedProject(serializeProject(legacy))).toEqual({ success: true, project: legacy });
    expect(AsmrProjectSchema.parse(legacy)).not.toHaveProperty("videoPlan");
  });

  it.each(["version", "scene type", "scene length", "wrong key", "wrong audio", "duration", "format", "partial previous"])("discards %s video metadata independently while preserving all existing audio", (kind) => {
    const project = makeProject();
    putShot(project);
    const raw = JSON.parse(serializeProject(project));
    if (kind === "version") raw.videoPlan.version = 2;
    if (kind === "scene type") raw.videoPlan.sceneDescription = 42;
    if (kind === "scene length") raw.videoPlan.sceneDescription = "x".repeat(4001);
    if (kind === "wrong key") raw.videoPlan.shots[firstId].clipId = secondId;
    if (kind === "wrong audio") raw.videoPlan.shots[firstId].audio.uri = "asset://clip/different_asset";
    if (kind === "duration") raw.videoPlan.shots[firstId].audio.duration = 0;
    if (kind === "format") raw.videoPlan.shots[firstId].promptFormat = "minimax-h4";
    if (kind === "partial previous") raw.videoPlan.shots[firstId].previousClipId = secondId;
    const restored = AsmrProjectSchema.parse(raw);
    expect(restored.videoPlan).toBeUndefined();
    expect(restored.timeline).toEqual(project.timeline);
    expect(restored.exports).toEqual(project.exports);
    expect(restored.title).toBe(project.title);
  });

  it.each(["title", "visual", "action", "camera"] as const)("preserves an empty editable %s but prevents copying an incomplete prompt", (key) => {
    const project = makeProject();
    const shot = putShot(project, firstId, { [key]: "" });
    expect(ClipVideoStoryboardSchema.parse(shot)).toEqual(shot);
    expect(ProjectVideoPlanSchema.parse(project.videoPlan)).toEqual(project.videoPlan);
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(true);
    expect(() => createClipH3Prompt(project, firstId)).toThrow("补全");
  });

  it("keeps an explicitly cleared scene editable while distinguishing it from an absent legacy scene", () => {
    const project = makeProject();
    delete project.videoPlan;
    const fallback = createClipVideoSourceFingerprint(project, firstId);
    project.videoPlan = { version: 1, sceneDescription: project.scene.name, shots: {} };
    expect(createClipVideoSourceFingerprint(project, firstId)).toBe(fallback);
    project.videoPlan.sceneDescription = "";
    expect(createClipVideoSourceFingerprint(project, firstId)).not.toBe(fallback);
    putShot(project);
    expect(ProjectVideoPlanSchema.safeParse(project.videoPlan).success).toBe(true);
    expect(() => createClipH3Prompt(project, firstId)).toThrow("补全");
  });

  it("does not change mix, clip generation or voice-candidate fingerprints when video metadata is edited", () => {
    const project = makeProject();
    const mix = getProjectMixFingerprint(project);
    const clip = getClipGenerationFingerprint(voice(project));
    const candidate = getVoiceCandidateSourceFingerprint(voice(project));
    project.videoPlan!.sceneDescription = "Another editable English video setting.";
    putShot(project);
    project.videoPlan!.shots[firstId].visual = "The user edited only the video frame.";
    expect(getProjectMixFingerprint(project)).toBe(mix);
    expect(getClipGenerationFingerprint(voice(project))).toBe(clip);
    expect(getVoiceCandidateSourceFingerprint(voice(project))).toBe(candidate);
  });
});

describe("clip video source and audio binding", () => {
  it("ignores arrangement waits, estimated clip duration, gain and spatial settings when preserving a video source", () => {
    const project = makeProject();
    putShot(project);
    const fingerprint = createClipVideoSourceFingerprint(project, firstId);
    const clip = voice(project);
    clip.start += 1;
    clip.duration = 9;
    clip.pause_after = 2.75;
    clip.volume_db = -3;
    clip.fade_in = .5;
    clip.fade_out = .6;
    clip.position = { pan: .7, distance: "far", movement: "orbit" };
    project.timeline.mixing.binaural = !project.timeline.mixing.binaural;
    expect(createClipVideoSourceFingerprint(project, firstId)).toBe(fingerprint);
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(true);
    expect(createClipH3Prompt(project, firstId)).toContain("3.21 seconds");
    expect(createClipH3Prompt(project, firstId)).not.toContain("9 seconds");
  });

  const sourceEdits: { name: string; edit: (project: AsmrProject) => void }[] = [
    { name: "dialogue", edit: (project) => { voice(project).text += "新加一句。"; } },
    { name: "adopted audio", edit: (project) => { voice(project).asset = { asset_id: "another_take", uri: "asset://clip/another_take", duration: 3.21 }; } },
    { name: "declared audio duration", edit: (project) => { voice(project).asset.duration = 4.25; } },
    { name: "base scene", edit: (project) => { project.scene.name += "另一场景"; } },
    { name: "character", edit: (project) => { project.character.role = "another speaker"; } },
    { name: "character expression", edit: (project) => { project.character.speech_style = ["another style"]; } },
    { name: "global description", edit: (project) => { project.videoPlan!.sceneDescription += " The lighting has changed."; } },
  ];
  it.each(sourceEdits)("invalidates existing metadata after $name changes", ({ edit }) => {
    const project = makeProject();
    const shot = putShot(project);
    edit(project);
    expect(createClipVideoSourceFingerprint(project, firstId)).not.toBe(shot.sourceFingerprint);
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(false);
    expect(() => createClipH3Prompt(project, firstId)).toThrow("更新");
    expect(project.videoPlan!.shots[firstId]).toEqual(shot);
  });

  it.each(["pending", "failed", "mock", "mix", "inconsistent", "unsafe", "blank"])("rejects a %s source before presenting a usable video prompt", (kind) => {
    const project = makeProject();
    putShot(project);
    const clip = voice(project);
    if (kind === "pending") clip.generation.status = "asset_pending";
    if (kind === "failed") clip.generation.status = "asset_failed";
    if (kind === "mock") clip.asset.uri = "mock://asset/voice_001/take";
    if (kind === "mix") clip.asset.uri = "asset://mix/adopted_voice_001";
    if (kind === "inconsistent") clip.asset.uri = "asset://clip/different";
    if (kind === "unsafe") clip.asset = { asset_id: "../unsafe", uri: "asset://clip/../unsafe", duration: 3.21 };
    if (kind === "blank") clip.text = " \n ";
    expect(() => createClipVideoSourceFingerprint(project, firstId)).toThrow("生成并采用");
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(false);
    expect(() => createClipH3Prompt(project, firstId)).toThrow("生成并采用");
  });

  it("uses the measured complete WAV length and verbatim current dialogue in a single independent H3 task", () => {
    const project = makeProject();
    const clip = voice(project);
    clip.text = "  来~~，面来啦！\n慢点儿吃，<d>小心烫。</d>  ";
    clip.asset.duration = null;
    const shot = putShot(project, firstId, { audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 4.321 } });
    const before = structuredClone(project);
    const prompt = createClipH3Prompt(project, firstId);
    expect(prompt).toContain(`<d>[Chinese]${clip.text}</d>`);
    expect(prompt).toContain("4.321 seconds");
    expect(prompt).toContain("<Audio 1>: fully_copy");
    expect(prompt).toContain("non_diegetic_music: N/A");
    expect(prompt).toContain("Appearance and outfit follow <Picture 1>, overriding written descriptions");
    expect(prompt).toContain("keep the mouth visible, with lips closed during pauses and at the end");
    expect(prompt).toContain("preserving words, voice, pace and pauses. Add no other sound");
    expect(prompt).not.toContain(sceneDescription);
    for (const removed of ["summary:", "Shared setting:", "detailed_description:", "overall_soundscape:", "Previous visual continuity:"]) expect(prompt).not.toContain(removed);
    expect(prompt.length - clip.text.length).toBeLessThan(1000);
    expect(prompt.match(/\[Shot 1\]/g)).toHaveLength(1);
    expect(prompt).not.toContain("[Shot 2]");
    expect(prompt).not.toContain("<Audio 2>");
    expect(prompt).not.toContain(shot.audio.uri);
    expect(prompt).not.toContain(firstId);
    expect(project).toEqual(before);
  });
});

describe("optional preceding-shot continuity", () => {
  it("finds only the adjacent previous voice in timeline order and never substitutes a sound effect", () => {
    const project = makeProject();
    const track = project.timeline.tracks.find((item) => item.track_type === "voice")!;
    track.clips.reverse();
    expect(getPreviousVoiceClip(project, firstId)).toBeUndefined();
    expect(getPreviousVoiceClip(project, secondId)?.id).toBe(firstId);
    expect(getPreviousVoiceClip(project, thirdId)?.id).toBe(secondId);
    expect(getPreviousVoiceClip(project, "missing")).toBeUndefined();
    const sfxId = project.timeline.tracks.find((item) => item.track_type === "sfx")!.clips[0].id;
    expect(getPreviousVoiceClip(project, sfxId)).toBeUndefined();
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBeUndefined();
  });

  it.each(["title", "visual", "action", "camera"] as const)("binds preceding $0 hand edits without copying its dialogue or audio into this shot", (key) => {
    const project = makeProject();
    const previous = putShot(project);
    const shot = putLinkedShot(project, secondId);
    shot.visual = "S1 stands beside a fireplace, with falling snow visible through the window.";
    putShot(project, thirdId);
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(true);
    const prompt = createClipH3Prompt(project, secondId);
    expect(prompt).toContain(shot.visual);
    expect(prompt).not.toContain(previous.visual);
    expect(prompt).not.toContain(sceneDescription);
    expect(prompt).not.toContain("Previous action continuity:");
    expect(prompt).toContain(`<d>[Chinese]${voice(project, secondId).text}</d>`);
    expect(prompt).not.toContain(voice(project).text);
    expect(prompt.match(/<Audio 1>: fully_copy/g)).toHaveLength(1);
    previous[key] += " A hand edit changes the reference.";
    expect(getPreviousClipPromptFingerprint(project, secondId)).not.toBe(shot.previousPromptFingerprint);
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(false);
    expect(isClipVideoStoryboardCurrent(project, thirdId)).toBe(true);
  });

  it("rejects linked continuity when preceding audio/dialogue changes, but ignores its gain and wait", () => {
    const project = makeProject();
    putShot(project);
    putLinkedShot(project, secondId);
    const fingerprint = getPreviousClipPromptFingerprint(project, secondId);
    voice(project).volume_db = -20;
    voice(project).pause_after = 8;
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBe(fingerprint);
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(true);
    const textEdit = structuredClone(project);
    voice(textEdit).text += "另一句。";
    expect(getPreviousClipPromptFingerprint(textEdit, secondId)).toBeUndefined();
    expect(isClipVideoStoryboardCurrent(textEdit, secondId)).toBe(false);
    voice(project).asset = { asset_id: "new_preceding_take", uri: "asset://clip/new_preceding_take", duration: 3.21 };
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBeUndefined();
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(false);
  });

  it("checks dependency chains iteratively and rejects cycles or nonadjacent references", () => {
    const project = makeProject();
    putShot(project);
    putLinkedShot(project, secondId);
    putLinkedShot(project, thirdId);
    expect(isClipVideoStoryboardCurrent(project, thirdId)).toBe(true);
    const nonadjacent = structuredClone(project);
    nonadjacent.videoPlan!.shots[thirdId].previousClipId = firstId;
    expect(isClipVideoStoryboardCurrent(nonadjacent, thirdId)).toBe(false);
    project.videoPlan!.shots[firstId].visual += " New lighting.";
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(false);
    expect(isClipVideoStoryboardCurrent(project, thirdId)).toBe(false);
    const cycle = makeProject();
    putShot(cycle);
    putLinkedShot(cycle, secondId);
    cycle.videoPlan!.shots[firstId].previousClipId = secondId;
    cycle.videoPlan!.shots[firstId].previousPromptFingerprint = "fabricated-cycle";
    expect(isClipVideoStoryboardCurrent(cycle, firstId)).toBe(false);
    expect(isClipVideoStoryboardCurrent(cycle, secondId)).toBe(false);
    expect(getPreviousClipPromptFingerprint(cycle, secondId)).toBeUndefined();
  });

  it("keeps a cleared previous shot visible but blocks it as a continuation source", () => {
    const project = makeProject();
    const previous = putShot(project);
    putLinkedShot(project, secondId);
    previous.camera = "";
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(true);
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBeUndefined();
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(false);
  });
});

describe("storyboard reference modes", () => {
  it("preserves optional preferences and generated mode in exported project JSON while keeping legacy records unchanged", () => {
    const project = makeProject();
    putShot(project, firstId, { referenceMode: "new" });
    project.videoPlan!.referenceModes = { [firstId]: "new", [secondId]: "continuous", [thirdId]: "new" };
    expect(parseImportedProject(serializeProject(project))).toEqual({ success: true, project });
    const legacy = makeProject();
    putShot(legacy);
    expect(ProjectVideoPlanSchema.parse(legacy.videoPlan)).toEqual(legacy.videoPlan);
    expect(legacy.videoPlan).not.toHaveProperty("referenceModes");
    expect(legacy.videoPlan!.shots[firstId]).not.toHaveProperty("referenceMode");
  });

  it("resolves explicit preferences before generated mode and legacy links, while always forcing the first voice to new", () => {
    const project = makeProject();
    putShot(project);
    const second = putLinkedShot(project, secondId);
    expect(getClipStoryboardReferenceMode(project, secondId)).toBe("continuous");
    second.referenceMode = "new";
    expect(getClipStoryboardReferenceMode(project, secondId)).toBe("new");
    project.videoPlan!.referenceModes = { [firstId]: "continuous", [secondId]: "continuous" };
    project.videoPlan!.shots[firstId].referenceMode = "continuous";
    expect(getClipStoryboardReferenceMode(project, firstId)).toBe("new");
    expect(getClipStoryboardReferenceMode(project, secondId)).toBe("continuous");
    expect(getClipStoryboardReferenceMode(project, thirdId)).toBe("new");
    const track = project.timeline.tracks.find((item) => item.track_type === "voice")!;
    track.clips.reverse();
    expect(getClipStoryboardReferenceMode(project, firstId)).toBe("new");
  });

  it("keeps existing prompts, source identity and dependent-shot validity when only next-generation preferences change", () => {
    const project = makeProject();
    putShot(project);
    putLinkedShot(project, secondId);
    const source = createClipVideoSourceFingerprint(project, secondId);
    const predecessor = getPreviousClipPromptFingerprint(project, secondId);
    const firstPrompt = createClipH3Prompt(project, firstId);
    const secondPrompt = createClipH3Prompt(project, secondId);
    const shots = structuredClone(project.videoPlan!.shots);
    project.videoPlan!.referenceModes = { [firstId]: "continuous", [secondId]: "new" };
    expect(createClipVideoSourceFingerprint(project, secondId)).toBe(source);
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBe(predecessor);
    expect(isClipVideoStoryboardCurrent(project, firstId)).toBe(true);
    expect(isClipVideoStoryboardCurrent(project, secondId)).toBe(true);
    expect(createClipH3Prompt(project, firstId)).toBe(firstPrompt);
    expect(createClipH3Prompt(project, secondId)).toBe(secondPrompt);
    expect(project.videoPlan!.shots).toEqual(shots);
  });

  it.each(["continuous", "new"] as const)("offers only a usable adjacent predecessor for %s generation", (mode) => {
    const project = makeProject();
    expect(getClipStoryboardReferenceContext(project, firstId, mode)).toBeUndefined();
    expect(getClipStoryboardReferenceContext(project, secondId, mode)).toBeUndefined();
    const previous = putShot(project);
    expect(getClipStoryboardReferenceContext(project, secondId, mode)).toEqual({
      previousClipId: firstId, previousPromptFingerprint: getPreviousClipPromptFingerprint(project, secondId),
    });
    expect(getClipStoryboardReferenceContext(project, thirdId, mode)).toBeUndefined();
    previous.camera = "";
    expect(getClipStoryboardReferenceContext(project, secondId, mode)).toBeUndefined();
    previous.camera = "Static medium close-up.";
    voice(project).text += "Edited dialogue.";
    expect(getClipStoryboardReferenceContext(project, secondId, mode)).toBeUndefined();
  });

  it("keeps legacy predecessor fingerprint bytes and includes mode only when a generated shot stores it", () => {
    const project = makeProject();
    const shot = putShot(project);
    const legacy = JSON.stringify({
      clipId: shot.clipId, sourceFingerprint: shot.sourceFingerprint, audio: shot.audio,
      title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera,
    });
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBe(legacy);
    shot.referenceMode = "new";
    expect(getPreviousClipPromptFingerprint(project, secondId)).toBe(JSON.stringify({
      ...JSON.parse(legacy), referenceMode: "new",
    }));
  });

  it("rejects unsupported preference or saved modes without discarding the audio project", () => {
    expect(StoryboardReferenceModeSchema.safeParse("independent").success).toBe(false);
    const project = makeProject();
    putShot(project);
    const raw = JSON.parse(serializeProject(project));
    raw.videoPlan.referenceModes = { [secondId]: "independent" };
    expect(AsmrProjectSchema.parse(raw).videoPlan).toBeUndefined();
    expect(AsmrProjectSchema.parse(raw).timeline).toEqual(project.timeline);
    delete raw.videoPlan.referenceModes;
    raw.videoPlan.shots[firstId].referenceMode = "independent";
    expect(AsmrProjectSchema.parse(raw).videoPlan).toBeUndefined();
  });
});
