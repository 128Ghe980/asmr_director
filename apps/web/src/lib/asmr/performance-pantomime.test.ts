import { describe, expect, it, vi } from "vitest";
import { demoProject } from "./mock-project";
import { generateClipStoryboard, type ClipStoryboardRequest } from "./clip-storyboard-service";
import { performanceStoryboardMessages } from "./performance-storyboard";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { CAMERA_PANTOMIME_GUIDANCE } from "./camera-pantomime";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import type { VoiceClip } from "./schema";

const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_MODEL: "test", ASMR_PLANNER_API_KEY: "test" };
function fixture(duration = 12, performance = true): ClipStoryboardRequest {
  const project = structuredClone(demoProject), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  track.clips = [track.clips[0]];
  Object.assign(track.clips[0], { kind: "silent", text: "替听者整理领子，空手模拟动作并配布料拟音。", duration, pause_after: 0,
    asset: { asset_id: null, uri: null, duration: null },
    performance: performance ? { version: 1, segmentId: "mime", purpose: "asmr", direction: "双手空捏后舒展。", soundIntent: "布料拟音。" } : undefined });
  project.videoPlan = { version: 1, sceneDescription: "安静室内，S1对镜头表演。", storyboardStyle: "listener_pov", shots: {},
    referenceTemplate: { ...referenceTemplateFixture, id: "intimate-interaction-theatre", version: 3, visualPerformance: "pantomime" } };
  return { provider: "api", project, clipId: track.clips[0].id, includePrevious: false, referenceMode: "new", instruction: "" };
}
function clipFor(input: ClipStoryboardRequest) { return input.project.timeline.tracks[0].clips[0] as VoiceClip; }
function modelReply(quiet = false) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages, material = JSON.parse(messages[1].content.split("\n")[0]);
    const fields = { visual: "S1's complete head and shoulders remain visible with connected arms and empty hands raised below the frame center.",
      action: quiet ? "S1 holds a relaxed gaze with both empty hands still." : "S1 gently closes empty fingertips in the air, then opens them to each side, ending with both hands still raised.",
      camera: "Fixed frontal medium close shot.",
      ambientSound: quiet ? "Very quiet steady room tone." : "Soft dry fabric-friction foley matching the empty-hand gesture, with quiet gaps.",
      asmrSound: { ...structuredClone(asmrSoundFixture), prompt: quiet ? "Very quiet steady room tone, no voices or music." : "Record gentle dry fabric friction in a sound-only material close-up, synchronized to the mimed pinches and pauses, no voices or music." } };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "空手模拟整理", ...fields,
      ...(material.current.partDurations ? { parts: material.current.partDurations.map((durationSeconds: number, index: number) => ({ ...fields, durationSeconds,
        action: index === 0 ? "S1 raises connected empty hands below center and begins gentle fingertip pinches, keeping both hands engaged."
          : index === material.current.partDurations.length - 1 ? "S1 completes the remaining pinch, then slowly lowers empty hands to a relaxed position."
          : "S1 continues the established empty-handed rhythm with a quiet mid-motion pause, keeping the hands engaged for the next phase." })) } : {}) }) } }] });
  });
}

describe("pantomime performance design", () => {
  it("preserves a legacy 36-second gesture as continuous 12/12/12 parts while allowing sound-only material footage", async () => {
    const input = fixture(36), fetchImpl = modelReply();
    const result = await generateClipStoryboard(input, { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.storyboard.parts?.map(part => part.durationSeconds)).toEqual([12, 12, 12]);
    expect(result.storyboard.asmrSound?.mixMode).toBe("replace");
    expect(result.storyboard.parts?.every(part => part.asmrSound.mixMode === "replace")).toBe(true);
    expect(result.storyboard.parts?.[0].asmrSound.prompt).toContain("sound-only material close-up");
    const messages = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages;
    expect(messages[0].content).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(messages[0].content).toContain("空手位置和手势阶段");
    expect(messages[0].content).toContain("这些物件不能回灌主画面的visual/action");
    expect(messages[0].content).toContain("scene、direction、visual和action也不得安排呼气");
    for (const conflict of ["只用本段实际材料", "只有明确的听者进屋", "视点合理看向别处时允许画外讲话", "不能每项重新拿起道具"]) expect(messages[0].content).not.toContain(conflict);
    expect(messages[1].content).not.toContain("A held object cannot also remain");
  });

  it("uses the same empty-handed contract on short legacy clips without performance metadata, and keeps quiet reactions quiet", async () => {
    const input = fixture(4, false), clip = clipFor(input);
    clip.text = "角色安静看着镜头，等候回应。";
    const fetchImpl = modelReply(true), result = await generateClipStoryboard(input, { env, fetchImpl });
    expect(result.storyboard.parts).toBeUndefined();
    expect(result.storyboard.duration).toBe(4);
    expect(result.storyboard.ambientSound).toBe("Very quiet steady room tone.");
    expect(result.storyboard.asmrSound?.mixMode).toBe("replace");
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("纯凝视与等待只保留极轻室内底声");
  });

  it("keeps speech timing and overlay ownership while suppressing off-screen speech and target-seeking camera motion", () => {
    const input = fixture(7.25), clip = clipFor(input);
    delete clip.kind;
    clip.text = "领子有一点歪，我帮你理一下。";
    const messages = performanceStoryboardMessages(input, clip, 7.25, {});
    expect(messages[0].content).toContain("最终主视频完整fully_copy原音");
    expect(messages[0].content).toContain("asmrSound.mixMode必须为overlay");
    expect(messages[0].content).not.toContain("视点合理看向别处时允许画外讲话");
    expect(JSON.parse(messages[1].content.split("\n")[0]).current).toMatchObject({ kind: "speech", durationSeconds: 7.25 });
    expect(JSON.parse(messages[1].content.split("\n")[0]).current.partDurations).toBeUndefined();
  });

  it("keeps material-contact and listener movement instructions for unflagged saved snapshots", () => {
    const input = fixture(), clip = clipFor(input);
    input.project.videoPlan!.referenceTemplate!.version = 2;
    delete input.project.videoPlan!.referenceTemplate!.visualPerformance;
    const messages = performanceStoryboardMessages(input, clip, 30, {});
    expect(messages[0].content).not.toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(messages[0].content).toContain("只用本段实际材料");
    expect(messages[0].content).toContain("只有明确的听者进屋");
    expect(messages[0].content).toContain("不能每项重新拿起道具");
    expect(messages[1].content).toContain("A held object cannot also remain");
    expect(messages[1].content).not.toContain("CURRENT SEGMENT ONLY");
    expect(messages[0].content).not.toContain("scene、direction、visual和action也不得安排呼气");
  });

  it("removes prior generated staging examples but preserves script intentions and refocuses the current task after previousEnding", async () => {
    const input = fixture(), oldClip = clipFor(input);
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl: modelReply() });
    input.project.videoPlan!.shots[oldClip.id] = storyboard;
    const current = { ...structuredClone(oldClip), id: "new-task", text: "空手模拟缓缓扫过镜头两侧。",
      performance: { version: 1 as const, segmentId: "new-task", purpose: "asmr" as const,
        direction: "空手在两侧轮流划过并稍作停顿。", soundIntent: "轻柔刷扫拟音，随划过的动作交替。" } };
    input.project.timeline.tracks.find(track => track.track_type === "voice")!.clips.push(current);
    const before = structuredClone(input.project), previous = "Previous action: fingertip pinches followed by cloth friction. End pose: hands at chest level.";
    const messages = performanceStoryboardMessages(input, current, 12, {}, previous);
    const material = JSON.parse(messages[1].content.split("\n")[0]);
    expect(material.scriptOrder[0]).not.toHaveProperty("storyboardContext");
    expect(material.scriptOrder[0]).toMatchObject({ text: oldClip.text, performance: oldClip.performance });
    expect(material.scriptOrder[1]).toMatchObject({ text: current.text, performance: current.performance });
    expect(material.previousEnding).toBe(previous);
    const focusLine = messages[1].content.split("\n").find(line => line.startsWith("CURRENT SEGMENT ONLY"))!;
    const focus = JSON.parse(focusLine.slice(focusLine.indexOf("{")));
    expect(focus).toMatchObject({ clipId: current.id, text: current.text, direction: current.performance.direction,
      soundIntent: current.performance.soundIntent, durationSeconds: 12 });
    expect(messages[1].content.indexOf(focusLine)).toBeGreaterThan(messages[1].content.indexOf(previous));
    expect(messages[0].content).toContain("不得复演上一段动作、沿用其声音");
    expect(input.project).toEqual(before);
    delete input.project.videoPlan!.referenceTemplate!.visualPerformance;
    const legacy = JSON.parse(performanceStoryboardMessages(input, current, 12, {}, previous)[1].content.split("\n")[0]);
    expect(legacy.scriptOrder[0].storyboardContext.action).toBe(storyboard.action);
  });

  it("assigns start, continuation and finish across the entire timed performance, including window boundaries", () => {
    const input = fixture(45), clip = clipFor(input);
    const stagesFor = (offset: number, durations: number[], total: number) => {
      const messages = performanceStoryboardMessages(input, clip, 45, {}, "Hands remain raised.", { offset, durations, total });
      const focusLine = messages[1].content.split("\n").find(line => line.startsWith("CURRENT SEGMENT ONLY"))!;
      return JSON.parse(focusLine.slice(focusLine.indexOf("{"))).partStages;
    };
    const first = stagesFor(0, Array(8).fill(5), 9), last = stagesFor(8, [5], 9);
    expect(first.map((stage: { phase: string }) => stage.phase)).toEqual(["start", ...Array(7).fill("continue")]);
    expect(first.every((stage: { mayFinishSegment: boolean }) => !stage.mayFinishSegment)).toBe(true);
    expect(last).toMatchObject([{ partNumber: 9, durationSeconds: 5, phase: "finish", mayFinishSegment: true }]);
    expect([...first, ...last].reduce((sum, stage) => sum + stage.durationSeconds, 0)).toBe(45);
    expect(first.at(-1).staging).toContain("Do not close or restart");
  });
});
