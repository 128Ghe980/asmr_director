import { describe, expect, it } from "vitest";

import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  getGenerationJobForClip,
  upsertGenerationJob,
} from "./generation-runtime";
import type { GenerationJobSnapshot } from "./generation-bridge";

const job: GenerationJobSnapshot = {
  jobId: "job_1",
  clipId: "voice_001",
  status: "generating",
  progress: 42,
  message: "生成中",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:01.000Z",
};

describe("generation runtime state", () => {
  it("upserts and looks up jobs by clip id", () => {
    const state = upsertGenerationJob(emptyGenerationRuntimeState, job);

    expect(state).not.toBe(emptyGenerationRuntimeState);
    expect(getGenerationJobForClip(state, "voice_001")).toEqual(job);
    expect(getGenerationJobForClip(state, "voice_002")).toBeUndefined();
  });

  it("replaces the previous job for the same clip", () => {
    const first = upsertGenerationJob(emptyGenerationRuntimeState, job);
    const secondJob = {
      ...job,
      jobId: "job_2",
      progress: 76,
    };
    const second = upsertGenerationJob(first, secondJob);

    expect(second.jobsById.job_1).toBeUndefined();
    expect(second.jobsById.job_2).toEqual(secondJob);
    expect(second.jobIdByClipId.voice_001).toBe("job_2");
  });

  it("removes stale clip mappings when the same job id moves clips", () => {
    const first = upsertGenerationJob(emptyGenerationRuntimeState, job);
    const movedJob = {
      ...job,
      clipId: "voice_002",
      progress: 64,
    };
    const second = upsertGenerationJob(first, movedJob);

    expect(second.jobsById.job_1).toEqual(movedJob);
    expect(second.jobIdByClipId.voice_001).toBeUndefined();
    expect(second.jobIdByClipId.voice_002).toBe("job_1");
    expect(getGenerationJobForClip(second, "voice_001")).toBeUndefined();
    expect(getGenerationJobForClip(second, "voice_002")).toEqual(movedJob);
  });

  it("clears jobs by job id", () => {
    const state = upsertGenerationJob(emptyGenerationRuntimeState, job);
    const cleared = clearGenerationJob(state, "job_1");

    expect(cleared.jobsById).toEqual({});
    expect(cleared.jobIdByClipId).toEqual({});
  });
});
