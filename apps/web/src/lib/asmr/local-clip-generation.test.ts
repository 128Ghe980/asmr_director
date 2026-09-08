import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  generateLocalClip,
  generateLocalVoiceClip,
} from "./local-clip-generation";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16MonoWav } from "./procedural-audio";
import { writePcm16StereoWav } from "./project-mix-renderer";

async function makeRuntimeConfig(): Promise<LocalRuntimeConfig> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-runtime-"));
  const voicePackRoot = path.join(runtimeRoot, "voice-packs", "default");
  const promptTextPath = path.join(voicePackRoot, "prompt.txt");
  const voicePackPath = path.join(voicePackRoot, "voice-pack.json");

  await mkdir(voicePackRoot, { recursive: true });
  await writeFile(promptTextPath, "助けてくれたのかな", "utf8");
  await writeFile(
    voicePackPath,
    JSON.stringify({
      id: "default",
      displayName: "Default Voice",
      provider: "gpt-sovits",
      endpoint: "http://127.0.0.1:9880",
      referenceAudio: path.join(voicePackRoot, "reference.wav"),
      promptTextPath,
      promptLanguage: "ja",
      textLanguage: "zh",
      licenseStatus: "user_confirmed",
      consentConfirmedAt: "2026-07-01T00:00:00.000Z",
    }),
    "utf8",
  );

  return {
    runtimeRoot,
    gptSovitsBaseUrl: "http://127.0.0.1:9880",
    voicePackPath,
    clipAssetRoot: path.join(runtimeRoot, "assets", "clips", "app"),
    mixAssetRoot: path.join(runtimeRoot, "assets", "mixes", "app"),
  };
}

describe("local clip generation", () => {
  it("generates a voice clip through GPT-SoVITS and stores a durable asset", async () => {
    const config = await makeRuntimeConfig();
    const wav = writePcm16MonoWav(new Float32Array(10 * 8000), 8000);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(wav)));

    const asset = await generateLocalVoiceClip({
      project: demoProject,
      clipId: "voice_001",
      config,
      fetchImpl,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(asset.uri).toMatch(/^asset:\/\/clip\/voice_001_/);
    expect(asset.duration).toBe(10);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await readFile(path.join(config.clipAssetRoot, `${asset.assetId}.wav`)))
      .toEqual(Buffer.from(wav));
  });

  it("measures stereo voice duration by frames rather than sample count", async () => {
    const config = await makeRuntimeConfig();
    const wav = writePcm16StereoWav(new Float32Array(3 * 8000 * 2), 8000);

    const asset = await generateLocalVoiceClip({
      project: demoProject,
      clipId: "voice_001",
      config,
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(wav))),
    });

    expect(asset.duration).toBe(3);
  });

  it.each([
    ["malformed", new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])],
    ["empty", writePcm16MonoWav(new Float32Array(0), 8000)],
    ["zero sample rate", writePcm16MonoWav(new Float32Array(8), 0)],
  ])("rejects %s voice WAV before saving an asset", async (_, wav) => {
    const config = await makeRuntimeConfig();

    await expect(generateLocalVoiceClip({
      project: demoProject,
      clipId: "voice_001",
      config,
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(wav))),
    })).rejects.toThrow(/WAV/);
    await expect(readdir(config.clipAssetRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a voice WAV containing an incomplete stereo frame", async () => {
    const config = await makeRuntimeConfig();
    const wav = new Uint8Array(writePcm16MonoWav(new Float32Array(1), 8000));
    new DataView(wav.buffer).setUint16(22, 2, true);

    await expect(generateLocalVoiceClip({
      project: demoProject,
      clipId: "voice_001",
      config,
      fetchImpl: vi.fn(async () => new Response(wav)),
    })).rejects.toThrow(/WAV/);
  });

  it("generates a breath clip with the local procedural renderer", async () => {
    const config = await makeRuntimeConfig();
    const now = new Date("2026-07-07T00:01:00.000Z");

    const asset = await generateLocalClip({
      project: demoProject,
      clipId: "breath_001",
      config,
      fetchImpl: vi.fn(),
      now,
    });

    const saved = await readFile(path.join(config.clipAssetRoot, `${asset.assetId}.wav`));

    expect(asset.uri).toMatch(/^asset:\/\/clip\/breath_001_/);
    expect(asset.duration).toBe(2.4);
    expect(saved.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("generates an SFX clip with the local procedural renderer", async () => {
    const config = await makeRuntimeConfig();
    const fetchImpl = vi.fn();

    const asset = await generateLocalClip({
        project: demoProject,
        clipId: "sfx_blanket_001",
        config,
        fetchImpl,
        now: new Date("2026-07-07T00:02:00.000Z"),
      });
    const saved = await readFile(path.join(config.clipAssetRoot, `${asset.assetId}.wav`));

    expect(asset.uri).toMatch(/^asset:\/\/clip\/sfx_blanket_001_/);
    expect(asset.duration).toBe(3.4);
    expect(saved.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
