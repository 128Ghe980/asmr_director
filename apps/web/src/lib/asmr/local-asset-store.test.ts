import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LocalRuntimeConfig } from "./local-runtime-config";
import {
  resolveClipAssetPath,
  saveClipAsset,
} from "./local-asset-store";

function makeConfig(clipAssetRoot: string): LocalRuntimeConfig {
  return {
    runtimeRoot: path.dirname(clipAssetRoot),
    gptSovitsBaseUrl: "http://127.0.0.1:9880",
    voicePackPath: path.join(path.dirname(clipAssetRoot), "voice-pack.json"),
    clipAssetRoot,
  };
}

describe("local asset store", () => {
  it("stores WAV bytes and returns a durable clip asset URI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asmr-assets-"));
    const config = makeConfig(path.join(root, "clips"));
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

    const asset = await saveClipAsset({
      config,
      clipId: "voice_001",
      wav,
      duration: 7.5,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(asset.assetId).toMatch(/^voice_001_20260707T000000000Z_[a-z0-9]+$/);
    expect(asset.uri).toBe(`asset://clip/${asset.assetId}`);
    expect(asset.duration).toBe(7.5);
    await expect(
      readFile(resolveClipAssetPath(asset.assetId, config)),
    ).resolves.toEqual(Buffer.from(wav));
  });

  it("rejects unsafe asset IDs", () => {
    const config = makeConfig("D:\\runtime\\assets\\clips\\app");

    expect(() => resolveClipAssetPath("..\\secret", config)).toThrow(
      "Invalid clip asset id",
    );
    expect(() => resolveClipAssetPath("../secret", config)).toThrow(
      "Invalid clip asset id",
    );
  });
});
