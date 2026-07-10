import type {
  GenerationJobSnapshot,
  GenerationJobTarget,
  ProjectMixExportType,
} from "./generation-bridge";

export type GenerationRuntimeState = {
  jobsById: Record<string, GenerationJobSnapshot>;
  jobIdByClipId: Record<string, string>;
  jobIdByProjectMixExportType: Partial<Record<ProjectMixExportType, string>>;
};

export const emptyGenerationRuntimeState: GenerationRuntimeState = {
  jobsById: {},
  jobIdByClipId: {},
  jobIdByProjectMixExportType: {},
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
  const job = jobId ? state.jobsById[jobId] : undefined;

  return job && getGenerationJobTarget(job).type === "clip" ? job : undefined;
}

export function getGenerationJobForProjectMix(
  state: GenerationRuntimeState,
  exportType: ProjectMixExportType,
): GenerationJobSnapshot | undefined {
  const jobId = state.jobIdByProjectMixExportType[exportType];
  const job = jobId ? state.jobsById[jobId] : undefined;

  return job && getGenerationJobTarget(job).type === "project_mix"
    ? job
    : undefined;
}

function getGenerationJobTarget(job: GenerationJobSnapshot): GenerationJobTarget {
  return job.target ?? { type: "clip", clipId: job.clipId };
}

export function upsertGenerationJob(
  state: GenerationRuntimeState,
  job: GenerationJobSnapshot,
): GenerationRuntimeState {
  const target = getGenerationJobTarget(job);
  const previousJobId =
    target.type === "clip"
      ? state.jobIdByClipId[target.clipId]
      : state.jobIdByProjectMixExportType[target.exportType];
  const jobsById = { ...state.jobsById };
  const jobIdByClipId = { ...state.jobIdByClipId };
  const jobIdByProjectMixExportType = {
    ...state.jobIdByProjectMixExportType,
  };

  if (previousJobId && previousJobId !== job.jobId) {
    delete jobsById[previousJobId];
  }

  for (const [clipId, mappedJobId] of Object.entries(jobIdByClipId)) {
    if (clipId !== job.clipId && mappedJobId === job.jobId) {
      delete jobIdByClipId[clipId];
    }
  }

  for (const [exportType, mappedJobId] of Object.entries(
    jobIdByProjectMixExportType,
  )) {
    if (
      (target.type !== "project_mix" || exportType !== target.exportType) &&
      mappedJobId === job.jobId
    ) {
      delete jobIdByProjectMixExportType[exportType as ProjectMixExportType];
    }
  }

  jobsById[job.jobId] = job;

  if (target.type === "clip") {
    jobIdByClipId[target.clipId] = job.jobId;
  } else {
    jobIdByProjectMixExportType[target.exportType] = job.jobId;
  }

  return {
    jobsById,
    jobIdByClipId,
    jobIdByProjectMixExportType,
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
  const jobIdByProjectMixExportType = {
    ...state.jobIdByProjectMixExportType,
  };
  const target = getGenerationJobTarget(job);

  delete jobsById[jobId];

  if (target.type === "clip") {
    delete jobIdByClipId[target.clipId];
  } else {
    delete jobIdByProjectMixExportType[target.exportType];
  }

  return {
    jobsById,
    jobIdByClipId,
    jobIdByProjectMixExportType,
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
    jobIdByProjectMixExportType: state.jobIdByProjectMixExportType,
  };
}
