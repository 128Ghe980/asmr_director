import { describe, expect, it } from "vitest";

import { decodePcmWav, normalizePcmAudio, writePcm16StereoWav } from "./pcm-audio";

describe("PCM rate conversion", () => {
  it("decodes signed 24-bit stereo without swapping ears or losing low bits", () => {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    const put = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
    put(0, "RIFF"); put(8, "WAVEfmt "); put(36, "data");
    view.setUint32(4, 48, true); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 288000, true);
    view.setUint16(32, 6, true); view.setUint16(34, 24, true);
    view.setUint32(40, 12, true);
    [-8388608, -1, 0, 8388607].forEach((value, index) => {
      bytes[44 + index * 3] = value & 255;
      bytes[45 + index * 3] = (value >> 8) & 255;
      bytes[46 + index * 3] = (value >> 16) & 255;
    });
    const result = decodePcmWav(bytes);
    expect(result.channels).toBe(2);
    expect(Array.from(result.samples)).toEqual([-1, -1 / 8388608, 0, 8388607 / 8388608]);
    const partial = bytes.slice(0, 50);
    new DataView(partial.buffer).setUint32(40, 3, true);
    expect(() => decodePcmWav(partial)).toThrow("complete frames");
  });
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
