import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writePcm16MonoWav } from "../../../../lib/asmr/procedural-audio";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/assets/analysis", () => {
  it("analyzes a safe local clip asset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asmr-analysis-"));
    const clipRoot = path.join(root, "clips");
    await mkdir(clipRoot, { recursive: true });
    await writeFile(
      path.join(clipRoot, "clip_safe.wav"),
      writePcm16MonoWav(new Float32Array([0, 0.5, -0.5, 0]), 4),
    );
    vi.stubEnv("ASMR_CLIP_ASSET_ROOT", clipRoot);

    const response = await GET(
      new Request(
        "http://localhost/api/assets/analysis?uri=asset%3A%2F%2Fclip%2Fclip_safe&bars=16",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis).toMatchObject({
      channels: 1,
      sampleRate: 4,
      duration: 1,
      clippedSampleCount: 0,
    });
    expect(body.analysis.bars).toHaveLength(16);
  });

  it("rejects unknown schemes and unsafe asset ids", async () => {
    const unknown = await GET(
      new Request(
        "http://localhost/api/assets/analysis?uri=https%3A%2F%2Fexample.com%2Fa.wav",
      ),
    );
    const unsafe = await GET(
      new Request(
        "http://localhost/api/assets/analysis?uri=asset%3A%2F%2Fclip%2F..%252Fsecret",
      ),
    );

    expect(unknown.status).toBe(400);
    expect(unsafe.status).toBe(400);
  });

  it("reports missing and invalid WAV assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asmr-analysis-"));
    const mixRoot = path.join(root, "mixes");
    await mkdir(mixRoot, { recursive: true });
    await writeFile(path.join(mixRoot, "invalid.wav"), "not-a-wave");
    vi.stubEnv("ASMR_MIX_ASSET_ROOT", mixRoot);

    const missing = await GET(
      new Request(
        "http://localhost/api/assets/analysis?uri=asset%3A%2F%2Fmix%2Fmissing",
      ),
    );
    const invalid = await GET(
      new Request(
        "http://localhost/api/assets/analysis?uri=asset%3A%2F%2Fmix%2Finvalid",
      ),
    );

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(422);
  });
});
