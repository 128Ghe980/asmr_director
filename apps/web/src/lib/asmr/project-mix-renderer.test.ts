import { describe, expect, it } from "vitest";

import {
  decodePcmWav,
  renderProjectMixWav,
  writePcm16StereoWav,
} from "./project-mix-renderer";
import { demoProject } from "./mock-project";
import { writePcm16MonoWav } from "./procedural-audio";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

function makeConstantStereoWav({
  duration,
  sampleRate,
  amplitude,
}: {
  duration: number;
  sampleRate: number;
  amplitude: number;
}): Uint8Array {
  const samples = new Float32Array(duration * sampleRate * 2);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude;
  }

  return writePcm16StereoWav(samples, sampleRate);
}

function makeTracksWithSingleClip(
  clip: TimelineClip,
): AsmrProject["timeline"]["tracks"] {
  switch (clip.track) {
    case "voice":
      return [
        { track_type: "voice", clips: [clip] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "breath":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [clip] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "sfx":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [clip] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "ambience":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [clip] },
        { track_type: "post_processing", clips: [] },
      ];
  }
}

function makeSingleClipProject(
  clipUpdate: (clip: TimelineClip) => TimelineClip,
  clipId = "voice_001",
): AsmrProject {
  const sourceClip = findClip(demoProject, clipId);
  const clip = clipUpdate(structuredClone(sourceClip));

  return {
    ...structuredClone(demoProject),
    duration: 2,
    timeline: {
      ...structuredClone(demoProject.timeline),
      mixing: {
        target_lufs: -18,
        binaural: true,
        master_limiter: false,
      },
      tracks: makeTracksWithSingleClip(clip),
    },
  };
}

function peak(samples: Float32Array): number {
  let max = 0;

  for (const sample of samples) {
    max = Math.max(max, Math.abs(sample));
  }

  return max;
}

function channelPeak(samples: Float32Array, channelIndex: 0 | 1): number {
  let max = 0;

  for (let index = channelIndex; index < samples.length; index += 2) {
    max = Math.max(max, Math.abs(samples[index]));
  }

  return max;
}

describe("project mix renderer", () => {
  it("decodes stereo PCM samples written by the WAV encoder", () => {
    const samples = new Float32Array([
      0,
      0,
      0.5,
      -0.5,
      1,
      -1,
      -0.25,
      0.25,
    ]);
    const wav = writePcm16StereoWav(samples, 32000);
    const decoded = decodePcmWav(wav);

    expect(decoded.sampleRate).toBe(32000);
    expect(decoded.channels).toBe(2);
    expect(decoded.samples).toHaveLength(samples.length);
    expect(decoded.samples[2]).toBeCloseTo(0.5, 3);
    expect(decoded.samples[3]).toBeCloseTo(-0.5, 3);
  });

  it("rejects malformed WAV bytes", () => {
    const bytes = new TextEncoder().encode("not a wav");

    expect(() => decodePcmWav(bytes)).toThrow("Invalid WAV");
  });

  it("places generated clip audio at its timeline start", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 1,
      duration: 1,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      generation: {
        ...clip.generation,
        status: "asset_generated",
      },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = makeConstantStereoWav({
      duration: 1,
      sampleRate,
      amplitude: 0.5,
    });

    const wav = await renderProjectMixWav({
      project,
      sampleRate,
      loadClipAsset: async () => source,
    });
    const decoded = decodePcmWav(wav);
    const firstSecond = decoded.samples.subarray(0, sampleRate * 2);
    const secondSecond = decoded.samples.subarray(sampleRate * 2);

    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.channels).toBe(2);
    expect(peak(firstSecond)).toBeLessThan(0.001);
    expect(peak(secondSecond)).toBeGreaterThan(0.2);
  });

  it("applies clip volume in dB", async () => {
    const sampleRate = 1000;
    const loudProject = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const quietProject = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: -6,
      fade_in: 0,
      fade_out: 0,
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = makeConstantStereoWav({
      duration: 1,
      sampleRate,
      amplitude: 0.8,
    });
    const loud = decodePcmWav(
      await renderProjectMixWav({
        project: loudProject,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );
    const quiet = decodePcmWav(
      await renderProjectMixWav({
        project: quietProject,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );

    expect(peak(quiet.samples)).toBeLessThan(peak(loud.samples) * 0.55);
  });

  it("applies fade in envelopes", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 0,
      fade_in: 0.5,
      fade_out: 0,
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = makeConstantStereoWav({
      duration: 1,
      sampleRate,
      amplitude: 0.8,
    });
    const decoded = decodePcmWav(
      await renderProjectMixWav({
        project,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );
    const firstTenth = decoded.samples.subarray(0, sampleRate * 0.1 * 2);
    const lateTenth = decoded.samples.subarray(
      sampleRate * 0.7 * 2,
      sampleRate * 0.8 * 2,
    );

    expect(peak(firstTenth)).toBeLessThan(peak(lateTenth) * 0.4);
  });

  it("applies equal-power pan to mono sources", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      position: {
        ...clip.position,
        pan: -1,
      },
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = writePcm16MonoWav(new Float32Array(sampleRate).fill(0.8), sampleRate);
    const decoded = decodePcmWav(
      await renderProjectMixWav({
        project,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );

    expect(channelPeak(decoded.samples, 0)).toBeGreaterThan(
      channelPeak(decoded.samples, 1) * 3,
    );
  });

  it("loops ambience sources shorter than the target clip duration", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => {
      if (clip.type !== "ambience") {
        throw new Error("Expected ambience clip");
      }

      return {
        ...clip,
        start: 0,
        duration: 1,
        loop: true,
        volume_db: 0,
        fade_in: 0,
        fade_out: 0,
        generation: { ...clip.generation, status: "asset_generated" },
        asset: {
          asset_id: "ambience_rain_001_asset",
          uri: "asset://clip/ambience_rain_001_asset",
          duration: 0.25,
        },
      };
    }, "ambience_rain_001");
    const source = makeConstantStereoWav({
      duration: 0.25,
      sampleRate,
      amplitude: 0.7,
    });
    const decoded = decodePcmWav(
      await renderProjectMixWav({
        project,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );
    const finalQuarter = decoded.samples.subarray(
      sampleRate * 0.75 * 2,
      sampleRate * 2,
    );

    expect(peak(finalQuarter)).toBeGreaterThan(0.1);
  });

  it("raises very low-level mixes toward the project target loudness", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = makeConstantStereoWav({
      duration: 1,
      sampleRate,
      amplitude: 0.01,
    });
    const decoded = decodePcmWav(
      await renderProjectMixWav({
        project,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );

    expect(peak(decoded.samples)).toBeGreaterThan(0.03);
  });

  it("keeps limited output inside PCM sample bounds", async () => {
    const sampleRate = 1000;
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 12,
      fade_in: 0,
      fade_out: 0,
      generation: { ...clip.generation, status: "asset_generated" },
      asset: {
        asset_id: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      },
    }));
    const source = makeConstantStereoWav({
      duration: 1,
      sampleRate,
      amplitude: 0.9,
    });
    const limitedProject = {
      ...project,
      timeline: {
        ...project.timeline,
        mixing: {
          ...project.timeline.mixing,
          master_limiter: true,
        },
      },
    };
    const decoded = decodePcmWav(
      await renderProjectMixWav({
        project: limitedProject,
        sampleRate,
        loadClipAsset: async () => source,
      }),
    );

    expect(peak(decoded.samples)).toBeLessThanOrEqual(1);
  });

  it("mixes 32, 44.1 and 48 kHz sources at 48 kHz without changing placement or duration", async () => {
    const rates = [32000, 44100, 48000];
    const starts = [0.125, 0.625, 1.125];
    const template = findClip(demoProject, "voice_001");
    if (template.type !== "voice") throw new Error("Expected voice clip");
    const clips = rates.map((rate, index) => ({
      ...structuredClone(template),
      id: `voice_${rate}`,
      start: starts[index],
      duration: 0.4,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      position: { pan: 0, distance: "close" as const, movement: "static" as const },
      generation: { ...template.generation, status: "asset_generated" as const },
      asset: { asset_id: `asset_${rate}`, uri: `asset://clip/asset_${rate}`, duration: 0.25 },
    }));
    const project = makeSingleClipProject(() => clips[0]);
    project.timeline.tracks[0] = { track_type: "voice", clips };
    project.timeline.mixing.target_lufs = -60;
    const sources = new Map(rates.map((rate) => [
      `voice_${rate}`,
      writePcm16MonoWav(new Float32Array(rate / 4).fill(0.5), rate),
    ]));
    const decoded = decodePcmWav(await renderProjectMixWav({
      project,
      loadClipAsset: async (clip) => sources.get(clip.id)!,
    }));

    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.samples.length / decoded.channels / decoded.sampleRate).toBe(2);
    for (const start of starts) {
      const startFrame = Math.round(start * 48000);
      const endFrame = startFrame + 12000;
      expect(decoded.samples[(startFrame - 1) * 2]).toBe(0);
      expect(decoded.samples[startFrame * 2]).toBeCloseTo(0.5 / Math.sqrt(2), 4);
      expect(decoded.samples[(endFrame - 1) * 2]).toBeGreaterThan(0.3);
      expect(peak(decoded.samples.subarray(endFrame * 2, (endFrame + 6000) * 2))).toBe(0);
    }
  });

  it.each(["static", "left_to_right", "approach"] as const)(
    "preserves stereo phase and channel levels without applying %s spatialization again",
    async (movement) => {
      const project = makeSingleClipProject((clip) => ({
        ...clip,
        start: 0,
        duration: 1,
        volume_db: -6,
        fade_in: 0,
        fade_out: 0,
        position: { pan: -1, distance: "far", movement },
        generation: { ...clip.generation, status: "asset_generated" },
        asset: { asset_id: "stereo", uri: "asset://clip/stereo", duration: 1 },
      }));
      project.timeline.mixing.target_lufs = -60;
      const samples = new Float32Array(44100 * 2);
      for (let frame = 0; frame < 44100; frame++) {
        samples[frame * 2] = 0.6;
        samples[frame * 2 + 1] = -0.3;
      }
      const decoded = decodePcmWav(await renderProjectMixWav({
        project,
        loadClipAsset: async () => writePcm16StereoWav(samples, 44100),
      }));

      const gain = Math.pow(10, -6 / 20);
      for (const frame of [0, 12000, 47999]) {
        expect(decoded.samples[frame * 2]).toBeCloseTo(0.6 * gain, 4);
        expect(decoded.samples[frame * 2 + 1]).toBeCloseTo(-0.3 * gain, 4);
      }
      expect(peak(decoded.samples.subarray(48000 * 2))).toBe(0);
    },
  );

  it("keeps mono pan motion and distance gain after resampling", async () => {
    const project = makeSingleClipProject((clip) => ({
      ...clip,
      start: 0,
      duration: 1,
      volume_db: 0,
      fade_in: 0,
      fade_out: 0,
      position: { pan: 0, distance: "far", movement: "left_to_right" },
      generation: { ...clip.generation, status: "asset_generated" },
      asset: { asset_id: "mono", uri: "asset://clip/mono", duration: 1 },
    }));
    project.timeline.mixing.target_lufs = -60;
    const decoded = decodePcmWav(await renderProjectMixWav({
      project,
      loadClipAsset: async () => writePcm16MonoWav(new Float32Array(32000).fill(0.5), 32000),
    }));

    expect(decoded.samples[0]).toBeCloseTo(0.5 * 0.35, 4);
    expect(decoded.samples[1]).toBe(0);
    expect(decoded.samples[47999 * 2]).toBe(0);
    expect(decoded.samples[47999 * 2 + 1]).toBeCloseTo(0.5 * 0.35, 4);
    expect(decoded.samples[24000 * 2]).toBeCloseTo(0.5 * 0.35 / Math.sqrt(2), 4);
  });

  it("loops a resampled ambience source for the planned duration", async () => {
    const project = makeSingleClipProject((clip) => {
      if (clip.type !== "ambience") throw new Error("Expected ambience");
      return {
        ...clip,
        start: 0.5,
        duration: 1,
        loop: true,
        volume_db: 0,
        fade_in: 0,
        fade_out: 0,
        position: { pan: 0, distance: "close", movement: "static" },
        generation: { ...clip.generation, status: "asset_generated" },
        asset: { asset_id: "rain", uri: "asset://clip/rain", duration: 0.25 },
      };
    }, "ambience_rain_001");
    project.timeline.mixing.target_lufs = -60;
    const decoded = decodePcmWav(await renderProjectMixWav({
      project,
      loadClipAsset: async () => writePcm16MonoWav(new Float32Array(11025).fill(0.5), 44100),
    }));

    expect(decoded.samples[(24000 - 1) * 2]).toBe(0);
    for (const frame of [24000, 36000, 48000, 60000, 71999]) {
      expect(decoded.samples[frame * 2]).toBeCloseTo(0.5 / Math.sqrt(2), 4);
    }
    expect(peak(decoded.samples.subarray(72000 * 2))).toBe(0);
  });
});
