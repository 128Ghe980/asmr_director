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

  it("generates WAV data URLs with playable PCM headers", () => {
    const prefix = "data:audio/wav;base64,";
    const dataUrl = resolveMockAssetUri("mock://asset/voice_001/job_1");

    expect(dataUrl?.slice(0, prefix.length)).toBe(prefix);

    const bytes = Buffer.from(dataUrl?.slice(prefix.length) ?? "", "base64");

    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    expect(bytes.toString("ascii", 12, 16)).toBe("fmt ");
    expect(bytes.readUInt16LE(20)).toBe(1);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(8000);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.toString("ascii", 36, 40)).toBe("data");
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
