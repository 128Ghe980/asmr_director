import { describe, expect, it } from "vitest";
import { getAcceptedVoicePreviewPlan } from "./accepted-voice-preview";
import { demoProject } from "./mock-project";

function projectWithVoices() {
  const project = structuredClone(demoProject), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  const base = track.clips[0];
  track.clips = [0, 1, 2].map(index => ({ ...structuredClone(base), id: `voice_${index}`, text: `台词 ${index}`, start: index * 10,
    duration: 2, asset: { asset_id: `asset_${index}`, uri: `asset://clip/asset_${index}`, duration: 2 },
    generation: { ...base.generation, status: "asset_generated" } }));
  return project;
}
describe("accepted voice preview plan", () => {
  it("only selects current exact local voice references in stable start order", () => {
    const project = projectWithVoices(), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips[1].generation.status = "asset_pending";
    track.clips.reverse();
    const plan = getAcceptedVoicePreviewPlan(project);
    expect(plan.entries).toEqual([{ clipId: "voice_0", assetId: "asset_0", gapAfterSeconds: 8 }, { clipId: "voice_2", assetId: "asset_2", gapAfterSeconds: 0 }]);
    expect(plan).toMatchObject({ clipCount: 2, skippedCount: 1, totalVoiceCount: 3 });
  });
  it("does not include mock, inconsistent, failed or empty asset references", () => {
    const project = projectWithVoices(), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips[0].asset.uri = "mock://asset/demo";
    track.clips[1].asset.uri = "asset://clip/wrong";
    track.clips[2].generation.status = "asset_failed";
    expect(getAcceptedVoicePreviewPlan(project).clipCount).toBe(0);
    track.clips[2].generation.status = "asset_generated"; track.clips[2].asset.asset_id = ""; track.clips[2].asset.uri = "asset://clip/";
    expect(getAcceptedVoicePreviewPlan(project).clipCount).toBe(0);
  });
  it("prefers explicit pause and never adds trailing silence", () => {
    const project = projectWithVoices(), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips.forEach(clip => { clip.pause_after = .5; });
    expect(getAcceptedVoicePreviewPlan(project).entries.map(entry => entry.gapAfterSeconds)).toEqual([.5, .5, 0]);
  });
  it("fingerprints content, asset adoption, timing and order while ignoring space/DSP settings", () => {
    const project = projectWithVoices(), baseline = getAcceptedVoicePreviewPlan(project).fingerprint;
    project.timeline.mixing.binaural = !project.timeline.mixing.binaural;
    project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0].volume_db = -50;
    expect(getAcceptedVoicePreviewPlan(project).fingerprint).toBe(baseline);
    for (const change of ["text", "start", "asset", "pause"] as const) {
      const copy = structuredClone(project), clip = copy.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
      if (change === "text") clip.text += "改";
      if (change === "start") clip.start += 30;
      if (change === "asset") clip.asset.asset_id = "new";
      if (change === "pause") clip.pause_after = 1;
      expect(getAcceptedVoicePreviewPlan(copy).fingerprint).not.toBe(baseline);
    }
  });
  it("keeps equal-start ordering deterministic and filenames portable", () => {
    const project = projectWithVoices(), track = project.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips.forEach(clip => { clip.start = 0; }); project.title = "../NUL/<生日>";
    expect(getAcceptedVoicePreviewPlan(project).entries.map(entry => entry.clipId)).toEqual(["voice_0", "voice_1", "voice_2"]);
    expect(getAcceptedVoicePreviewPlan(project).filename).not.toMatch(/[<>/\\]/);
  });
});
