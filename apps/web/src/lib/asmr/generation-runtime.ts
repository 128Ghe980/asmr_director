import type { GenerationJobSnapshot } from "./generation-bridge";

export type GenerationRuntimeState = {
  jobsById: Record<string, GenerationJobSnapshot>;
  jobIdByClipId: Record<string, string>;
};

export const emptyGenerationRuntimeState: GenerationRuntimeState = {
  jobsById: {},
  jobIdByClipId: {},
};

export function getGenerationJobForClip(
  state: GenerationRuntimeState,
  clipId: string,
): GenerationJobSnapshot | undefined {
  const jobId = state.jobIdByClipId[clipId];

  return jobId ? state.jobsById[jobId] : undefined;
}

export function upsertGenerationJob(
  state: GenerationRuntimeState,
  job: GenerationJobSnapshot,
): GenerationRuntimeState {
  const previousJobId = state.jobIdByClipId[job.clipId];
  const jobsById = { ...state.jobsById };

  if (previousJobId && previousJobId !== job.jobId) {
    delete jobsById[previousJobId];
  }

  jobsById[job.jobId] = job;

  return {
    jobsById,
    jobIdByClipId: {
      ...state.jobIdByClipId,
      [job.clipId]: job.jobId,
    },
  };
}

export function clearGenerationJob(
  state: GenerationRuntimeState,
  jobId: string,
): GenerationRuntimeState {
  const job = state.jobsById[jobId];

  if (!job) {
    return state;
  }

  const jobsById = { ...state.jobsById };
  const jobIdByClipId = { ...state.jobIdByClipId };

  delete jobsById[jobId];
  delete jobIdByClipId[job.clipId];

  return {
    jobsById,
    jobIdByClipId,
  };
}
