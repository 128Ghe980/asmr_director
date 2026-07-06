import { describe, expect, it } from "vitest";

import { resolvePlayableAssetUri } from "./playback-asset-resolver";

describe("playback asset resolver", () => {
  it("maps durable local clip assets to the playback API", () => {
    expect(
      resolvePlayableAssetUri(
        "asset://clip/voice_001_20260707T000000000Z_abcd1234",
      ),
    ).toBe("/api/assets/clip/voice_001_20260707T000000000Z_abcd1234");
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
