import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  applyDirectorPreset,
  type DirectorPreset,
} from "./director-presets";
import { updateClipInProject } from "./edit-project";
import type { AsmrProject, TimelineClip } from "./schema";

function getClip(project: AsmrProject, clipId: string): TimelineClip {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);

    if (clip) {
      return clip;
    }
  }

  throw new Error(`Missing clip ${clipId}`);
}

function apply(preset: DirectorPreset, clipId = "voice_002") {
  return applyDirectorPreset(demoProject, clipId, preset);
}

describe("director presets", () => {
  it("moves only the target voice clip closer", () => {
    const updated = apply("closer", "voice_002");
    const originalFirstVoice = getClip(demoProject, "voice_001");
    const updatedFirstVoice = getClip(updated, "voice_001");
    const updatedTarget = getClip(updated, "voice_002");

    expect(updatedTarget.position.distance).toBe("very_close");
    expect(updatedTarget.position.movement).toBe("static");
    expect(updatedTarget.volume_db).toBe(-14);
    expect(updatedFirstVoice.position).toEqual(originalFirstVoice.position);
    expect(updated).not.toBe(demoProject);
  });

  it("sets left and right ear pan values inside the schema range", () => {
    const left = getClip(apply("left-ear"), "voice_002");
    const right = getClip(apply("right-ear"), "voice_002");

    expect(left.position.pan).toBeLessThan(0);
    expect(left.position.pan).toBeGreaterThanOrEqual(-1);
    expect(left.position.distance).toBe("very_close");
    expect(right.position.pan).toBeGreaterThan(0);
    expect(right.position.pan).toBeLessThanOrEqual(1);
    expect(right.position.distance).toBe("very_close");
    expect(Math.abs(left.position.pan)).toBe(Math.abs(right.position.pan));
  });

  it("makes a voice clip softer without radical spatial changes", () => {
    const updated = getClip(apply("softer"), "voice_002");

    expect(updated.emotion).toBe("gentle");
    expect(updated.style).toBe("soft whisper");
    expect(updated.pace).toBe("slow");
    expect(updated.volume_db).toBe(-15);
    expect(updated.position.pan).toBe(0.08);
  });

  it("lowers volume and clamps at the lower schema bound", () => {
    const quietProject = updateClipInProject(demoProject, "voice_002", {
      volume_db: -79,
    });
    const updated = applyDirectorPreset(quietProject, "voice_002", "quieter");
    const updatedTarget = getClip(updated, "voice_002");

    expect(updatedTarget.volume_db).toBe(-80);
  });

  it("adds a pause marker without extending beyond project duration", () => {
    const nearEndProject = updateClipInProject(demoProject, "voice_004", {
      start: 204,
      duration: 6,
    });
    const updated = applyDirectorPreset(nearEndProject, "voice_004", "add-pause");
    const updatedTarget = getClip(updated, "voice_004");

    expect(updatedTarget.text.endsWith(" ...")).toBe(true);
    expect(updatedTarget.duration).toBe(6);
  });

  it("returns the same project when the target clip is missing", () => {
    const updated = applyDirectorPreset(demoProject, "missing_clip", "closer");

    expect(updated).toBe(demoProject);
  });

  it("returns the same project when the target clip is not a voice clip", () => {
    const updated = applyDirectorPreset(demoProject, "breath_001", "closer");

    expect(updated).toBe(demoProject);
  });

  it("does not mutate the original project", () => {
    const originalTarget = getClip(demoProject, "voice_002");
    const updated = apply("right-ear", "voice_002");
    const updatedTarget = getClip(updated, "voice_002");

    expect(originalTarget.position.pan).toBe(0.08);
    expect(updatedTarget.position.pan).not.toBe(originalTarget.position.pan);
  });
});
