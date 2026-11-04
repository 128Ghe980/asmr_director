import { describe, expect, it } from "vitest";
import { appendPcmWavSilence } from "./wav-tail-padding";

const ascii = (value: string) => Uint8Array.from(value, char => char.charCodeAt(0));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function chunk(tag: string, payload: Uint8Array, padding = 0xa7) {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
  bytes.set(ascii(tag)); viewOf(bytes).setUint32(4, payload.length, true); bytes.set(payload, 8);
  if (payload.length % 2) bytes[bytes.length - 1] = padding;
  return bytes;
}

function riff(parts: Uint8Array[]) {
  const bytes = new Uint8Array(12 + parts.reduce((sum, part) => sum + part.length, 0));
  bytes.set(ascii("RIFF")); viewOf(bytes).setUint32(4, bytes.length - 8, true); bytes.set(ascii("WAVE"), 8);
  let offset = 12;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function fixture(bits = 16, channels = 1, sampleRate = 48_000, frames = 3) {
  const format = new Uint8Array(16), formatView = viewOf(format), blockAlign = channels * bits / 8;
  formatView.setUint16(0, 1, true); formatView.setUint16(2, channels, true);
  formatView.setUint32(4, sampleRate, true); formatView.setUint32(8, sampleRate * blockAlign, true);
  formatView.setUint16(12, blockAlign, true); formatView.setUint16(14, bits, true);
  const pcm = Uint8Array.from({ length: frames * blockAlign }, (_, index) => (index * 79 + 0x81) % 256);
  const parts = [chunk("JUNK", ascii("abc"), 0x9a), chunk("fmt ", format), chunk("data", pcm), chunk("LIST", ascii("xyz12"), 0xbb)];
  return { wav: riff(parts), parts, pcm, format, bits, channels, sampleRate, blockAlign, frames };
}

function chunks(wav: Uint8Array) {
  const result: Array<{ tag: string; offset: number; payload: Uint8Array; whole: Uint8Array }> = [];
  for (let offset = 12; offset < wav.length;) {
    const size = viewOf(wav).getUint32(offset + 4, true), length = 8 + size + size % 2;
    result.push({ tag: String.fromCharCode(...wav.subarray(offset, offset + 4)), offset,
      payload: wav.slice(offset + 8, offset + 8 + size), whole: wav.slice(offset, offset + length) });
    offset += length;
  }
  return result;
}

describe("append PCM WAV tail silence", () => {
  it.each([[16, 1], [16, 2], [24, 1], [24, 2]])("keeps %i-bit / %i-channel PCM and ancillary chunks byte-exact and appends only zero samples", (bits, channels) => {
    const source = fixture(bits, channels), before = source.wav.slice();
    const result = appendPcmWavSilence(source.wav, .35), output = chunks(result.wav);
    expect(source.wav).toEqual(before);
    expect(result.wav).not.toBe(source.wav);
    expect(result.tailFrames).toBe(16_800);
    expect(result.tailPauseSeconds).toBe(.35);
    expect(result.sourceDurationSeconds).toBe(3 / 48_000);
    expect(result.durationSeconds).toBe(16_803 / 48_000);
    expect(viewOf(result.wav).getUint32(4, true)).toBe(result.wav.length - 8);
    expect(output.map(part => part.tag)).toEqual(["JUNK", "fmt ", "data", "LIST"]);
    for (const index of [0, 1, 3]) expect(output[index].whole).toEqual(source.parts[index]);
    const audio = output[2].payload;
    expect(audio.length).toBe((3 + 16_800) * source.blockAlign);
    expect(audio.slice(0, source.pcm.length)).toEqual(source.pcm);
    expect(audio.subarray(source.pcm.length).every(byte => byte === 0)).toBe(true);
  });

  it.each([2, 3])("moves metadata correctly when 24-bit mono data changes padding parity from %i frames", frames => {
    const source = fixture(24, 1, 48_000, frames);
    const result = appendPcmWavSilence(source.wav, 1 / 48_000), output = chunks(result.wav);
    const audio = output[2];
    expect(result.tailFrames).toBe(1);
    expect(audio.payload).toEqual(new Uint8Array([...source.pcm, 0, 0, 0]));
    expect(output[3].offset).toBe(audio.offset + 8 + audio.payload.length + audio.payload.length % 2);
    expect(output[3].whole).toEqual(source.parts[3]);
    if (audio.payload.length % 2) expect(audio.whole.at(-1)).toBe(0);
    // The old 0xa7 data-alignment byte is not allowed to become an audio sample.
    expect(audio.payload.subarray(source.pcm.length)).toEqual(new Uint8Array(3));
  });

  it("quantizes 0.35 seconds at 22050 Hz to whole frames and reports the actual duration", () => {
    const source = fixture(24, 2, 22_050);
    const result = appendPcmWavSilence(source.wav, .35);
    expect(result.tailFrames).toBe(7718);
    expect(result.tailPauseSeconds).toBe(7718 / 22_050);
    expect(result.durationSeconds).toBe(7721 / 22_050);
    expect(Math.abs(result.tailPauseSeconds - .35)).toBeLessThanOrEqual(.5 / 22_050 + Number.EPSILON);
    expect(chunks(result.wav)[2].payload.length).toBe(7721 * 6);
  });

  it.each([0, .000001])("returns the exact source view for a %s-second tail that rounds to zero", seconds => {
    const source = fixture(), storage = new Uint8Array(source.wav.length + 16).fill(0xd3);
    storage.set(source.wav, 7);
    const offsetView = storage.subarray(7, 7 + source.wav.length), before = storage.slice();
    const result = appendPcmWavSilence(offsetView, seconds);
    expect(result.wav).toBe(offsetView);
    expect(result.tailFrames).toBe(0); expect(result.tailPauseSeconds).toBe(0);
    expect(result.durationSeconds).toBe(result.sourceDurationSeconds);
    expect(storage).toEqual(before);
  });

  it("handles a nonzero-offset input view without reading or modifying its surrounding bytes", () => {
    const source = fixture(24, 1), storage = new Uint8Array(source.wav.length + 16).fill(0xd3);
    storage.set(source.wav, 7);
    const before = storage.slice(), result = appendPcmWavSilence(storage.subarray(7, 7 + source.wav.length), .1);
    expect(chunks(result.wav)[2].payload.slice(0, source.pcm.length)).toEqual(source.pcm);
    expect(storage).toEqual(before);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 600.001])("rejects invalid duration %s", seconds => {
    expect(() => appendPcmWavSilence(fixture().wav, seconds)).toThrow("Invalid WAV tail pause");
  });

  it.each([
    [0, 3, "u16"], [2, 0, "u16"], [2, 3, "u16"], [4, 7999, "u32"], [4, 192001, "u32"],
    [8, 1, "u32"], [12, 1, "u16"], [14, 8, "u16"], [14, 32, "u16"],
  ] as const)("rejects unsupported or inconsistent fmt field %i=%i (%s)", (offset, value, width) => {
    const source = fixture(), modified = source.format.slice(), view = viewOf(modified);
    if (width === "u16") view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
    const wav = riff([chunk("fmt ", modified), chunk("data", source.pcm)]);
    expect(() => appendPcmWavSilence(wav, .35)).toThrow("Unsupported PCM WAV");
  });

  it("rejects truncated, ambiguous, incomplete and non-frame-aligned WAVs even for zero padding", () => {
    const source = fixture();
    const wrongRiff = source.wav.slice(); wrongRiff[0] = 0;
    const wrongWave = source.wav.slice(); wrongWave[8] = 0;
    const wrongSize = source.wav.slice(); viewOf(wrongSize).setUint32(4, wrongSize.length, true);
    const overrun = source.wav.slice(); viewOf(overrun).setUint32(16, overrun.length, true);
    const trailing = riff([...source.parts, Uint8Array.of(1)]);
    const malformed = [
      new Uint8Array(), source.wav.slice(0, 11), wrongRiff, wrongWave, wrongSize, overrun, trailing,
      riff([source.parts[1], source.parts[1], source.parts[2]]),
      riff([source.parts[1], source.parts[2], source.parts[2]]),
      riff([source.parts[1]]), riff([source.parts[2]]),
      riff([chunk("fmt ", source.format.slice(0, 15)), source.parts[2]]),
      riff([source.parts[1], chunk("data", new Uint8Array())]),
      riff([source.parts[1], chunk("data", Uint8Array.of(1, 2, 3))]),
      riff([source.parts[1], chunk("data", Uint8Array.of(1, 2, 3)).slice(0, -1)]),
    ];
    for (const wav of malformed) {
      expect(() => appendPcmWavSilence(wav, .35)).toThrow();
      expect(() => appendPcmWavSilence(wav, 0)).toThrow();
    }
  });
});
