import type { GenerationJobSnapshot } from "./generation-bridge";

export type GenerationRuntimeState = {
  jobsById: Record<string, GenerationJobSnapshot>;
  jobIdByClipId: Record<string, string>;
};

export const emptyGenerationRuntimeState: GenerationRuntimeState = {
  jobsById: {},
  jobIdByClipId: {},
};

export function isActiveGenerationJob(job: GenerationJobSnapshot): boolean {
  return (
    job.status === "queued" ||
    job.status === "generating" ||
    job.status === "canceling"
  );
}

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
  const jobIdByClipId = { ...state.jobIdByClipId };

  if (previousJobId && previousJobId !== job.jobId) {
    delete jobsById[previousJobId];
  }

  for (const [clipId, mappedJobId] of Object.entries(jobIdByClipId)) {
    if (clipId !== job.clipId && mappedJobId === job.jobId) {
      delete jobIdByClipId[clipId];
    }
  }

  jobsById[job.jobId] = job;
  jobIdByClipId[job.clipId] = job.jobId;

  return {
    jobsById,
    jobIdByClipId,
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

export function markGenerationJobCanceling(
  state: GenerationRuntimeState,
  jobId: string,
): GenerationRuntimeState {
  const job = state.jobsById[jobId];

  if (!job || !isActiveGenerationJob(job) || job.status === "canceling") {
    return state;
  }

  return {
    jobsById: {
      ...state.jobsById,
      [jobId]: {
        ...job,
        status: "canceling",
        message: "正在取消",
      },
    },
    jobIdByClipId: state.jobIdByClipId,
  };
}
