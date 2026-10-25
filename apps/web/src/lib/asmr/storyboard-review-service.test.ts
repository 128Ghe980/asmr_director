import { describe, expect, it, vi } from "vitest";
import { postProcessingProject } from "../../components/studio/audio-post-processing-test-fixture";
import { generateStoryboardReview } from "./storyboard-review-service";
import { createClipVideoSourceFingerprint } from "./video-plan";
import type { StoryboardReviewFields } from "./storyboard-review";

const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "test-only", ASMR_PLANNER_API_MODEL: "mock-reviewer" };
function fixture() {
  const project = postProcessingProject(), ids = Object.keys(project.videoPlan!.shots);
  const output: { changes: { shotNumber: string; reason: string; after?: Partial<StoryboardReviewFields> }[]; notes: string[] } = {
    changes: [{ shotNumber: "001", reason: "明确外套交接结果", after: { action: "S1 takes the coat and holds it in one hand." } }], notes: ["后段是未来计划，不强制当场执行。"] };
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  return { project, ids, output, fetchImpl };
}
describe("one-batch storyboard review service", () => {
  it("calls configured API once for all script context but only patches editable members", async () => {
    const { project, ids, fetchImpl } = fixture(), before = JSON.stringify(project);
    const result = await generateStoryboardReview({ project, editableClipIds: [ids[0]] }, { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(result).toMatchObject({ provider: "api", model: "mock-reviewer" });
    expect(result.review.changes[0].before.action).toBe(project.videoPlan!.shots[ids[0]].action);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string), context = JSON.parse(body.messages[1].content);
    expect(context.shots.map((shot: { shotNumber: string }) => shot.shotNumber)).toEqual(["001", "002"]);
    expect(context.shots.every((shot: object) => !("clipId" in shot))).toBe(true);
    expect(context.shots.map((shot: { editable: boolean }) => shot.editable)).toEqual([true, false]);
    expect(body.messages[0].content).toContain("未来"); expect(body.messages[0].content).toContain("不强造动作");
    expect(body.messages[0].content).toContain("道具"); expect(body.max_tokens).toBe(8192);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("does not dispatch without targets and allows notes-only review without a content gate", async () => {
    const one = fixture(); const empty = await generateStoryboardReview({ project: one.project, editableClipIds: [] }, { env, fetchImpl: one.fetchImpl });
    expect(empty.review.changes).toEqual([]); expect(empty.review.notes.length).toBeGreaterThan(0); expect(one.fetchImpl).not.toHaveBeenCalled();
    one.output.changes = [];
    const notes = await generateStoryboardReview({ project: one.project, editableClipIds: [one.ids[0]] }, { env, fetchImpl: one.fetchImpl });
    expect(notes.review.notes).toEqual(one.output.notes); expect(notes.review.changes).toEqual([]);
  });
  it.each(["protected", "foreign", "duplicate", "metadata", "legacy_clip_id"])("rejects %s patches without modifying a project", async kind => {
    const { project, ids, output, fetchImpl } = fixture();
    if (kind === "protected") output.changes[0].shotNumber = "002";
    if (kind === "foreign") output.changes[0].shotNumber = "999";
    if (kind === "duplicate") output.changes.push(structuredClone(output.changes[0]));
    if (kind === "metadata") Object.assign(output.changes[0].after!, { duration: 99 });
    if (kind === "legacy_clip_id") Object.assign(output.changes[0], { clipId: ids[0] });
    const original = JSON.stringify(project);
    await expect(generateStoryboardReview({ project, editableClipIds: [ids[0]] }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(JSON.stringify(project)).toBe(original); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([["title", 121], ["visual", 801], ["action", 601], ["camera", 401], ["ambientSound", 601]] as const)("rejects %s beyond its storage bound without applying or retrying", async (field, length) => {
    const { project, ids, output, fetchImpl } = fixture(), original = JSON.stringify(project);
    output.changes[0].after = { [field]: "x".repeat(length) };
    await expect(generateStoryboardReview({ project, editableClipIds: [ids[0]] }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(JSON.stringify(project)).toBe(original); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(["title", "visual", "action", "camera"] as const)("rejects a blank trimmed %s patch", async field => {
    const { project, ids, output, fetchImpl } = fixture(); output.changes[0].after = { [field]: " \n " };
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(["audio", "sourceFingerprint", "referenceMode"])("rejects model-added %s metadata alongside valid long text", async field => {
    const { project, ids, output, fetchImpl } = fixture(), original = JSON.stringify(project);
    output.changes[0].after = { action: "A".repeat(198) };
    Object.assign(output.changes[0].after, { [field]: "forged" });
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(JSON.stringify(project)).toBe(original); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("rejects stale prerequisites, duplicate or foreign request targets before API and supports cancellation", async () => {
    const { project, ids, fetchImpl } = fixture();
    for (const targets of [[ids[0], ids[0]], ["foreign"]]) await expect(generateStoryboardReview({ project, editableClipIds: targets }, { env, fetchImpl })).rejects.toMatchObject({ status: 400 });
    project.videoPlan!.shots[ids[0]].action = "";
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl })).rejects.toMatchObject({ status: 409 });
    const controller = new AbortController(); controller.abort();
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("filters identical patches rather than presenting pretend edits", async () => {
    const { project, ids, output, fetchImpl } = fixture(); output.changes[0].after!.action = project.videoPlan!.shots[ids[0]].action;
    Object.assign(output.changes[0].after!, { ambientSound: "" });
    const result = await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    expect(result.review.changes).toEqual([]);
  });
  it("keeps array script order even when engineering starts differ and rejects a late changed snapshot", async () => {
    const { project, ids, fetchImpl } = fixture(), clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    clips[0].start = 6; clips[1].start = 0;
    await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(JSON.parse(body.messages[1].content).shots.map((shot: { shotNumber: string; text: string }) => [shot.shotNumber, shot.text])).toEqual([["001", clips[0].text], ["002", clips[1].text]]);
    const another = fixture(); another.fetchImpl.mockImplementation(async () => {
      another.project.videoPlan!.shots[another.ids[1]].camera = "Edited while waiting";
      return Response.json({ choices: [{ message: { content: JSON.stringify(another.output) } }] });
    });
    await expect(generateStoryboardReview({ project: another.project, editableClipIds: another.ids }, { env, fetchImpl: another.fetchImpl })).rejects.toMatchObject({ status: 409 });
  });
  it("gives explicit display order independent of legacy ID suffixes and returns patches in script order", async () => {
    const { project, ids, output, fetchImpl } = fixture(), clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    const old = ids[1], changed = "legacy_voice_026", shot = project.videoPlan!.shots[old];
    clips[1].id = changed; delete project.videoPlan!.shots[old];
    project.videoPlan!.shots[changed] = { ...shot, clipId: changed, title: "旧标题镜头999", sourceFingerprint: createClipVideoSourceFingerprint(project, changed) };
    output.changes.unshift({ shotNumber: "002", reason: "延续完成后的道具状态", after: { action: "S1 keeps the coat on the nearby hook." } });
    const result = await generateStoryboardReview({ project, editableClipIds: [changed, ids[0]] }, { env, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string), context = JSON.parse(body.messages[1].content);
    expect(context.shots.map((item: { order: number; shotNumber: string }) => ({ order: item.order, shotNumber: item.shotNumber })))
      .toEqual([{ order: 1, shotNumber: "001" }, { order: 2, shotNumber: "002" }]);
    expect(JSON.stringify(context)).not.toContain(changed);
    expect(result.review.changes.map(change => change.clipId)).toEqual([ids[0], changed]);
    expect(result.review.changes[1].before.title).toBe("旧标题镜头999");
    expect(result.review.changes[1].after.title).toBe("旧标题镜头999");
  });
  it("asks for actionable editable patches while preserving valid future-location gestures", async () => {
    const { project, ids, fetchImpl } = fixture();
    await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string), system = body.messages[0].content as string;
    expect(system).toContain("必须直接给出最小 changes 补丁");
    expect(system).toContain("notes 仅用于");
    expect(system).toContain("before 由服务器");
    expect(system).toContain("shotNumber 是补丁唯一键");
    expect(system).toContain("不得返回 clipId");
    expect(system).toContain("轻指厨房"); expect(system).toContain("看向窗户");
    expect(system).toContain("不得把这些合理动作一律改成泛化的微笑或点头");
    expect(system).toContain("不要求凑修改数量");
    expect(system).toContain("Visual 是开镜状态"); expect(system).toContain("Action 是本镜发生的事件及终态");
    expect(system).toContain("开镜已经持杯"); expect(system).toContain("下一镜 Visual");
    expect(system).toContain("无改条目完全省略");
    expect(JSON.stringify(body)).not.toContain("minimumChanges");
  });
  it("merges only sparse changed fields and preserves original long text instead of demanding copies", async () => {
    const { project, ids, fetchImpl } = fixture(), original = project.videoPlan!.shots[ids[0]];
    original.visual = "L".repeat(500);
    const result = await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    expect(result.review.changes[0].after).toEqual({ title: original.title, visual: original.visual,
      action: "S1 takes the coat and holds it in one hand.", camera: original.camera });
    const schema = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages[0].content as string;
    expect(schema).toContain("未改字段省略"); expect(schema).toContain("双手空出");
    expect(original.action).not.toBe(result.review.changes[0].after.action);
  });
  it("merges complete 337-character visual and 198-character action patches without copying unchanged fields", async () => {
    const { project, ids, output, fetchImpl } = fixture(), original = project.videoPlan!.shots[ids[0]], before = JSON.stringify(project);
    output.changes[0].after = { visual: "V".repeat(337), action: "A".repeat(198) };
    const result = await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    expect(result.review.changes[0]).toMatchObject({ clipId: ids[0], before: { visual: original.visual, action: original.action },
      after: { title: original.title, camera: original.camera, ...output.changes[0].after } });
    expect(JSON.stringify(project)).toBe(before); expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).messages[0].content).toContain("建议分别尽量控制在320/180/120字符内");
  });
  it.each([["visual", 800], ["action", 600], ["camera", 400]] as const)("merges a sparse %s patch at the storage boundary after trimming surrounding whitespace", async (field, length) => {
    const { project, ids, output, fetchImpl } = fixture(), original = project.videoPlan!.shots[ids[0]];
    original.visual = "V".repeat(500); original.action = "A".repeat(300); original.camera = "C".repeat(200);
    const before = JSON.stringify(project);
    const text = "x".repeat(length); output.changes[0].after = { [field]: ` \n${text} \n` };
    const result = await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    expect(result.review.changes[0].after).toEqual({ title: original.title, visual: original.visual, action: original.action, camera: original.camera, [field]: text });
    expect(result.review.changes[0].before[field]).toBe(original[field]);
    expect(project.videoPlan!.shots[ids[0]]).toBe(original); expect(JSON.stringify(project)).toBe(before);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(["000", "025", "1", "legacy_voice_026"])("rejects unknown or malformed model shot key %s without guessing an ID", async shotNumber => {
    const { project, ids, output, fetchImpl } = fixture(); output.changes[0].shotNumber = shotNumber;
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([undefined, {}])("ignores a no-change entry with after=%j", async after => {
    const { project, ids, output, fetchImpl } = fixture(); output.changes[0].after = after;
    const result = await generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl });
    expect(result.review.changes).toEqual([]);
  });
  it("retains valid patches while ignoring protected and duplicate-key no-op entries", async () => {
    const { project, ids, output, fetchImpl } = fixture();
    output.changes.push({ shotNumber: "002", reason: "无需修改" }, { shotNumber: "001", reason: "无需修改", after: {} });
    const result = await generateStoryboardReview({ project, editableClipIds: [ids[0]] }, { env, fetchImpl });
    expect(result.review.changes.map(change => change.clipId)).toEqual([ids[0]]);
    expect(result.review.changes[0].after.action).toBe(output.changes[0].after!.action);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("still rejects unknown fields on a no-op before filtering any proposals", async () => {
    const { project, ids, output, fetchImpl } = fixture();
    const noOp = { shotNumber: "002", reason: "无需修改", audio: "injected.wav" };
    output.changes.push(noOp);
    await expect(generateStoryboardReview({ project, editableClipIds: ids }, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
  });
});
