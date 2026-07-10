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
    });

    expect(config).toEqual({
      runtimeRoot: "E:\\runtime",
      gptSovitsBaseUrl: "http://127.0.0.1:1999",
      voicePackPath: "E:\\voices\\voice-pack.json",
      clipAssetRoot: "E:\\assets\\clips",
      mixAssetRoot: "E:\\assets\\mixes",
    });
  });
});
