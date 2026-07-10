import { describe, expect, it } from "vitest";

import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  getGenerationJobForClip,
  getGenerationJobForProjectMix,
  markGenerationJobCanceling,
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

const projectMixJob: GenerationJobSnapshot = {
  jobId: "mix_job_1",
  clipId: "project_mix:wav",
  target: { type: "project_mix", exportType: "wav" },
  status: "generating",
  progress: 25,
  message: "Mixing",
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

  it("marks only the requested active job as canceling", () => {
    const otherJob: GenerationJobSnapshot = {
      ...job,
      jobId: "job_2",
      clipId: "voice_002",
      progress: 12,
    };
    const state = upsertGenerationJob(
      upsertGenerationJob(emptyGenerationRuntimeState, job),
      otherJob,
    );

    const canceling = markGenerationJobCanceling(state, "job_1");

    expect(canceling.jobsById.job_1).toMatchObject({
      status: "canceling",
      progress: 42,
    });
    expect(canceling.jobsById.job_2).toEqual(otherJob);
    expect(canceling.jobIdByClipId).toEqual(state.jobIdByClipId);
  });

  it("tracks project mix jobs separately from clip jobs", () => {
    const state = upsertGenerationJob(
      upsertGenerationJob(emptyGenerationRuntimeState, job),
      projectMixJob,
    );

    expect(getGenerationJobForClip(state, "voice_001")).toEqual(job);
    expect(getGenerationJobForClip(state, "project_mix:wav")).toBeUndefined();
    expect(getGenerationJobForProjectMix(state, "wav")).toEqual(projectMixJob);
  });

  it("replaces and clears project mix jobs by export type", () => {
    const first = upsertGenerationJob(emptyGenerationRuntimeState, projectMixJob);
    const secondJob: GenerationJobSnapshot = {
      ...projectMixJob,
      jobId: "mix_job_2",
      progress: 68,
    };
    const second = upsertGenerationJob(first, secondJob);
    const cleared = clearGenerationJob(second, "mix_job_2");

    expect(second.jobsById.mix_job_1).toBeUndefined();
    expect(getGenerationJobForProjectMix(second, "wav")).toEqual(secondJob);
    expect(getGenerationJobForProjectMix(cleared, "wav")).toBeUndefined();
  });

  it("marks project mix jobs as canceling without changing clip mappings", () => {
    const state = upsertGenerationJob(
      upsertGenerationJob(emptyGenerationRuntimeState, job),
      projectMixJob,
    );
    const canceling = markGenerationJobCanceling(state, "mix_job_1");

    expect(getGenerationJobForProjectMix(canceling, "wav")).toMatchObject({
      status: "canceling",
      progress: 25,
    });
    expect(getGenerationJobForClip(canceling, "voice_001")).toEqual(job);
  });
});
