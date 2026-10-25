import { describe, expect, it } from "vitest";
import { postProcessingProject } from "../../components/studio/audio-post-processing-test-fixture";
import { createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint, isClipVideoStoryboardCurrent } from "./video-plan";
import { applyStoryboardReview, getStoryboardReviewFingerprint, getStoryboardReviewSummary, pickStoryboardReviewFields, StoryboardReviewSchema } from "./storyboard-review";

function fixture() {
  const project = postProcessingProject(), clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
  const second = project.videoPlan!.shots[clips[1].id];
  second.referenceMode = "continuous"; second.previousClipId = clips[0].id;
  second.previousPromptFingerprint = getPreviousClipPromptFingerprint(project, clips[1].id)!;
  const before = pickStoryboardReviewFields(project.videoPlan!.shots[clips[0].id]);
  return { project, clips, review: { inputFingerprint: getStoryboardReviewFingerprint(project), changes: [{ clipId: clips[0].id, reason: "接过外套后保留明确持物状态", before, after: { ...before, action: "S1 takes the coat and holds it in one hand." } }], notes: [] } };
}

describe("storyboard review domain", () => {
  it("requires all adopted sources and complete current shots", () => {
    const { project, clips } = fixture(); expect(getStoryboardReviewSummary(project)).toMatchObject({ ready: true, total: 2 });
    project.videoPlan!.shots[clips[0].id].action = "";
    expect(getStoryboardReviewSummary(project).ready).toBe(false);
    const other = fixture(); other.clips[0].audio_stale = true;
    expect(getStoryboardReviewSummary(other.project).ready).toBe(false);
  });
  it("binds actual script, source, scene, shot and workspace while ignoring timing, DSP and results", () => {
    const { project, clips } = fixture(), fp = getStoryboardReviewFingerprint(project);
    clips[0].start += .25; clips[0].duration += .5; clips[0].pause_after = 99; clips[0].position.pan = -.5;
    clips[0].volume_db -= 1; project.exports = []; project.timeline.mixing.binaural = false;
    expect(getStoryboardReviewFingerprint(project)).toBe(fp);
    project.videoPlan!.shots[clips[0].id].action += " Changed.";
    expect(getStoryboardReviewFingerprint(project)).not.toBe(fp);
    expect(fp.length).toBeLessThan(80);
  });
  it("atomically changes only requested text and rebinds the originally current downstream chain", () => {
    const { project, clips, review } = fixture(), original = structuredClone(project);
    const updated = applyStoryboardReview(project, review);
    expect(updated.videoPlan!.shots[clips[0].id].action).toBe(review.changes[0].after.action);
    expect(updated.videoPlan!.shots[clips[0].id].audio).toEqual(original.videoPlan!.shots[clips[0].id].audio);
    expect(updated.videoPlan!.shots[clips[1].id].referenceMode).toBe("continuous");
    expect(updated.videoPlan!.shots[clips[1].id].previousPromptFingerprint).not.toBe(original.videoPlan!.shots[clips[1].id].previousPromptFingerprint);
    expect(isClipVideoStoryboardCurrent(updated, clips[1].id)).toBe(true);
    expect(updated.timeline).toEqual(original.timeline); expect(project).toEqual(original);
    expect(updated.speechWorkspace!.short.videoPlan).toEqual(updated.videoPlan);
  });
  it("does not revive a previously stale downstream shot", () => {
    const { project, clips, review } = fixture(); project.videoPlan!.shots[clips[1].id].previousPromptFingerprint = "old-stale";
    review.inputFingerprint = getStoryboardReviewFingerprint(project);
    const updated = applyStoryboardReview(project, review);
    expect(updated.videoPlan!.shots[clips[1].id].previousPromptFingerprint).toBe("old-stale");
    expect(isClipVideoStoryboardCurrent(updated, clips[1].id)).toBe(false);
  });
  it("rebinds multiple changed predecessors without making the remaining current chain stale", () => {
    const { project, clips, review } = fixture(), third = { ...structuredClone(clips[1]), id: "third_shot", start: 6 };
    clips.push(third);
    project.videoPlan!.shots[third.id] = { ...structuredClone(project.videoPlan!.shots[clips[1].id]), clipId: third.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, third.id), previousClipId: clips[1].id,
      previousPromptFingerprint: getPreviousClipPromptFingerprint(project, third.id)! };
    const before = pickStoryboardReviewFields(project.videoPlan!.shots[clips[1].id]);
    review.changes.push({ clipId: clips[1].id, reason: "明确接续持物状态", before, after: { ...before, action: "S1 keeps the coat in one hand while indicating the slippers." } });
    review.inputFingerprint = getStoryboardReviewFingerprint(project);
    const previous = project.videoPlan!.shots[third.id].previousPromptFingerprint;
    const updated = applyStoryboardReview(project, review);
    for (const clip of clips) expect(isClipVideoStoryboardCurrent(updated, clip.id)).toBe(true);
    expect(updated.videoPlan!.shots[third.id].previousPromptFingerprint).not.toBe(previous);
  });
  it("rejects late reviews and inconsistent before snapshots without a partial mutation", () => {
    const { project, clips, review } = fixture(); clips[1].text += "已手改";
    const before = JSON.stringify(project); expect(() => applyStoryboardReview(project, review)).toThrow(); expect(JSON.stringify(project)).toBe(before);
    review.inputFingerprint = getStoryboardReviewFingerprint(project); review.changes[0].before.action = "not the current action";
    expect(() => applyStoryboardReview(project, review)).toThrow(); expect(JSON.stringify(project)).toBe(before);
  });
  it("supports a text-only inverse undo and rejects metadata or duplicate change injection", () => {
    const { project, review } = fixture(), updated = applyStoryboardReview(project, review);
    const restored = applyStoryboardReview(updated, { inputFingerprint: getStoryboardReviewFingerprint(updated), notes: [],
      changes: review.changes.map(change => ({ ...change, before: change.after, after: change.before })) });
    expect(restored.videoPlan).toEqual(project.videoPlan);
    expect(StoryboardReviewSchema.safeParse({ ...review, changes: [review.changes[0], review.changes[0]] }).success).toBe(false);
    expect(StoryboardReviewSchema.safeParse({ ...review, changes: [{ ...review.changes[0], after: { ...review.changes[0].after, audio: { uri: "other" } } }] }).success).toBe(false);
    expect(applyStoryboardReview(project, { ...review, changes: [], notes: ["无需修改"] })).toBe(project);
  });
  it("preserves old long editable notes for inverse undo and binds script/source/workspace identity", () => {
    const { project, clips, review } = fixture();
    project.videoPlan!.shots[clips[0].id].visual = "W".repeat(500);
    review.inputFingerprint = getStoryboardReviewFingerprint(project);
    review.changes[0].before = pickStoryboardReviewFields(project.videoPlan!.shots[clips[0].id]);
    const updated = applyStoryboardReview(project, review);
    const restored = applyStoryboardReview(updated, { inputFingerprint: getStoryboardReviewFingerprint(updated), notes: [],
      changes: review.changes.map(change => ({ ...change, before: change.after, after: change.before })) });
    expect(restored.videoPlan!.shots[clips[0].id].visual).toHaveLength(500);
    for (const edit of ["source", "scene", "order", "workspace"] as const) {
      const other = structuredClone(updated), fp = getStoryboardReviewFingerprint(other);
      const voices = other.timeline.tracks.find(track => track.track_type === "voice")!.clips;
      if (edit === "source") voices[0].asset.asset_id = "changed-source";
      if (edit === "scene") other.scene.name += "别处";
      if (edit === "order") voices.reverse();
      if (edit === "workspace") other.speechWorkspace!.activeMode = "paragraph";
      expect(getStoryboardReviewFingerprint(other)).not.toBe(fp);
    }
  });
  it("requires short current silent shots and keeps their source duration and audio absence", () => {
    const { project, clips } = fixture(), clip = clips[1]; clip.kind = "silent"; clip.duration = 2; clip.text = "放好外套走回炉边";
    const old = project.videoPlan!.shots[clip.id];
    project.videoPlan!.shots[clip.id] = { version: 1, promptFormat: "minimax-h3", kind: "silent", duration: 2, clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id), title: old.title, visual: old.visual, action: old.action, camera: old.camera,
      ambientSound: "Soft room tone", referenceMode: "new" };
    expect(getStoryboardReviewSummary(project).ready).toBe(true);
    const before = pickStoryboardReviewFields(project.videoPlan!.shots[clip.id]);
    const result = applyStoryboardReview(project, { inputFingerprint: getStoryboardReviewFingerprint(project), notes: [],
      changes: [{ clipId: clip.id, reason: "说明外套放下后的状态", before, after: { ...before, action: "S1 hangs the coat beside the door." } }] });
    expect(result.videoPlan!.shots[clip.id]).toMatchObject({ kind: "silent", duration: 2, sourceFingerprint: project.videoPlan!.shots[clip.id].sourceFingerprint });
    expect(result.videoPlan!.shots[clip.id].audio).toBeUndefined();
    clip.duration = 6; expect(getStoryboardReviewSummary(project).ready).toBe(false);
  });
});
