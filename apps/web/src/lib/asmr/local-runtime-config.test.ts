import path from "node:path";

import { describe, expect, it } from "vitest";

import { getLocalRuntimeConfig } from "./local-runtime-config";

describe("local runtime config", () => {
  it("uses D drive runtime defaults", () => {
    const config = getLocalRuntimeConfig({});

    expect(config.runtimeRoot).toBe(
      "D:\\CodexWorkplace\\asmr_director_runtime",
    );
    expect(config.gptSovitsBaseUrl).toBe("http://127.0.0.1:9880");
    expect(config.voxcpm2ProfilePath).toBe(path.join(config.runtimeRoot, "audio-quality-v1", "voxcpm2", "profile.json"));
    expect(config.spatialCacheRoot).toBe(path.join(config.runtimeRoot, "assets", "spatial"));
    expect(config.spatialPythonPath).toBe(path.join(config.runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe"));
    expect(config.spatialHrtfPath).toBe(path.join(config.runtimeRoot, "audio-quality-v1", "hrtf", "viking", "subj_A.sofa"));
    expect(config.voicePackPath).toBe(
      path.join(
        "D:\\CodexWorkplace\\asmr_director_runtime",
        "voice-packs",
        "default",
        "voice-pack.json",
      ),
    );
    expect(config.clipAssetRoot).toBe(
      path.join(
        "D:\\CodexWorkplace\\asmr_director_runtime",
        "assets",
        "clips",
        "app",
      ),
    );
    expect(config.mixAssetRoot).toBe(
      path.join(
        "D:\\CodexWorkplace\\asmr_director_runtime",
        "assets",
        "mixes",
        "app",
      ),
    );
  });

  it("allows explicit runtime overrides", () => {
    const config = getLocalRuntimeConfig({
      ASMR_DIRECTOR_RUNTIME_ROOT: "E:\\runtime",
      ASMR_GPT_SOVITS_URL: "http://127.0.0.1:1999",
      ASMR_VOICE_PACK_PATH: "E:\\voices\\voice-pack.json",
      ASMR_CLIP_ASSET_ROOT: "E:\\assets\\clips",
      ASMR_MIX_ASSET_ROOT: "E:\\assets\\mixes",
      ASMR_VOXCPM2_PROFILE_PATH: "E:\\voices\\voxcpm2.json",
      ASMR_SPATIAL_CACHE_ROOT: "I:\\spatial",
      ASMR_SPATIAL_PYTHON: "E:\\python.exe",
      ASMR_SPATIAL_HRTF: "E:\\subject.sofa",
    });

    expect(config).toEqual({
      runtimeRoot: "E:\\runtime",
      gptSovitsBaseUrl: "http://127.0.0.1:1999",
      voicePackPath: "E:\\voices\\voice-pack.json",
      clipAssetRoot: "E:\\assets\\clips",
      mixAssetRoot: "E:\\assets\\mixes",
      voxcpm2ProfilePath: "E:\\voices\\voxcpm2.json",
      spatialCacheRoot: "I:\\spatial",
      spatialPythonPath: "E:\\python.exe",
      spatialHrtfPath: "E:\\subject.sofa",
    });
  });
});
