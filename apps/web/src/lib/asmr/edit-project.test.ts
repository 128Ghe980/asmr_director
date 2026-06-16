import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  getClipFieldValidationIssues,
  getProjectValidationIssues,
  nudgeClipTiming,
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

  it("nudges clip start by the requested delta", () => {
    const updated = nudgeClipTiming(demoProject, "voice_001", {
      field: "start",
      delta: 0.5,
    });

    const voiceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );

    expect(voiceTrack?.clips[0].start).toBe(16.5);
  });

  it("clamps nudged clip start at zero", () => {
    const updated = nudgeClipTiming(demoProject, "ambience_rain_001", {
      field: "start",
      delta: -0.5,
    });

    const ambienceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "ambience",
    );

    expect(ambienceTrack?.clips[0].start).toBe(0);
  });

  it("nudges clip duration by the requested delta", () => {
    const updated = nudgeClipTiming(demoProject, "voice_001", {
      field: "duration",
      delta: 0.5,
    });

    const voiceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );

    expect(voiceTrack?.clips[0].duration).toBe(8);
  });

  it("clamps nudged clip duration at the minimum editor step", () => {
    const shortened = updateClipInProject(demoProject, "voice_001", {
      duration: 0.2,
    });
    const updated = nudgeClipTiming(shortened, "voice_001", {
      field: "duration",
      delta: -0.5,
    });

    const voiceTrack = updated.timeline.tracks.find(
      (track) => track.track_type === "voice",
    );

    expect(voiceTrack?.clips[0].duration).toBe(0.1);
  });

  it("lets validation report nudges beyond project duration", () => {
    const updated = nudgeClipTiming(demoProject, "voice_004", {
      field: "duration",
      delta: 30,
    });

    const issues = getProjectValidationIssues(updated);
    const fieldIssues = getClipFieldValidationIssues(
      updated,
      "voice_004",
      issues,
    );

    expect(fieldIssues.duration).toEqual([
      {
        path: "timeline.tracks.0.clips.3.duration",
        message: "片段结束不能超过项目总时长",
      },
    ]);
  });

  it("returns the same project when nudging a missing clip", () => {
    const updated = nudgeClipTiming(demoProject, "missing_clip", {
      field: "start",
      delta: 0.5,
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
      message: "片段结束不能超过项目总时长",
    });
  });

  it("maps validation issues to fields on the selected clip", () => {
    const updated = updateClipInProject(demoProject, "voice_004", {
      start: 208,
      duration: 12,
    });

    const issues = getProjectValidationIssues(updated);
    const fieldIssues = getClipFieldValidationIssues(
      updated,
      "voice_004",
      issues,
    );

    expect(fieldIssues.duration).toEqual([
      {
        path: "timeline.tracks.0.clips.3.duration",
        message: "片段结束不能超过项目总时长",
      },
    ]);
  });

  it("ignores validation issues for other clips", () => {
    const updated = updateClipInProject(demoProject, "voice_004", {
      start: 208,
      duration: 12,
    });

    const issues = getProjectValidationIssues(updated);
    const fieldIssues = getClipFieldValidationIssues(
      updated,
      "voice_001",
      issues,
    );

    expect(fieldIssues).toEqual({});
  });

  it("maps nested position issues to nested field keys", () => {
    const updated = updateClipInProject(demoProject, "voice_001", {
      position: { pan: 1.4 },
    });

    const issues = getProjectValidationIssues(updated);
    const fieldIssues = getClipFieldValidationIssues(
      updated,
      "voice_001",
      issues,
    );

    expect(fieldIssues["position.pan"]).toEqual([
      {
        path: "timeline.tracks.0.clips.0.position.pan",
        message: "数值不能大于 1",
      },
    ]);
  });

  it("ignores unsupported paths for the selected clip", () => {
    const fieldIssues = getClipFieldValidationIssues(demoProject, "voice_001", [
      {
        path: "timeline.tracks.0.clips.0.generation.status",
        message: "unsupported status",
      },
      {
        path: "project",
        message: "project issue",
      },
    ]);

    expect(fieldIssues).toEqual({});
  });
});
