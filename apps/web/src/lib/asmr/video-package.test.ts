import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { getSpeechWorkspaceProject, ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { getVideoPackageFilename, getVideoPackageShots, getVideoPackageSummary } from "./video-package";

function fixture() {
  const project = structuredClone(demoProject);
  project.title = "雨夜/视频";
  const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
  clips.splice(3);
  project.videoPlan = { version: 1, sceneDescription: "雨夜的房间", shots: {}, referenceModes: {} };
  for (const clip of clips) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `take_${clip.id}`, uri: `asset://clip/take_${clip.id}`, duration: 4.321 };
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 4.321 },
      title: "陪伴", visual: "S1 sits at a table.", action: "S1 rests a hand on the table.", camera: "Static medium shot.",
    };
  }
  return { project, clips };
}

describe("video package input snapshot", () => {
  it("keeps display order and current mode choices without checking predecessor fingerprints", () => {
    const { project, clips } = fixture();
    const shot = project.videoPlan!.shots[clips[1].id];
    shot.previousClipId = "a_replaced_previous_clip";
    shot.previousPromptFingerprint = "old previous prompt";
    shot.referenceMode = "new";
    project.videoPlan!.referenceModes = { [clips[0].id]: "continuous", [clips[1].id]: "continuous" };
    clips.reverse();
    const before = structuredClone(project);
    expect(getVideoPackageSummary(project)).toEqual({ total: 3, ready: 3, issues: [] });
    expect(getVideoPackageShots(project).map(entry => [entry.index, entry.clip.id, entry.referenceMode]))
      .toEqual([[1, "voice_001", "new"], [2, "voice_002", "continuous"], [3, "voice_003", "new"]]);
    expect(project).toEqual(before);
    expect(getVideoPackageFilename(project)).toBe("雨夜 视频_视频项目包.zip");
  });

  it("reports every missing or stale input with 1-based ordinals instead of dropping shots", () => {
    const { project, clips } = fixture();
    clips[0].audio_stale = true;
    delete project.videoPlan!.shots[clips[1].id];
    project.videoPlan!.shots[clips[2].id].camera = " ";
    const summary = getVideoPackageSummary(project);
    expect(summary.total).toBe(3);
    expect(summary.ready).toBe(0);
    expect(summary.issues.map(issue => [issue.index, issue.clipId])).toEqual(clips.map((clip, index) => [index + 1, clip.id]));
    expect(summary.issues.every(issue => issue.message.length > 0)).toBe(true);
    expect(() => getVideoPackageShots(project)).toThrow(/第 1 段.*第 2 段.*第 3 段/);
  });

  it.each(["text", "asset", "identity", "duplicate"])("rejects the current shot's own invalid %s input", kind => {
    const { project, clips } = fixture();
    if (kind === "text") clips[0].text += "新内容";
    if (kind === "asset") clips[0].asset.uri = "asset://clip/other";
    if (kind === "identity") project.videoPlan!.shots[clips[0].id].clipId = "wrong";
    if (kind === "duplicate") clips[1].id = clips[0].id;
    expect(getVideoPackageSummary(project).issues[0]).toMatchObject({ clipId: clips[0].id, index: 1 });
  });

  it("includes silent clips without audio but requires ambient directions and at most five seconds", () => {
    const { project, clips } = fixture();
    const clip = clips[1];
    clip.kind = "silent"; clip.duration = 5;
    clip.generation.status = "asset_pending";
    clip.asset = { asset_id: null, uri: null, duration: null };
    const shot = project.videoPlan!.shots[clip.id];
    delete shot.audio;
    Object.assign(shot, { kind: "silent", duration: 5, ambientSound: "Quiet rain against the window.",
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id) });
    expect(getVideoPackageSummary(project).ready).toBe(3);
    delete (shot as typeof shot & { ambientSound?: string }).ambientSound;
    expect(getVideoPackageSummary(project).issues[0].message).toContain("环境");
    Object.assign(shot, { ambientSound: "Gentle room tone." });
    clip.duration = 5.1; shot.duration = 5.1;
    shot.sourceFingerprint = createClipVideoSourceFingerprint(project, clip.id);
    expect(getVideoPackageSummary(project).issues[0].message).toContain("5 秒");
  });

  it("exports only the active speech bank", () => {
    const { project } = fixture();
    const initialized = ensureSpeechWorkspaces(project);
    expect(getVideoPackageSummary(initialized).ready).toBe(3);
    const paragraph = switchSpeechWorkspace(initialized, "paragraph");
    expect(getVideoPackageSummary(paragraph)).toMatchObject({ total: 3, ready: 0 });
    expect(getVideoPackageSummary(getSpeechWorkspaceProject(paragraph, "short")).ready).toBe(3);
  });
});
