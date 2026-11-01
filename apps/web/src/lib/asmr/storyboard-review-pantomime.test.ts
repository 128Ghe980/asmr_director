import { describe, expect, it, vi } from "vitest";
import { postProcessingProject } from "../../components/studio/audio-post-processing-test-fixture";
import { generateStoryboardReview } from "./storyboard-review-service";
import { ClipVideoStoryboardSchema, createClipVideoSourceFingerprint } from "./video-plan";
import { applyStoryboardReview } from "./storyboard-review";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { CAMERA_PANTOMIME_GUIDANCE } from "./camera-pantomime";

const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "test", ASMR_PLANNER_API_MODEL: "review-test" };
function fixture(pantomime = true, duration = 12) {
  const project = postProcessingProject(), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  track.clips = [track.clips[0]];
  const clip = track.clips[0];
  Object.assign(clip, { kind: "silent", duration, text: "角色空手在镜头两侧缓缓划过。", asset: { asset_id: null, uri: null, duration: null },
    performance: duration > 5 ? { version: 1, segmentId: "sweep", purpose: "asmr", direction: "空手在镜头两侧缓缓划过。", soundIntent: "柔和刷扫拟音。" } : undefined });
  project.videoPlan = { version: 1, sceneDescription: "安静室内，S1面对固定镜头。", storyboardStyle: "listener_pov", shots: {},
    referenceTemplate: { ...referenceTemplateFixture, id: "intimate-interaction-theatre", version: pantomime ? 3 : 2,
      ...(pantomime ? { visualPerformance: "pantomime" } : {}) } };
  const directions = { visual: "S1's full head and upper body remain visible, with connected empty hands raised beside the lens.",
    action: "S1 slowly sweeps empty fingertips through the camera-facing air.", camera: "Fixed frontal medium close shot.",
    ambientSound: "Soft brush-sweep foley matching the empty-hand gestures, with quiet gaps.",
    asmrSound: { ...structuredClone(asmrSoundFixture), mixMode: "replace" as const,
      prompt: "Gentle dry brush strokes recorded as foley for the empty-hand sweep, with quiet gaps." } };
  project.videoPlan.shots[clip.id] = ClipVideoStoryboardSchema.parse({ ...directions, version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    kind: "silent", duration, referenceMode: "new", storyboardStyle: "listener_pov", title: "空手轻扫",
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    ...(duration > 5 ? { parts: ["Start a gentle empty-hand sweep beside the lens and remain engaged.",
      "Continue the same gentle sweep, keeping empty hands raised.", "Complete the final sweep and lower empty hands slowly."].map(action => ({ ...directions, action, durationSeconds: 4 })) } : {}) });
  return { project, clip };
}
function fetchReply(value: unknown) { return vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] })); }

describe("pantomime storyboard review", () => {
  it("reviews mime and independent foley without instructing physical handoffs, moving POV or silent mime", async () => {
    const { project, clip } = fixture(), before = structuredClone(project), fetchImpl = fetchReply({ changes: [], notes: [] });
    const result = await generateStoryboardReview({ project, editableClipIds: [clip.id] }, { env, fetchImpl });
    expect(result.review.changes).toEqual([]);
    const messages = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages, system = messages[0].content;
    expect(system).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("不能因主画面空手就把声音删成静音");
    expect(system).toContain("不得将其物件带入主画面的visual/action");
    expect(system).toContain("只允许全段最后一块到达计划收尾");
    for (const conflict of ["passes the cloth into the listener's hands", "允许S1画外说话", "不能一直在原地拍摄S1", "只有脚本明确听者移动才改变主观视点", "无实物手势或表情停留不强加道具接触声"]) expect(system).not.toContain(conflict);
    const context = JSON.parse(messages[1].content);
    expect(context.referenceTemplate.visualPerformance).toBe("pantomime");
    expect(context.shots[0]).toMatchObject({ text: clip.text, performance: clip.performance, durationSeconds: 12 });
    expect(project).toEqual(before);
  });

  it("can repair a part's gesture and foley together without changing timing or replacement ownership", async () => {
    const { project, clip } = fixture(), original = project.videoPlan!.shots[clip.id], parts = structuredClone(original.parts!);
    parts[1].action = "Continue the empty-handed sweep beside the lens, pausing briefly with the hands still engaged.";
    parts[1].asmrSound.prompt = "Soft dry brush-sweep foley with a brief quiet pause matching the current gesture.";
    delete parts[1].asmrSound.mixMode;
    const fetchImpl = fetchReply({ changes: [{ shotNumber: "001", reason: "衔接中段手势与拟音", after: { parts } }], notes: [] });
    const { review } = await generateStoryboardReview({ project, editableClipIds: [clip.id] }, { env, fetchImpl });
    const changed = applyStoryboardReview(project, review).videoPlan!.shots[clip.id];
    expect(changed.parts?.map(part => part.durationSeconds)).toEqual([4, 4, 4]);
    expect(changed.parts?.every(part => part.asmrSound.mixMode === "replace")).toBe(true);
    expect(changed.parts?.[1].action).toBe(parts[1].action);
    expect(changed.parts?.[1].asmrSound.prompt).toBe(parts[1].asmrSound.prompt);
    expect(changed.asmrSound).toEqual(original.asmrSound);
    expect(changed.sourceFingerprint).toBe(original.sourceFingerprint);
  });

  it("applies the template contract to short clips without performance metadata and allows quiet reactions", async () => {
    const { project, clip } = fixture(true, 4), fetchImpl = fetchReply({ changes: [], notes: [] });
    await generateStoryboardReview({ project, editableClipIds: [clip.id] }, { env, fetchImpl });
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("不为安静停留强添手势");
    expect(system).toContain("纯凝视与等待只保留安静环境");
  });

  it("retains the original physical-continuity review for unflagged saved snapshots", async () => {
    const { project, clip } = fixture(false), fetchImpl = fetchReply({ changes: [], notes: [] });
    await generateStoryboardReview({ project, editableClipIds: [clip.id] }, { env, fetchImpl });
    const system = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).not.toContain(CAMERA_PANTOMIME_GUIDANCE);
    expect(system).toContain("passes the cloth into the listener's hands");
    expect(system).toContain("允许S1画外说话");
    expect(system).toContain("只有脚本明确听者移动才改变主观视点");
    expect(system).toContain("无实物手势或表情停留不强加道具接触声");
  });
});
