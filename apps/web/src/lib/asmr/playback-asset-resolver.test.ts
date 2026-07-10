import { describe, expect, it } from "vitest";

import {
  isLocalMixAssetUri,
  resolvePlayableAssetUri,
} from "./playback-asset-resolver";

describe("playback asset resolver", () => {
  it("maps durable local clip assets to the playback API", () => {
    expect(
      resolvePlayableAssetUri(
        "asset://clip/voice_001_20260707T000000000Z_abcd1234",
      ),
    ).toBe("/api/assets/clip/voice_001_20260707T000000000Z_abcd1234");
  });

  it("maps durable local mix assets to the playback API", () => {
    const uri = "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234";

    expect(isLocalMixAssetUri(uri)).toBe(true);
    expect(resolvePlayableAssetUri(uri)).toBe(
      "/api/assets/mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    );
  });

  it("keeps mock assets playable through generated data URLs", () => {
    expect(resolvePlayableAssetUri("mock://asset/voice_001/job_1")).toMatch(
      /^data:audio\/wav;base64,/,
    );
  });

  it("does not resolve empty assets", () => {
    expect(resolvePlayableAssetUri(undefined)).toBeUndefined();
    expect(resolvePlayableAssetUri(null)).toBeUndefined();
  });
});
