import { describe, expect, it } from "vitest";

import {
  isLocalMixAssetUri,
  resolvePlayableAssetUri,
  resolveClipPlaybackUri,
} from "./playback-asset-resolver";
import { demoProject } from "./mock-project";
import { flattenClips } from "./view-model";

describe("playback asset resolver", () => {
  it("uses current spatial settings for an unchanged dry asset and full candidate duration", () => {
    const clip = structuredClone(flattenClips(demoProject).find((item) => item.type === "voice")!);
    clip.asset = { asset_id: "dry", uri: "asset://clip/dry", duration: 30 };
    clip.duration = 12;
    clip.position.movement = "orbit";
    const uri = resolveClipPlaybackUri(clip, true)!;
    const url = new URL(uri, "http://localhost");
    expect(url.pathname).toBe("/api/assets/spatial/dry");
    expect(url.searchParams.get("duration")).toBe("12");
    expect(JSON.parse(url.searchParams.get("position")!)).toEqual(clip.position);
    clip.position.distance = "far";
    expect(resolveClipPlaybackUri(clip, true)).not.toBe(uri);
    expect(resolveClipPlaybackUri(clip, false)).toBe("/api/assets/clip/dry");
    const candidate = new URL(resolveClipPlaybackUri(clip, true, { uri: "asset://clip/new", duration: 34.54 })!, "http://localhost");
    expect(candidate.searchParams.get("duration")).toBe("34.54");
    expect(clip.asset.asset_id).toBe("dry");
  });
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
