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
      signal: expect.any(AbortSignal),
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

  it("classifies HTTP 507 as storage exhaustion even when the response omits the error code", async () => {
    const bridge = createLocalGenerationBridge({ fetchImpl: vi.fn(async () => Response.json({ error: "storage full" }, { status: 507 })) });
    const updates: GenerationJobUpdate[] = [];
    await bridge.generateClip({ project: demoProject, clipId: "voice_001", reason: "generate" }, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed", errorCode: "INSUFFICIENT_STORAGE", error: "音频保存空间不足，请释放存储空间后重试。", job: { status: "failed" } });
    expect(updates.map((update) => update.type)).toEqual(["snapshot", "snapshot", "failed"]);
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

  it("calls the local project mix API and emits project mix updates", async () => {
    const fetchImpl = vi.fn(
      async () =>
        Response.json({
          asset: {
            assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
            uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
            duration: 210,
          },
        }),
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      mixEndpoint: "/api/generation/mix",
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    const started = await bridge.generateProjectMix(
      {
        project: demoProject,
        exportType: "wav",
        reason: "mix",
      },
      (update) => updates.push(update),
    );

    expect(started.jobId).toBe("local_job_1");
    expect(fetchImpl).toHaveBeenCalledWith("/api/generation/mix", {
      signal: expect.any(AbortSignal),
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        project: demoProject,
        exportType: "wav",
        reason: "mix",
      }),
    });
    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "snapshot",
      "succeeded",
    ]);
    expect(updates.at(-1)).toMatchObject({
      type: "succeeded",
      job: {
        jobId: "local_job_1",
        clipId: "project_mix:wav",
        target: { type: "project_mix", exportType: "wav" },
        status: "succeeded",
        progress: 100,
      },
      asset: {
        assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
        uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
        duration: 210,
      },
    });
  });

  it("emits failed project mix updates for API failures", async () => {
    const fetchImpl = vi.fn(
      async () => Response.json({ error: "Missing assets" }, { status: 409 }),
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    await bridge.generateProjectMix(
      {
        project: demoProject,
        exportType: "wav",
        reason: "mix",
      },
      (update) => updates.push(update),
    );

    expect(updates.at(-1)).toMatchObject({
      type: "failed",
      error: "Missing assets",
      job: {
        jobId: "local_job_1",
        clipId: "project_mix:wav",
        target: { type: "project_mix", exportType: "wav" },
        status: "failed",
      },
    });
  });

  it("keeps the storage code on failed mix updates", async () => {
    const bridge = createLocalGenerationBridge({ fetchImpl: vi.fn(async () => Response.json({ code: "INSUFFICIENT_STORAGE", error: "storage full" }, { status: 507 })) });
    const updates: GenerationJobUpdate[] = [];
    await bridge.generateProjectMix({ project: demoProject, exportType: "wav", reason: "mix" }, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed", errorCode: "INSUFFICIENT_STORAGE", error: "音频保存空间不足，请释放存储空间后重试。", job: { target: { type: "project_mix", exportType: "wav" } } });
  });

  it("emits canceled and ignores late project mix success", async () => {
    let mixSignal: AbortSignal | null | undefined;
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      (_url: unknown, options?: RequestInit) => {
        mixSignal = options?.signal;
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      },
    );
    const bridge = createLocalGenerationBridge({
      fetchImpl,
      jobIdPrefix: "local_job",
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    const updates: GenerationJobUpdate[] = [];

    const startedPromise = bridge.generateProjectMix(
      {
        project: demoProject,
        exportType: "wav",
        reason: "mix",
      },
      (update) => updates.push(update),
    );

    await bridge.cancelGeneration("local_job_1");
    expect(mixSignal?.aborted).toBe(true);
    resolveFetch(
      Response.json({
        asset: {
          assetId: "late_mix",
          uri: "asset://mix/late_mix",
          duration: 210,
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
