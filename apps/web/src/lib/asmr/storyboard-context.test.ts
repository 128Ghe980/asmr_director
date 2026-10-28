import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import type { AsmrProject } from "./schema";
import { createStoryboardGenerationContextFingerprint, createStoryboardScriptContext } from "./storyboard-context";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";

function fixture() {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  const clips = track.clips.slice(0, 3);
  track.clips = clips;
  for (const [index, clip] of clips.entries()) {
    clip.start = (3 - index) * 100;
    clip.duration = 50 + index;
    clip.text = ["我把水放在桌上了。", "窗边的薄雾散去。", "等会儿再喝吧。"][index];
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `context_${index}`, uri: `asset://clip/context_${index}`, duration: 2 + index };
  }
  clips[1].kind = "silent";
  clips[1].duration = 4.5;
  project.videoPlan = { version: 1, sceneDescription: "冬夜的木屋。", shots: {} };
  return { project, clips };
}

describe("storyboard semantic context and in-flight identity", () => {
  it("carries a prior POV's physical viewpoint and sound endpoints without sending assets", () => {
    const { project, clips } = fixture();
    project.videoPlan!.storyboardStyle = "listener_pov";
    project.videoPlan!.shots[clips[0].id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clips[0].id, storyboardStyle: "listener_pov",
      sourceFingerprint: createClipVideoSourceFingerprint(project, clips[0].id),
      title: "走到桌边", visual: "The table is ahead at the listener's waist.", action: "The listener comes to a stop beside the table.",
      camera: "The listener's eye-level view settles facing the window.", asmrSound: asmrSoundFixture,
      audio: { assetId: "context_0", uri: "asset://clip/context_0", duration: 2 },
    };
    const context = createStoryboardScriptContext(project, clips[2].id);
    expect(context.storyboardStyle).toBe("listener_pov");
    expect(context.scriptOrder[0].storyboardContext).toMatchObject({ camera: project.videoPlan!.shots[clips[0].id].camera, asmrSound: asmrSoundFixture });
    expect(JSON.stringify(context)).not.toContain("asset://");
    const fingerprint = createStoryboardGenerationContextFingerprint(project);
    project.videoPlan!.shots[clips[0].id].camera = "The listener is now seated facing the door.";
    expect(createStoryboardGenerationContextFingerprint(project)).not.toBe(fingerprint);
  });
  it("follows voice array order including silent actions, with only usable adopted speech duration metadata", () => {
    const { project, clips } = fixture();
    clips[2].generation.status = "asset_pending";
    const context = createStoryboardScriptContext(project, clips[1].id);
    expect(context).toEqual({ currentIndex: 1, storyboardStyle: "character_framing", scriptOrder: [
      { index: 0, clipId: clips[0].id, kind: "speech", text: clips[0].text, durationSeconds: 2 },
      { index: 1, clipId: clips[1].id, kind: "silent", text: clips[1].text, durationSeconds: 4.5 },
      { index: 2, clipId: clips[2].id, kind: "speech", text: clips[2].text },
    ] });
  });

  it("overrides only the selected duration with measured PCM length without mutating project metadata", () => {
    const { project, clips } = fixture();
    const before = structuredClone(project);
    const context = createStoryboardScriptContext(project, clips[0].id, .375);
    expect(context.scriptOrder.map(clip => clip.durationSeconds)).toEqual([.375, 4.5, 4]);
    expect(project).toEqual(before);
  });

  it.each(["stale", "pending", "mismatched_uri", "missing_duration"])("does not estimate speech duration for %s neighboring audio", kind => {
    const { project, clips } = fixture();
    if (kind === "stale") clips[2].audio_stale = true;
    if (kind === "pending") clips[2].generation.status = "asset_pending";
    if (kind === "mismatched_uri") clips[2].asset.uri = "asset://clip/other";
    if (kind === "missing_duration") clips[2].asset.duration = null;
    const item = createStoryboardScriptContext(project, clips[0].id).scriptOrder[2];
    expect(item.text).toBe(clips[2].text);
    expect(item).not.toHaveProperty("durationSeconds");
  });

  it("excludes starts, waits, estimated speech lengths, DSP and other tracks from context identity", () => {
    const { project, clips } = fixture();
    const fingerprint = createStoryboardGenerationContextFingerprint(project);
    clips[0].start += 1000;
    clips[0].duration = 98765;
    clips[0].pause_after = 12345;
    clips[0].volume_db = -30;
    clips[0].fade_in = 5;
    clips[0].fade_out = 6;
    clips[0].position = { pan: .8, movement: "recede", distance: "far" };
    const sfx = project.timeline.tracks.find(track => track.track_type === "sfx");
    if (sfx) sfx.clips = [];
    project.duration += 2000;
    expect(createStoryboardGenerationContextFingerprint(project)).toBe(fingerprint);
  });

  it.each([
    ["script text", (project: AsmrProject) => { project.timeline.tracks.find(track => track.track_type === "voice")!.clips[2].text += "明天。"; }],
    ["script order", (project: AsmrProject) => { project.timeline.tracks.find(track => track.track_type === "voice")!.clips.reverse(); }],
    ["role", (project: AsmrProject) => { project.character.role = "屋主人"; }],
    ["scene", (project: AsmrProject) => { project.videoPlan!.sceneDescription += "壁炉已点亮。"; }],
    ["adopted duration", (project: AsmrProject) => { project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0].asset.duration = 2.5; }],
    ["silent duration", (project: AsmrProject) => { project.timeline.tracks.find(track => track.track_type === "voice")!.clips[1].duration = 3; }],
  ] as const)("changes in-flight identity for %s", (_name, change) => {
    const { project } = fixture();
    const fingerprint = createStoryboardGenerationContextFingerprint(project);
    change(project);
    expect(createStoryboardGenerationContextFingerprint(project)).not.toBe(fingerprint);
  });

  it("sends optional existing action notes without camera or full H3/audio fields and tolerates unfinished notes", () => {
    const { project, clips } = fixture();
    project.videoPlan!.shots[clips[0].id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clips[0].id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clips[0].id),
      title: "汤已放好", visual: "A warm bowl sits on the table.", action: "S1 withdraws one hand from the bowl.", camera: "",
      audio: { assetId: "context_0", uri: "asset://clip/context_0", duration: 2 },
    };
    const context = createStoryboardScriptContext(project, clips[2].id);
    expect(context.scriptOrder[0].storyboardContext).toEqual({
      title: "汤已放好", visual: "A warm bowl sits on the table.", action: "S1 withdraws one hand from the bowl.",
    });
    expect(JSON.stringify(context)).not.toContain("asset://");
    expect(JSON.stringify(context)).not.toContain("camera");
    const fingerprint = createStoryboardGenerationContextFingerprint(project);
    project.videoPlan!.shots[clips[0].id].camera = "A hand-edited camera that is never sent as full-script context.";
    expect(createStoryboardGenerationContextFingerprint(project)).toBe(fingerprint);
    project.videoPlan!.shots[clips[0].id].action = "S1 now holds a spoon.";
    expect(createStoryboardGenerationContextFingerprint(project)).not.toBe(fingerprint);
  });

  it("does not cascade semantic context changes into existing clip source fingerprints", () => {
    const { project, clips } = fixture();
    const ownSource = createClipVideoSourceFingerprint(project, clips[0].id);
    const context = createStoryboardGenerationContextFingerprint(project);
    clips[2].text += "之后去窗边看看。";
    expect(createStoryboardGenerationContextFingerprint(project)).not.toBe(context);
    expect(createClipVideoSourceFingerprint(project, clips[0].id)).toBe(ownSource);
  });
});
