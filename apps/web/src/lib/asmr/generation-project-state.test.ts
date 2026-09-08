import { describe, expect, it } from "vitest";

import type { GeneratedAssetResult } from "./generation-bridge";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
import { decodePcmWav, renderProjectMixWav, writePcm16StereoWav } from "./project-mix-renderer";
import { AsmrProjectSchema, type AsmrProject, type TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

const asset: GeneratedAssetResult = {
  assetId: "mock_voice_001_job_1",
  uri: "mock://asset/voice_001/job_1",
  duration: 7.5,
};

describe("generation project state", () => {
  it("commits successful generation asset metadata without mutating the original project", () => {
    const project = cloneProject();
    const updated = commitGenerationSuccess(project, "voice_001", asset);
    const originalClip = findClip(project, "voice_001");
    const updatedClip = findClip(updated, "voice_001");

    expect(updated).not.toBe(project);
    expect(originalClip.generation.status).toBe("asset_pending");
    expect(originalClip.asset.uri).toBeNull();
    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset).toEqual({
      asset_id: asset.assetId,
      uri: asset.uri,
      duration: asset.duration,
    });
  });

  it("commits normal generation failure as a durable failed state", () => {
    const project = cloneProject();
    const updated = commitGenerationFailure(project, "voice_001", {
      reason: "generate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(updated, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_failed");
    expect(updatedClip.generation.error).toBe("Mock generation failed");
    expect(updatedClip.asset).toEqual({
      asset_id: null,
      uri: null,
      duration: null,
    });
  });

  it("preserves a previous generated asset when regeneration fails", () => {
    const generated = commitGenerationSuccess(
      cloneProject(),
      "voice_001",
      asset,
    );
    const failedRegeneration = commitGenerationFailure(generated, "voice_001", {
      reason: "regenerate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(failedRegeneration, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset.uri).toBe(asset.uri);
  });

  it("returns the same project when the clip is missing", () => {
    const project = cloneProject();

    expect(commitGenerationSuccess(project, "missing", asset)).toBe(project);
    expect(commitGenerationSuccess(project, "missing", asset, { fitVoiceTiming: true }))
      .toBe(project);
    expect(
      commitGenerationFailure(project, "missing", {
        reason: "generate",
        error: "Missing",
      }),
    ).toBe(project);
  });

  it("keeps existing project timing unless voice fitting is enabled", () => {
    const project = cloneProject();
    const updated = commitGenerationSuccess(project, "voice_001", { ...asset, duration: 12 });

    expect(findClip(updated, "voice_001").duration).toBe(7.5);
    expect(findClip(updated, "voice_002").start).toBe(58);
    expect(updated.duration).toBe(project.duration);
  });

  it("fits a longer voice and shifts later tracks while preserving natural pauses", () => {
    const project = cloneProject();
    const voice = findClip(project, "voice_001");
    const boundary = voice.start + voice.duration;
    findClip(project, "breath_001").start = boundary;
    findClip(project, "sfx_blanket_001").start = boundary - 1;
    project.emotion_curve = [
      { start: 0, end: boundary, emotion: "intro" },
      { start: boundary, end: 100, emotion: "middle" },
      { start: 100, end: 210, emotion: "outro" },
    ];
    const updated = commitGenerationSuccess(project, "voice_001", { ...asset, duration: 12 }, {
      fitVoiceTiming: true,
    });

    expect(findClip(updated, "voice_001").duration).toBe(12);
    expect(findClip(updated, "voice_001").start).toBe(voice.start);
    expect(findClip(updated, "voice_002").start).toBe(62.5);
    expect(findClip(updated, "breath_001").start).toBe(boundary + 4.5);
    expect(findClip(updated, "sfx_blanket_001").start).toBe(boundary - 1);
    expect(findClip(updated, "sfx_blanket_001").duration).toBe(3.4);
    expect(findClip(updated, "ambience_rain_001").duration).toBe(214.5);
    expect(updated.duration).toBe(214.5);
    expect(updated.emotion_curve).toEqual([
      { start: 0, end: boundary + 4.5, emotion: "intro" },
      { start: boundary + 4.5, end: 104.5, emotion: "middle" },
      { start: 104.5, end: 214.5, emotion: "outro" },
    ]);
    expect(AsmrProjectSchema.safeParse(updated).success).toBe(true);
    expect(voice.duration).toBe(7.5);
    expect(project.duration).toBe(210);
  });

  it("preserves planned space for shorter takes and applies regeneration growth only once", () => {
    const project = cloneProject();
    const options = { fitVoiceTiming: true };
    const shorter = commitGenerationSuccess(project, "voice_001", { ...asset, duration: 5 }, options);
    const first = commitGenerationSuccess(shorter, "voice_001", { ...asset, duration: 12 }, options);
    const same = commitGenerationSuccess(first, "voice_001", { ...asset, duration: 12 }, options);
    const longer = commitGenerationSuccess(same, "voice_001", { ...asset, duration: 13 }, options);

    expect(findClip(shorter, "voice_001").duration).toBe(7.5);
    expect(shorter.duration).toBe(210);
    expect(same.duration).toBe(first.duration);
    expect(findClip(same, "voice_002").start).toBe(62.5);
    expect(longer.duration).toBe(215.5);
    expect(findClip(longer, "voice_002").start).toBe(63.5);
    expect(AsmrProjectSchema.safeParse(longer).success).toBe(true);
  });

  it("keeps the voice audio after its estimated end audible in the project mix", async () => {
    const project = cloneProject();
    const voice = findClip(project, "voice_001");
    if (voice.type !== "voice") throw new Error("Expected voice");
    Object.assign(voice, { start: 0, duration: 0.5, volume_db: 0, fade_in: 0, fade_out: 0 });
    project.duration = 1;
    project.emotion_curve = [{ start: 0, end: 1, emotion: "gentle" }];
    project.timeline.tracks = [
      { track_type: "voice", clips: [voice] },
      { track_type: "breath", clips: [] },
      { track_type: "sfx", clips: [] },
      { track_type: "ambience", clips: [] },
      { track_type: "post_processing", clips: [] },
    ];
    const updated = commitGenerationSuccess(project, voice.id, {
      ...asset,
      uri: "asset://clip/voice_001_generated",
      duration: 1.25,
    }, {
      fitVoiceTiming: true,
    });
    const samples = new Float32Array(8000 * 1.25 * 2);
    samples.fill(0.15, 8000 * 0.5 * 2);
    const mixed = decodePcmWav(await renderProjectMixWav({
      project: updated,
      sampleRate: 8000,
      loadClipAsset: async () => writePcm16StereoWav(samples, 8000),
    }));

    expect(mixed.samples.length / mixed.channels / mixed.sampleRate).toBe(1.75);
    expect(Math.abs(mixed.samples[8000 * 0.9 * 2])).toBeGreaterThan(0.001);
    expect(AsmrProjectSchema.safeParse(updated).success).toBe(true);
  });

  it("fits only voice clips and extends only looping ambience that covers the insertion", () => {
    const project = cloneProject();
    const ambience = findClip(project, "ambience_rain_001");
    if (ambience.type !== "ambience") throw new Error("Expected ambience");
    ambience.loop = false;
    const updated = commitGenerationSuccess(project, "voice_001", { ...asset, duration: 12 }, {
      fitVoiceTiming: true,
    });
    const nonVoice = commitGenerationSuccess(project, "breath_001", { ...asset, duration: 12 }, {
      fitVoiceTiming: true,
    });

    expect(findClip(updated, "ambience_rain_001").duration).toBe(210);
    expect(nonVoice.duration).toBe(210);
    expect(findClip(nonVoice, "breath_001").duration).toBe(2.4);
  });

  it("maps boundary ambience and crossing emotions without stretching earlier sounds", () => {
    const project = cloneProject();
    const voice = findClip(project, "voice_001");
    const boundary = voice.start + voice.duration;
    const track = project.timeline.tracks.find((track) => track.track_type === "ambience");
    if (!track || track.track_type !== "ambience") throw new Error("Expected ambience track");
    const source = track.clips[0];
    track.clips = [
      { ...source, id: "before", duration: boundary - 1 },
      { ...source, id: "ending", duration: boundary },
      { ...source, id: "after", start: boundary, duration: 2 },
    ];
    project.emotion_curve = [
      { start: 0, end: 10, emotion: "before" },
      { start: 10, end: 100, emotion: "crossing" },
      { start: 100, end: 210, emotion: "after" },
    ];

    const updated = commitGenerationSuccess(project, "voice_001", { ...asset, duration: 12 }, {
      fitVoiceTiming: true,
    });
    expect(findClip(updated, "before").duration).toBe(boundary - 1);
    expect(findClip(updated, "ending").duration).toBe(boundary + 4.5);
    expect(findClip(updated, "after").start).toBe(boundary + 4.5);
    expect(findClip(updated, "after").duration).toBe(2);
    expect(updated.emotion_curve).toEqual([
      { start: 0, end: 10, emotion: "before" },
      { start: 10, end: 104.5, emotion: "crossing" },
      { start: 104.5, end: 214.5, emotion: "after" },
    ]);
    const failed = commitGenerationFailure(updated, "voice_001", {
      reason: "regenerate",
      error: "Provider failed",
    });
    expect(failed.duration).toBe(updated.duration);
    expect(failed.timeline).toEqual(updated.timeline);
    expect(AsmrProjectSchema.safeParse(failed).success).toBe(true);
  });

  it.each([NaN, Infinity, 0, -1])("rejects invalid voice duration %s without modifying the project", (duration) => {
    const project = cloneProject();

    expect(() => commitGenerationSuccess(project, "voice_001", { ...asset, duration }, {
      fitVoiceTiming: true,
    })).toThrow(/duration/i);
    expect(findClip(project, "voice_001").asset.uri).toBeNull();
    expect(project.duration).toBe(210);
  });
});
