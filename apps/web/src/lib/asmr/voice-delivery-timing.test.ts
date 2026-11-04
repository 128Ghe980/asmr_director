import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { DEFAULT_SEGMENT_PAUSE_SECONDS, getOrderedVoiceClips, getSegmentPauseSeconds } from "./voice-delivery-timing";

function fixture() {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find(item => item.track_type === "voice")!;
  track.clips = track.clips.slice(0, 3);
  track.clips.forEach((clip, index) => {
    clip.start = index * 2; clip.duration = 2;
    clip.asset = { asset_id: null, uri: null, duration: null };
    delete clip.pause_after; delete clip.tail_pause_seconds;
  });
  return { project, clips: track.clips };
}

describe("delivered segment pauses", () => {
  it("orders only voice clips chronologically without mutating the project or source array", () => {
    const { project, clips } = fixture();
    clips.reverse();
    const before = structuredClone(project);
    const ordered = getOrderedVoiceClips(project);
    expect(ordered.map(clip => clip.id)).toEqual(["voice_001", "voice_002", "voice_003"]);
    expect(ordered).not.toBe(clips);
    expect(ordered[0]).toBe(clips[2]);
    expect(ordered.every(clip => clip.type === "voice")).toBe(true);
    expect(project).toEqual(before);
  });

  it("uses 0.35 seconds for an unset or old zero pause without writing a setting", () => {
    const { project, clips } = fixture();
    expect(DEFAULT_SEGMENT_PAUSE_SECONDS).toBe(.35);
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.35);
    clips[0].pause_after = 0;
    clips[1].start = 20; // An explicit legacy zero is not a timeline-gap request.
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.35);
    expect(clips[0].pause_after).toBe(0);
    expect(clips[0].tail_pause_seconds).toBeUndefined();
  });

  it("preserves a positive legacy pause and gives an explicit tail, including zero, priority", () => {
    const { project, clips } = fixture();
    clips[0].pause_after = .8;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.8);
    clips[0].tail_pause_seconds = 0;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(0);
    clips[0].tail_pause_seconds = 1.25;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(1.25);
    expect(clips[0].pause_after).toBe(.8);
  });

  it("derives an existing positive timeline gap from adopted audio duration before a silent segment", () => {
    const { project, clips } = fixture();
    clips[0].duration = 8;
    clips[0].asset = { asset_id: "adopted", uri: "asset://clip/adopted", duration: 1.5 };
    clips[1].kind = "silent";
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.5);
    clips[0].asset = { asset_id: null, uri: null, duration: 1.5 };
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.35);
    clips[0].duration = 1.75;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.25);
    clips[0].asset = { asset_id: "adopted", uri: "asset://clip/adopted", duration: 0 };
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.25);
  });

  it("does not infer extra silence from overlap or floating point noise", () => {
    const { project, clips } = fixture();
    clips[1].start = 2.0000001;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.35);
    clips[1].start = 1;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.35);
  });

  it("never adds a default to silent content but retains its explicit or already scheduled gap", () => {
    const { project, clips } = fixture();
    clips[0].kind = "silent";
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(0);
    clips[0].pause_after = 0;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(0);
    clips[0].pause_after = .4;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(.4);
    clips[0].tail_pause_seconds = 0;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBe(0);
    delete clips[0].tail_pause_seconds; delete clips[0].pause_after;
    clips[0].asset = { asset_id: "stale_voice", uri: "asset://clip/stale_voice", duration: .2 };
    clips[1].start = 2.6;
    expect(getSegmentPauseSeconds(project, clips[0].id)).toBeCloseTo(.6);
  });

  it("omits the final pause even when set, and treats missing or empty selections as no gap", () => {
    const { project, clips } = fixture();
    const last = clips[2];
    last.pause_after = 1; last.tail_pause_seconds = 2;
    expect(getSegmentPauseSeconds(project, last.id)).toBe(0);
    last.kind = "silent";
    expect(getSegmentPauseSeconds(project, last.id)).toBe(0);
    expect(getSegmentPauseSeconds(project, "missing")).toBe(0);
    project.timeline.tracks = project.timeline.tracks.filter(track => track.track_type !== "voice");
    expect(getOrderedVoiceClips(project)).toEqual([]);
    expect(getSegmentPauseSeconds(project, last.id)).toBe(0);
  });
});
