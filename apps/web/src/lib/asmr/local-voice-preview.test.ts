import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareVoicePreview } from "./local-voice-preview";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";

let root: string, tempRoot: string, config: LocalRuntimeConfig;
beforeEach(async () => {
  const base = tmpdir();
  await mkdir(base, { recursive: true }); root = await mkdtemp(path.join(base, "asmr-preview-test-")); tempRoot = path.join(root, "exports");
  config = { runtimeRoot: root, clipAssetRoot: path.join(root, "clips"), mixAssetRoot: path.join(root, "mix"), gptSovitsBaseUrl: "unused", voicePackPath: "unused" };
  await mkdir(config.clipAssetRoot, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function project() {
  const result = structuredClone(demoProject), track = result.timeline.tracks.find(track => track.track_type === "voice")!, base = track.clips[0];
  track.clips = [0, 1, 2].map(index => ({ ...structuredClone(base), id: `voice_${index}`, text: `text ${index}`, start: index * 10,
    duration: .001, fade_in: .1, fade_out: .1, volume_db: -50, pause_after: .005,
    asset: { asset_id: `a${index}`, uri: `asset://clip/a${index}`, duration: .002 },
    generation: { ...base.generation, status: index === 1 ? "asset_pending" : "asset_generated" } }));
  result.timeline.mixing.binaural = true;
  return result;
}
async function sources() {
  const mono = new Float32Array(240).fill(.2); mono[239] = .9;
  const stereo = new Float32Array(1920); for (let i = 0; i < stereo.length; i += 2) { stereo[i] = .4; stereo[i + 1] = -.3; }
  const first = writePcm16Wav(mono, 24000), second = writePcm16Wav(stereo, 48000, 2);
  await writeFile(path.join(config.clipAssetRoot, "a0.wav"), first); await writeFile(path.join(config.clipAssetRoot, "a2.wav"), second);
  return { first, second };
}
describe("raw adopted voice concatenation", () => {
  it("preserves leading, middle and trailing silent shot durations without fetching their descriptions as audio", async () => {
    await sources();
    const input = project(), track = input.timeline.tracks.find(track => track.track_type === "voice")!;
    const silent = { ...structuredClone(track.clips[1]), kind: "silent" as const, duration: .02, pause_after: .005,
      asset: { asset_id: null, uri: null, duration: null } };
    track.clips = [{ ...silent, id: "silent_before", start: 0 }, { ...track.clips[0], start: 1 },
      { ...silent, id: "silent_middle", start: 2 }, { ...track.clips[2], start: 3 }, { ...silent, id: "silent_after", start: 4 }];
    const result = await prepareVoicePreview(input, config, undefined, { tempRoot });
    const pcm = decodePcmWav(await readFile(result.filePath));
    expect(result).toMatchObject({ clipCount: 2, skippedCount: 0, duration: .11 });
    expect(pcm.samples.slice(0, 1200 * 2).every(sample => sample === 0)).toBe(true);
    expect(pcm.samples[1200 * 2]).toBeCloseTo(.2, 4);
    expect(pcm.samples.slice(1920 * 2, 2880 * 2).every(sample => sample === 0)).toBe(true);
    expect(pcm.samples[3120 * 2]).toBeCloseTo(.4, 4);
    expect(pcm.samples.slice(-960 * 2).every(sample => sample === 0)).toBe(true);
    await result.cleanup();
  });
  it("previews an all-silent timeline using zero PCM samples and no source file", async () => {
    const input = project(), track = input.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips = [{ ...track.clips[0], kind: "silent", duration: .02, asset: { asset_id: null, uri: null, duration: null } }];
    const result = await prepareVoicePreview(input, config, undefined, { tempRoot });
    expect(result).toMatchObject({ clipCount: 0, skippedCount: 0, duration: .02 });
    expect(decodePcmWav(await readFile(result.filePath)).samples.every(sample => sample === 0)).toBe(true);
    await result.cleanup();
  });
  it("keeps full source tails and channels, resamples, skips missing speech and applies only the explicit inter-clip wait", async () => {
    const originals = await sources(), input = project(), before = JSON.stringify(input);
    const prepared = await prepareVoicePreview(input, config, undefined, { tempRoot }), bytes = await readFile(prepared.filePath), pcm = decodePcmWav(bytes);
    expect(prepared).toMatchObject({ clipCount: 2, skippedCount: 1, duration: .035, size: 44 + 1680 * 4 });
    expect(pcm.sampleRate).toBe(48000); expect(pcm.channels).toBe(2);
    expect(pcm.samples[0]).toBeCloseTo(.2, 4); expect(pcm.samples[1]).toBeCloseTo(.2, 4);
    expect(pcm.samples[478 * 2]).toBeCloseTo(.9, 4); expect(pcm.samples[479 * 2 + 1]).toBeCloseTo(.9, 4);
    expect(pcm.samples.slice(480 * 2, 720 * 2).every(value => value === 0)).toBe(true);
    expect(pcm.samples[720 * 2]).toBeCloseTo(.4, 4); expect(pcm.samples[720 * 2 + 1]).toBeCloseTo(-.3, 4);
    expect(pcm.samples.at(-1)).toBeCloseTo(-.3, 4);
    expect(JSON.stringify(input)).toBe(before);
    expect(await readFile(path.join(config.clipAssetRoot, "a0.wav"))).toEqual(Buffer.from(originals.first));
    expect(await readFile(path.join(config.clipAssetRoot, "a2.wav"))).toEqual(Buffer.from(originals.second));
    await Promise.all([prepared.cleanup(), prepared.cleanup()]); expect(await readdir(tempRoot)).toEqual([]);
  });
  it("rejects missing sources and cleans temporary files without altering other directories", async () => {
    await expect(prepareVoicePreview(project(), config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 404 });
    expect(await readdir(tempRoot)).toEqual([]); expect(await readdir(config.clipAssetRoot)).toEqual([]);
  });
  it("rejects unsafe and inconsistent references", async () => {
    await sources(); const input = project(), track = input.timeline.tracks.find(track => track.track_type === "voice")!;
    track.clips[0].asset = { asset_id: "../secret", uri: "asset://clip/../secret", duration: 1 };
    await expect(prepareVoicePreview(input, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    track.clips[0].asset = { asset_id: "a0", uri: "asset://clip/a2", duration: 1 };
    await expect(prepareVoicePreview(input, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    expect(await readdir(tempRoot)).toEqual([]);
  });
  it("rejects malformed PCM and complete-output duration limits", async () => {
    await sources(); await writeFile(path.join(config.clipAssetRoot, "a2.wav"), "not wav");
    await expect(prepareVoicePreview(project(), config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 422 });
    await sources(); await expect(prepareVoicePreview(project(), config, undefined, { tempRoot, maxDurationSeconds: .03 })).rejects.toMatchObject({ statusCode: 413 });
    expect(await readdir(tempRoot)).toEqual([]);
  });
  it("accepts 24-bit mono PCM and retains its ending sample", async () => {
    const bytes = new Uint8Array(44 + 3 * 240), header = writePcm16Wav(new Float32Array(), 24000);
    bytes.set(header); const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.length - 8, true); view.setUint32(28, 24000 * 3, true); view.setUint16(32, 3, true); view.setUint16(34, 24, true); view.setUint32(40, 720, true);
    for (let i = 0; i < 240; i++) { const value = i === 239 ? 0x7fffff : 0x200000, at = 44 + i * 3; bytes[at] = value & 255; bytes[at + 1] = value >> 8 & 255; bytes[at + 2] = value >> 16 & 255; }
    await writeFile(path.join(config.clipAssetRoot, "a0.wav"), bytes);
    const input = project(), track = input.timeline.tracks.find(track => track.track_type === "voice")!; track.clips = [track.clips[0]];
    const result = await prepareVoicePreview(input, config, undefined, { tempRoot }), pcm = decodePcmWav(await readFile(result.filePath));
    expect(result.duration).toBe(.01); expect(pcm.samples[0]).toBeCloseTo(.25, 4); expect(pcm.samples.at(-1)).toBe(1); await result.cleanup();
  });
  it("rejects empty adopted state and cancellation before touching disk", async () => {
    await expect(prepareVoicePreview(demoProject, config, undefined, { tempRoot })).rejects.toMatchObject({ statusCode: 400 });
    const controller = new AbortController(); controller.abort();
    await expect(prepareVoicePreview(project(), config, controller.signal, { tempRoot })).rejects.toMatchObject({ statusCode: 499 });
    expect(await readdir(root)).toEqual(["clips"]);
  });
  it("enforces an external deadline and cleans an interrupted preparation", async () => {
    await sources();
    await expect(prepareVoicePreview(project(), config, undefined, { tempRoot, deadlineMs: 0 })).rejects.toMatchObject({ statusCode: 408 });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
