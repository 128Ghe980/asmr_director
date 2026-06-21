import { describe, expect, it } from "vitest";

import {
  isMockAssetUri,
  resolveMockAssetUri,
} from "./mock-asset-resolver";

describe("mock asset resolver", () => {
  it("detects mock asset URIs", () => {
    expect(isMockAssetUri("mock://asset/voice_001/job_1")).toBe(true);
    expect(isMockAssetUri("https://example.com/audio.wav")).toBe(false);
    expect(isMockAssetUri(null)).toBe(false);
  });

  it("returns deterministic playable data URLs for mock assets", () => {
    const first = resolveMockAssetUri("mock://asset/voice_001/job_1");
    const second = resolveMockAssetUri("mock://asset/voice_001/job_1");

    expect(first).toBe(second);
    expect(first).toMatch(/^data:audio\/wav;base64,/);
  });

  it("passes non-mock URIs through unchanged", () => {
    expect(resolveMockAssetUri("https://example.com/audio.wav")).toBe(
      "https://example.com/audio.wav",
    );
  });

  it("returns undefined for empty URIs", () => {
    expect(resolveMockAssetUri(null)).toBeUndefined();
    expect(resolveMockAssetUri(undefined)).toBeUndefined();
  });
});
