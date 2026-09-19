import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { renderSpatialClip } from "./spatial-audio";

// Opt-in: requires the separately installed original-D Python dependencies and SOFA.
it.runIf(process.env.ASMR_SPATIAL_REAL_TEST === "1")("runs the actual Python adapter, retains PCM24 tail, and reuses its cache", async () => {
  const testBase = process.env.ASMR_SPATIAL_TEST_ROOT ?? os.tmpdir();
  await mkdir(testBase, { recursive: true });
  const root = await mkdtemp(path.join(testBase, "asmr-spatial-real-"));
  try {
    const config = { ...getLocalRuntimeConfig(), clipAssetRoot: path.join(root, "clips"), spatialCacheRoot: path.join(root, "cache") };
    await mkdir(config.clipAssetRoot);
    const source = writePcm16Wav(Float32Array.from({ length: 48000 }, (_, i) => .05 * Math.sin(i * 2 * Math.PI * 300 / 48000)), 48000);
    const sourcePath = path.join(config.clipAssetRoot, "voice.wav");
    await writeFile(sourcePath, source);
    const input = { assetId: "voice", position: { pan: -.7, distance: "very_close", movement: "static" } as const, durationSeconds: .75, fadeInSeconds: .05, fadeOutSeconds: .06, config };
    const first = await renderSpatialClip(input);
    const decoded = decodePcmWav(first.wav);
    expect(first.spatialized).toBe(true);
    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.samples.length / 2 / 48000).toBe(1.4);
    expect(new DataView(first.wav.buffer, first.wav.byteOffset, first.wav.byteLength).getUint16(34, true)).toBe(24);
    expect(decoded.samples.slice(.75 * 48000 * 2).some(sample => Math.abs(sample) > .00001)).toBe(true);
    expect((await renderSpatialClip(input)).wav).toEqual(first.wav);
    expect(await readFile(sourcePath)).toEqual(Buffer.from(source));
  } finally {
    if (path.resolve(root).startsWith(path.resolve(testBase) + path.sep)) await rm(root, { recursive: true, force: true });
  }
}, 60_000);
