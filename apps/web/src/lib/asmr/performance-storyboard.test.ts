import { describe, expect, it, vi } from "vitest";
import { demoProject } from "./mock-project";
import { generateClipStoryboard, type ClipStoryboardRequest } from "./clip-storyboard-service";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { performancePartDurations } from "./performance-segment";
import { applyClipStoryboardEdits, ClipVideoStoryboardSchema, createClipH3Prompt, createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint, isClipVideoStoryboardCurrent } from "./video-plan";
import { applyStoryboardReview, getStoryboardReviewFingerprint, getStoryboardReviewSummary, pickStoryboardReviewFields } from "./storyboard-review";
import { createStoryboardScriptContext } from "./storyboard-context";
import { generateStoryboardReview } from "./storyboard-review-service";

const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_MODEL: "test", ASMR_PLANNER_API_KEY: "test" };
function fixture(duration = 20): ClipStoryboardRequest {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  track.clips = [track.clips[0]];
  Object.assign(track.clips[0], { kind: "silent", text: "握着木盒，持续轻敲后安静停住。", duration, pause_after: 0,
    asset: { asset_id: null, uri: null, duration: null },
    performance: { version: 1, segmentId: "tapping", purpose: "asmr", direction: "已握盒，持续敲击，末尾持稳。", soundIntent: "木盒轻敲" } });
  project.videoPlan = { version: 1, sceneDescription: "安静室内的桌前。", storyboardStyle: "listener_pov", shots: {} };
  return { provider: "api", project, clipId: track.clips[0].id, includePrevious: false, referenceMode: "new", instruction: "" };
}
function fetchForParts(transform?: (value: Record<string, unknown>) => void) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const material = JSON.parse(body.messages[1].content.split("\n")[0]);
    const durations: number[] | undefined = material.current.partDurations;
    const value: Record<string, unknown> = { title: "木盒轻敲", visual: "S1 already holds the wooden box.",
      action: "S1 gently taps the box then holds it still.", camera: "Keep the established seated listener viewpoint.",
      ambientSound: "Soft hollow wood taps with natural quiet gaps.", asmrSound: structuredClone(asmrSoundFixture),
      ...(durations ? { parts: durations.map((durationSeconds, index) => ({ durationSeconds,
        visual: `S1 holds the same box at stage ${(material.current.window?.offset ?? 0) + index + 1}.`,
        action: `Continue light taps; end with hand position ${(material.current.window?.offset ?? 0) + index + 1}.`,
        camera: "Fixed seated listener viewpoint.", ambientSound: "Soft wooden taps with gaps.",
        asmrSound: structuredClone(asmrSoundFixture) })) } : {}) };
    transform?.(value);
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  });
}

describe("performance segment planning", () => {
  it("keeps long and fractional durations within backend limits without losing the planned duration", () => {
    for (const duration of [.1, 5, 5.1, 20, 45, 120.23, 599.99, 600]) {
      const parts = performancePartDurations(duration);
      expect(parts.every(value => value > 0 && value <= 5)).toBe(true);
      expect(parts.reduce((sum, value) => sum + value, 0)).toBeCloseTo(duration, 5);
    }
  });
  it("designs a 20-second ASMR performance with four continuous parts and one primary sound source", async () => {
    const input = fixture(), fetchImpl = fetchForParts();
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(storyboard.parts?.map(part => part.durationSeconds)).toEqual([5, 5, 5, 5]);
    expect(storyboard.parts?.every(part => part.asmrSound.mixMode === "replace")).toBe(true);
    expect(storyboard.asmrSound?.mixMode).toBe("replace");
    input.project.videoPlan!.shots[input.clipId] = storyboard;
    expect(getStoryboardReviewSummary(input.project).ready).toBe(true);
    expect(createClipH3Prompt(input.project, input.clipId)).toContain("Part 4/4");
    expect(createClipH3Prompt(input.project, input.clipId)).toContain("Sound is the main content");
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain("无实物表演");
    expect(JSON.parse(body.messages[1].content.split("\n")[0]).current.performance.segmentId).toBe("tapping");
  });
  it("bounds longer responses and supplies the preceding window ending to the next window", async () => {
    const fetchImpl = fetchForParts();
    const { storyboard } = await generateClipStoryboard(fixture(45), { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(storyboard.parts).toHaveLength(9);
    const second = JSON.parse(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).messages[1].content.split("\n")[0]);
    expect(second.current.window).toEqual({ offset: 8, durations: [5], total: 9 });
    expect(second.previousEnding).toContain("hand position 8");
  });
  it("rejects wrong part lengths instead of returning an incomplete plan", async () => {
    const fetchImpl = fetchForParts(value => { (value.parts as { durationSeconds: number }[])[0].durationSeconds = 4; });
    await expect(generateClipStoryboard(fixture(), { env, fetchImpl })).rejects.toThrow("时长或内容不完整");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("repairs non-English part directions once without changing the planned timing", async () => {
    let calls = 0;
    const fetchImpl = fetchForParts(value => {
      if (++calls === 1) (value.parts as { action: string }[])[0].action = "继续轻敲木盒。";
    });
    const result = await generateClipStoryboard(fixture(), { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.storyboard.parts!.map(part => part.durationSeconds)).toEqual([5, 5, 5, 5]);
    expect(result.storyboard.parts![0].action).toContain("Continue light taps");
    const request = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(request.messages.at(-1).content).toContain("must be English");
  });
  it("fingerprints stable segment intent and invalidates detailed plans on overview edits", async () => {
    const input = fixture();
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl: fetchForParts() });
    input.project.videoPlan!.shots[input.clipId] = storyboard;
    const track = input.project.timeline.tracks.find(track => track.track_type === "voice")!;
    expect(createStoryboardScriptContext(input.project, input.clipId).scriptOrder[0]).toHaveProperty("performance.segmentId", "tapping");
    const before = createClipVideoSourceFingerprint(input.project, input.clipId);
    track.clips[0].performance!.soundIntent = "停止敲击，保持安静";
    expect(createClipVideoSourceFingerprint(input.project, input.clipId)).not.toBe(before);
    expect(isClipVideoStoryboardCurrent(input.project, input.clipId)).toBe(false);
    expect(applyClipStoryboardEdits(storyboard, { action: "Hold still." }).parts).toBeUndefined();
    expect(applyClipStoryboardEdits(storyboard, { title: "改标题" }).parts).toHaveLength(4);
  });
  it("applies and reverses detailed review edits while prohibiting timing changes", async () => {
    const input = fixture();
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl: fetchForParts() });
    input.project.videoPlan!.shots[input.clipId] = storyboard;
    const before = pickStoryboardReviewFields(storyboard), after = structuredClone(before);
    after.parts![1].action = "Continue with the same hand position, ending slightly above the lid.";
    const review = { inputFingerprint: getStoryboardReviewFingerprint(input.project), changes: [{ clipId: input.clipId, reason: "保持接触位置", before, after }], notes: [] };
    const updated = applyStoryboardReview(input.project, review);
    expect(updated.videoPlan!.shots[input.clipId].parts![1].action).toBe(after.parts![1].action);
    const restored = applyStoryboardReview(updated, { ...review, inputFingerprint: getStoryboardReviewFingerprint(updated), changes: [{ ...review.changes[0], before: after, after: before }] });
    expect(restored.videoPlan!.shots[input.clipId].parts).toEqual(storyboard.parts);
    after.parts![1].durationSeconds = 4;
    expect(() => applyStoryboardReview(input.project, review)).toThrow("数量或时长");
  });
  it("retains replacement sound ownership through a review and rejects blank part directions", async () => {
    const input = fixture();
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl: fetchForParts() });
    input.project.videoPlan!.shots[input.clipId] = storyboard;
    const after = pickStoryboardReviewFields(storyboard);
    after.asmrSound = { ...after.asmrSound!, prompt: "Soft taps followed by quiet." };
    delete after.asmrSound.mixMode;
    after.parts = structuredClone(after.parts);
    delete after.parts![0].asmrSound.mixMode;
    after.parts![0].asmrSound.prompt = "Two dry fingertip taps.";
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ changes: [{ shotNumber: "001", reason: "匹配接触声音", after }], notes: [] }) } }] }));
    const { review } = await generateStoryboardReview({ project: input.project, editableClipIds: [input.clipId] }, { env, fetchImpl });
    expect(review.changes[0].after.asmrSound?.mixMode).toBe("replace");
    expect(review.changes[0].after.parts![0].asmrSound.mixMode).toBe("replace");
    const updated = applyStoryboardReview(input.project, review);
    expect(updated.videoPlan!.shots[input.clipId].parts![0].asmrSound.mixMode).toBe("replace");
    after.parts![0].visual = " ";
    await expect(generateStoryboardReview({ project: input.project, editableClipIds: [input.clipId] }, { env, fetchImpl })).rejects.toThrow("内容不完整");
    expect(() => applyStoryboardReview(input.project, { ...review, changes: [{ ...review.changes[0], after }] })).toThrow("文字不完整");
  });
  it("keeps long predecessor identity bounded and invalidates its successor after a detailed visual edit", async () => {
    const input = fixture();
    const { storyboard } = await generateClipStoryboard(input, { env, fetchImpl: fetchForParts() });
    const track = input.project.timeline.tracks.find(track => track.track_type === "voice")!;
    const current = track.clips[0]; current.duration = 600;
    storyboard.duration = 600; storyboard.sourceFingerprint = createClipVideoSourceFingerprint(input.project, current.id);
    storyboard.parts = Array.from({ length: 120 }, () => ({ ...structuredClone(storyboard.parts![0]), visual: "The same quiet room and wooden box. ".repeat(20), action: "Continue the existing gentle contact. ".repeat(12) }));
    input.project.videoPlan!.shots[current.id] = storyboard;
    const next = { ...structuredClone(current), id: "after_long", start: 600, duration: 4, text: "放下木盒，保持安静。" };
    track.clips.push(next);
    const fingerprint = getPreviousClipPromptFingerprint(input.project, next.id)!;
    expect(fingerprint.length).toBeLessThan(100);
    const successor = ClipVideoStoryboardSchema.parse({ ...storyboard, clipId: next.id, duration: 4, parts: undefined,
      sourceFingerprint: createClipVideoSourceFingerprint(input.project, next.id), previousClipId: current.id,
      previousPromptFingerprint: fingerprint, referenceMode: "continuous" });
    input.project.videoPlan!.shots[next.id] = successor;
    expect(isClipVideoStoryboardCurrent(input.project, next.id)).toBe(true);
    storyboard.parts[119].action = "Gently stop tapping with the same box still held.";
    expect(getPreviousClipPromptFingerprint(input.project, next.id)).not.toBe(fingerprint);
    expect(isClipVideoStoryboardCurrent(input.project, next.id)).toBe(false);
  });
});
