import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LocalRuntimeConfig } from "./local-runtime-config";
import { loadVoicePack } from "./voice-pack";

async function makeVoicePackFile(data: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), "asmr-voice-pack-"));
  const voicePackPath = path.join(root, "voice-pack.json");

  await writeFile(voicePackPath, JSON.stringify(data), "utf8");

  return {
    root,
    voicePackPath,
  };
}

function makeConfig(voicePackPath: string): LocalRuntimeConfig {
  return {
    runtimeRoot: path.dirname(voicePackPath),
    gptSovitsBaseUrl: "http://127.0.0.1:9880",
    voicePackPath,
    clipAssetRoot: path.join(path.dirname(voicePackPath), "assets"),
  };
}

describe("voice pack", () => {
  it("loads a GPT-SoVITS voice pack and prompt text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asmr-voice-pack-"));
    const promptTextPath = path.join(root, "prompt.txt");
    const voicePackPath = path.join(root, "voice-pack.json");

    await writeFile(promptTextPath, "参考音频转写", "utf8");
    await writeFile(
      voicePackPath,
      JSON.stringify({
        id: "default",
        displayName: "Default Voice",
        provider: "gpt-sovits",
        endpoint: "http://127.0.0.1:9880",
        referenceAudio: path.join(root, "reference.wav"),
        promptTextPath,
        promptLanguage: "ja",
        textLanguage: "zh",
        licenseStatus: "user_confirmed",
        consentConfirmedAt: "2026-07-01T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(loadVoicePack(makeConfig(voicePackPath))).resolves.toMatchObject(
      {
        id: "default",
        displayName: "Default Voice",
        provider: "gpt-sovits",
        endpoint: "http://127.0.0.1:9880",
        promptText: "参考音频转写",
        promptLanguage: "ja",
        textLanguage: "zh",
      },
    );
  });

  it("rejects voice packs without user confirmed consent", async () => {
    const { voicePackPath } = await makeVoicePackFile({
      id: "default",
      displayName: "Default Voice",
      provider: "gpt-sovits",
      endpoint: "http://127.0.0.1:9880",
      referenceAudio: "reference.wav",
      promptTextPath: "prompt.txt",
      promptLanguage: "ja",
      textLanguage: "zh",
      licenseStatus: "unknown",
      consentConfirmedAt: null,
    });

    await expect(loadVoicePack(makeConfig(voicePackPath))).rejects.toThrow(
      "Voice pack consent is not confirmed",
    );
  });
});
