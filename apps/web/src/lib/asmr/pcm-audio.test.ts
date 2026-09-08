import { describe, expect, it } from "vitest";

import { decodePcmWav, normalizePcmAudio, writePcm16StereoWav } from "./pcm-audio";

describe("PCM rate conversion", () => {
  it.each([32000, 44100, 48000])("preserves duration and source channels at %i Hz", (sampleRate) => {
    const audio = {
      sampleRate,
      channels: 1 as const,
      samples: new Float32Array(sampleRate / 4).fill(0.2),
    };
    const result = normalizePcmAudio(audio);
    expect(result.sampleRate).toBe(48000);
    expect(result.channels).toBe(1);
    expect(result.samples).toHaveLength(12000);
    expect(result.samples[0]).toBeCloseTo(0.2);
    expect(result.samples.at(-1)).toBeCloseTo(0.2);
  });

  it("interpolates left and right independently, keeping opposite phase intact", () => {
    const source = new Float32Array([0, 0, 0.6, -0.3, 0, 0, -0.6, 0.3]);
    const audio = { sampleRate: 32000, channels: 2 as const, samples: source };
    const result = normalizePcmAudio(audio);
    expect(result.channels).toBe(2);
    expect(result.samples).toHaveLength(12);
    expect(result.samples[2]).toBeCloseTo(0.4);
    expect(result.samples[3]).toBeCloseTo(-0.2);
    expect(source).toEqual(new Float32Array([0, 0, 0.6, -0.3, 0, 0, -0.6, 0.3]));
  });

  it("preserves native-rate PCM samples exactly", () => {
    const audio = { sampleRate: 48000, channels: 2 as const, samples: new Float32Array([0.3, -0.7, 1, -1]) };
    expect(normalizePcmAudio(audio).samples).toEqual(audio.samples);
  });

  it("rejects invalid rates and incomplete frames before mixing", () => {
    const audio = { sampleRate: 32000, channels: 2 as const, samples: new Float32Array([0.3, 0.5]) };
    expect(() => normalizePcmAudio(audio, 0)).toThrow("sample rate");
    expect(() => normalizePcmAudio({ ...audio, sampleRate: 0 })).toThrow("sample rate");
    expect(() => normalizePcmAudio({ ...audio, samples: new Float32Array([0.3]) })).toThrow("complete frames");
  });

  it("rejects invalid WAV sample rates and partial stereo frames", () => {
    const zeroRate = writePcm16StereoWav(new Float32Array(2), 32000);
    new DataView(zeroRate.buffer).setUint32(24, 0, true);
    expect(() => decodePcmWav(zeroRate)).toThrow("sample rate");

    const partial = writePcm16StereoWav(new Float32Array(2), 32000).slice(0, 46);
    new DataView(partial.buffer).setUint32(4, 38, true);
    new DataView(partial.buffer).setUint32(40, 2, true);
    expect(() => decodePcmWav(partial)).toThrow("complete frames");
  });
});
