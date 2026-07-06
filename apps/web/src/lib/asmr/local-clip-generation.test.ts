import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { generateLocalVoiceClip } from "./local-clip-generation";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";

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
  };
}

describe("local clip generation", () => {
  it("generates a voice clip through GPT-SoVITS and stores a durable asset", async () => {
    const config = await makeRuntimeConfig();
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => new Response(wav));

    const asset = await generateLocalVoiceClip({
      project: demoProject,
      clipId: "voice_001",
      config,
      fetchImpl,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(asset.uri).toMatch(/^asset:\/\/clip\/voice_001_/);
    expect(asset.duration).toBe(7.5);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects non-voice clips in the real generation MVP", async () => {
    const config = await makeRuntimeConfig();

    await expect(
      generateLocalVoiceClip({
        project: demoProject,
        clipId: "sfx_blanket_001",
        config,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow("Only voice clips can use GPT-SoVITS generation");
  });
});
