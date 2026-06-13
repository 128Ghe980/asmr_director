import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  getProjectValidationIssues,
  updateClipInProject,
} from "./edit-project";

describe("edit project helpers", () => {
  it("updates a voice clip without mutating the original project", () => {
    const updated = updateClipInProject(demoProject, "voice_001", {
      text: "今晚先把呼吸放慢一点，我会一直在这里。",
    });

    const originalVoiceTrack = demoProject.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );
    const updatedVoiceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );

    expect(originalVoiceTrack?.clips[0].text).toBe(
      "你还没睡吗？没关系，我陪你一会儿。",
    );
    expect(updatedVoiceTrack?.clips[0].text).toBe(
      "今晚先把呼吸放慢一点，我会一直在这里。",
    );
    expect(updated).not.toBe(demoProject);
    expect(updated.timeline.tracks[1]).toBe(demoProject.timeline.tracks[1]);
  });

  it("updates nested position fields for only the target clip", () => {
    const updated = updateClipInProject(demoProject, "voice_003", {
      position: {
        pan: -0.42,
        distance: "close",
        movement: "left_to_right",
      },
    });

    const updatedVoiceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );

    expect(updatedVoiceTrack?.clips[0].position.pan).toBe(-0.72);
    expect(updatedVoiceTrack?.clips[2].position).toEqual({
      pan: -0.42,
      distance: "close",
      movement: "left_to_right",
    });
  });

  it("returns the same project when the clip id does not exist", () => {
    const updated = updateClipInProject(demoProject, "missing_clip", {
      volume_db: -6,
    });

    expect(updated).toBe(demoProject);
  });

  it("reports validation issues for edits that exceed project duration", () => {
    const updated = updateClipInProject(demoProject, "voice_004", {
      start: 208,
      duration: 12,
    });

    const issues = getProjectValidationIssues(updated);

    expect(issues).toContainEqual({
      path: "timeline.tracks.0.clips.3.duration",
      message: "clip end must be within project duration",
    });
  });
});
