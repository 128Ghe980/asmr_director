import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "./mock-project";
import { createMockGenerationBridge } from "./mock-generation-bridge";
import type { GenerationJobUpdate } from "./generation-bridge";

describe("mock generation bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits queued, generating, and succeeded updates with a mock asset URI", async () => {
    const bridge = createMockGenerationBridge({
      jobIdPrefix: "test_job",
      stepMs: 100,
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

    expect(started.jobId).toBe("test_job_1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: "snapshot",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "queued",
        progress: 0,
      },
    });

    await vi.advanceTimersByTimeAsync(400);

    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "snapshot",
      "snapshot",
      "snapshot",
      "succeeded",
    ]);
    expect(updates.at(-1)).toEqual({
      type: "succeeded",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "succeeded",
        progress: 100,
        message: "生成完成",
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z",
      },
      asset: {
        assetId: "mock_voice_001_test_job_1",
        uri: "mock://asset/voice_001/test_job_1",
        duration: 7.5,
      },
    });
  });

  it("emits a deterministic failure when requested", async () => {
    const bridge = createMockGenerationBridge({
      failClipIds: new Set(["sfx_blanket_001"]),
      jobIdPrefix: "test_job",
      stepMs: 100,
    });
    const updates: GenerationJobUpdate[] = [];

    await bridge.generateClip(
      {
        project: demoProject,
        clipId: "sfx_blanket_001",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    await vi.advanceTimersByTimeAsync(400);

    expect(updates.at(-1)).toMatchObject({
      type: "failed",
      error: "Mock generation failed",
      job: {
        jobId: "test_job_1",
        clipId: "sfx_blanket_001",
        status: "failed",
        progress: 100,
      },
    });
  });

  it("emits queued before failed when a clip is missing", async () => {
    const bridge = createMockGenerationBridge({
      jobIdPrefix: "test_job",
      stepMs: 100,
    });
    const updates: GenerationJobUpdate[] = [];

    const started = await bridge.generateClip(
      {
        project: demoProject,
        clipId: "missing_clip",
        reason: "generate",
      },
      (update) => updates.push(update),
    );

    expect(started.jobId).toBe("test_job_1");
    expect(updates.map((update) => update.type)).toEqual([
      "snapshot",
      "failed",
    ]);
    expect(updates[0]).toMatchObject({
      type: "snapshot",
      job: {
        jobId: "test_job_1",
        clipId: "missing_clip",
        status: "queued",
        progress: 0,
      },
    });
    expect(updates[1]).toMatchObject({
      type: "failed",
      error: "Clip not found",
      job: {
        jobId: "test_job_1",
        clipId: "missing_clip",
        status: "failed",
        progress: 100,
      },
    });
  });

  it("can cancel an in-flight job", async () => {
    const bridge = createMockGenerationBridge({
      jobIdPrefix: "test_job",
      stepMs: 100,
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

    await vi.advanceTimersByTimeAsync(100);
    await bridge.cancelGeneration(started.jobId);
    await vi.advanceTimersByTimeAsync(400);

    expect(updates.at(-1)).toMatchObject({
      type: "canceled",
      job: {
        jobId: "test_job_1",
        clipId: "voice_001",
        status: "canceled",
      },
    });
    expect(updates.some((update) => update.type === "succeeded")).toBe(false);
  });
});
