import { describe, expect, it } from "vitest";

import { writePcm16MonoWav } from "./procedural-audio";
import { writePcm16StereoWav } from "./project-mix-renderer";
import { analyzePcmWav } from "./audio-analysis";

describe("audio analysis", () => {
  it("extracts normalized peak bars and technical stereo metrics", () => {
    const wav = writePcm16StereoWav(
      new Float32Array([0, 0, 0.5, -0.5, 1, -1, 0.25, -0.25]),
      4,
    );

    const analysis = analyzePcmWav(wav, 2);

    expect(analysis.bars).toHaveLength(2);
    expect(analysis.bars[0]).toBeCloseTo(50, 0);
    expect(analysis.bars[1]).toBe(100);
    expect(analysis.duration).toBe(1);
    expect(analysis.sampleRate).toBe(4);
    expect(analysis.channels).toBe(2);
    expect(analysis.peakDbfs).toBeCloseTo(0, 3);
    expect(analysis.rmsDbfs).toBeCloseTo(-4.84, 1);
    expect(analysis.clippedSampleCount).toBe(2);
  });

  it("returns zero bars and null decibels for silence", () => {
    const wav = writePcm16MonoWav(new Float32Array(32), 32);

    const analysis = analyzePcmWav(wav, 8);

    expect(analysis.bars).toEqual(new Array(8).fill(0));
    expect(analysis.duration).toBe(1);
    expect(analysis.channels).toBe(1);
    expect(analysis.peakDbfs).toBeNull();
    expect(analysis.rmsDbfs).toBeNull();
    expect(analysis.clippedSampleCount).toBe(0);
  });

  it("keeps the requested bar count when audio has fewer frames", () => {
    const wav = writePcm16MonoWav(new Float32Array([0.25, 0.5]), 2);

    expect(analyzePcmWav(wav, 16).bars).toHaveLength(16);
  });

  it("does not classify near-full-scale samples as clipped", () => {
    const wav = writePcm16MonoWav(new Float32Array([0.99995, -0.99995]), 2);

    const analysis = analyzePcmWav(wav, 16);

    expect(analysis.peakDbfs).toBeGreaterThan(-0.01);
    expect(analysis.clippedSampleCount).toBe(0);
  });
});
