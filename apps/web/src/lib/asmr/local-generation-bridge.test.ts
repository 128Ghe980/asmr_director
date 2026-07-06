import { describe, expect, it, vi } from "vitest";

import type { GenerationJobUpdate } from "./generation-bridge";
import { createLocalGenerationBridge } from "./local-generation-bridge";
import { demoProject } from "./mock-project";

describe("local generation bridge", () => {
  it("calls the local generation API and emits existing job updates", async () => {
    const fetchImpl = vi.fn(
      async () =>
        Response.json({
          asset: {
            assetId: "voice_001_20260707T000000000Z_abcd1234",
            uri: "asset://clip/voice_001_20260707T000000000Z_abcd1234",
            duration: 7.5,
          },
        }),
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      now: () => new Date("2026-07-07T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    const started = await bridge.generateClip(
      {
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    expect(started.jobId).toBe("local_job_1");
    expect(fetchImpl).toHaveBeenCalledWith("/api/generation/clip", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      }),
    });
    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "snapshot",
      "succeeded",
    ]);
    expect(updates.at(-1)).toEqual({
      type: "succeeded",
      job: {
        jobId: "local_job_1",
        clipId: "voice_001",
        status: "succeeded",
        progress: 100,
        message: "生成完成",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      },
      asset: {
        assetId: "voice_001_20260707T000000000Z_abcd1234",
        uri: "asset://clip/voice_001_20260707T000000000Z_abcd1234",
        duration: 7.5,
      },
    });
  });

  it("emits failed updates for API failures", async () => {
    const fetchImpl = vi.fn(
      async () => Response.json({ error: "Provider down" }, { status: 502 }),
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      now: () => new Date("2026-07-07T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    await bridge.generateClip(
      {
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    expect(updates.at(-1)).toMatchObject({
      type: "failed",
      error: "Provider down",
      job: {
        jobId: "local_job_1",
        clipId: "voice_001",
        status: "failed",
        progress: 100,
      },
    });
  });

  it("emits canceled and ignores late success after local cancellation", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      now: () => new Date("2026-07-07T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    const startedPromise = bridge.generateClip(
      {
        project: demoProject,
        clipId: "voice_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    await bridge.cancelGeneration("local_job_1");
    resolveFetch(
      Response.json({
        asset: {
          assetId: "voice_001_late",
          uri: "asset://clip/voice_001_late",
          duration: 7.5,
        },
      }),
    );
    await startedPromise;

    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "snapshot",
      "canceled",
    ]);
  });
});
