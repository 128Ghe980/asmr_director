import type {
  GenerateClipRequest,
  GenerateProjectMixRequest,
  GenerationBridge,
  GenerationJobSnapshot,
  GenerationJobUpdate,
} from "./generation-bridge";
import { flattenClips } from "./view-model";

type MockGenerationBridgeOptions = {
  failClipIds?: ReadonlySet<string>;
  jobIdPrefix?: string;
  stepMs?: number;
};

type MockGenerationRequest = GenerateClipRequest | GenerateProjectMixRequest;

type InFlightJob = {
  request: MockGenerationRequest;
  onUpdate: (update: GenerationJobUpdate) => void;
  createdAt: string;
  timers: ReturnType<typeof setTimeout>[];
};

const defaultProgressSteps = [18, 42, 76, 100];

function isProjectMixRequest(
  request: MockGenerationRequest,
): request is GenerateProjectMixRequest {
  return "exportType" in request;
}

function getSnapshotClipId(request: MockGenerationRequest): string {
  return isProjectMixRequest(request)
    ? `project_mix:${request.exportType}`
    : request.clipId;
}

export function createMockGenerationBridge({
  failClipIds = new Set<string>(),
  jobIdPrefix = "mock_job",
  stepMs = 350,
}: MockGenerationBridgeOptions = {}): GenerationBridge {
  let nextJobNumber = 1;
  const inFlightJobs = new Map<string, InFlightJob>();

  function now() {
    return new Date().toISOString();
  }

  function makeSnapshot(
    request: MockGenerationRequest,
    jobId: string,
    createdAt: string,
    updatedAt: string,
    progress: number,
    status: GenerationJobSnapshot["status"],
    message: string,
  ): GenerationJobSnapshot {
    const projectMixTarget = isProjectMixRequest(request)
      ? {
          target: {
            type: "project_mix" as const,
            exportType: request.exportType,
          },
        }
      : {};

    return {
      jobId,
      clipId: getSnapshotClipId(request),
      ...projectMixTarget,
      status,
      progress,
      message,
      createdAt,
      updatedAt,
    };
  }

  function emitCanceled(
    request: MockGenerationRequest,
    jobId: string,
    createdAt: string,
    onUpdate: (update: GenerationJobUpdate) => void,
  ) {
    onUpdate({
      type: "canceled",
      job: makeSnapshot(
        request,
        jobId,
        createdAt,
        now(),
        0,
        "canceled",
        "已取消",
      ),
    });
  }

  return {
    async generateClip(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const createdAt = now();
      const clip = flattenClips(request.project).find(
        (candidate) => candidate.id === request.clipId,
      );

      onUpdate({
        type: "snapshot",
        job: makeSnapshot(
          request,
          jobId,
          createdAt,
          createdAt,
          0,
          "queued",
          "等待生成",
        ),
      });

      if (!clip) {
        const failedJob = makeSnapshot(
          request,
          jobId,
          createdAt,
          now(),
          100,
          "failed",
          "片段不存在",
        );
        onUpdate({
          type: "failed",
          job: failedJob,
          error: "Clip not found",
        });
        return { jobId };
      }

      const inFlightJob: InFlightJob = {
        request,
        onUpdate,
        createdAt,
        timers: [],
      };

      inFlightJobs.set(jobId, inFlightJob);

      defaultProgressSteps.forEach((progress, index) => {
        const timer = setTimeout(() => {
          if (!inFlightJobs.has(jobId)) {
            return;
          }

          if (progress < 100) {
            onUpdate({
              type: "snapshot",
              job: makeSnapshot(
                request,
                jobId,
                createdAt,
                now(),
                progress,
                "generating",
                "生成中",
              ),
            });
            return;
          }

          if (failClipIds.has(request.clipId)) {
            onUpdate({
              type: "failed",
              job: makeSnapshot(
                request,
                jobId,
                createdAt,
                now(),
                100,
                "failed",
                "生成失败",
              ),
              error: "Mock generation failed",
            });
            inFlightJobs.delete(jobId);
            return;
          }

          onUpdate({
            type: "succeeded",
            job: makeSnapshot(
              request,
              jobId,
              createdAt,
              now(),
              100,
              "succeeded",
              "生成完成",
            ),
            asset: {
              assetId: `mock_${request.clipId}_${jobId}`,
              uri: `mock://asset/${request.clipId}/${jobId}`,
              duration: clip.duration,
            },
          });
          inFlightJobs.delete(jobId);
        }, stepMs * (index + 1));

        inFlightJob.timers.push(timer);
      });

      return { jobId };
    },

    async generateProjectMix(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const createdAt = now();

      onUpdate({
        type: "snapshot",
        job: makeSnapshot(
          request,
          jobId,
          createdAt,
          createdAt,
          0,
          "queued",
          "Mix queued",
        ),
      });

      const inFlightJob: InFlightJob = {
        request,
        onUpdate,
        createdAt,
        timers: [],
      };

      inFlightJobs.set(jobId, inFlightJob);

      defaultProgressSteps.forEach((progress, index) => {
        const timer = setTimeout(() => {
          if (!inFlightJobs.has(jobId)) {
            return;
          }

          if (progress < 100) {
            onUpdate({
              type: "snapshot",
              job: makeSnapshot(
                request,
                jobId,
                createdAt,
                now(),
                progress,
                "generating",
                "Mixing",
              ),
            });
            return;
          }

          onUpdate({
            type: "succeeded",
            job: makeSnapshot(
              request,
              jobId,
              createdAt,
              now(),
              100,
              "succeeded",
              "Mix complete",
            ),
            asset: {
              assetId: `mock_project_mix_${jobId}`,
              uri: `mock://asset/project_mix/${jobId}`,
              duration: request.project.duration,
            },
          });
          inFlightJobs.delete(jobId);
        }, stepMs * (index + 1));

        inFlightJob.timers.push(timer);
      });

      return { jobId };
    },

    async cancelGeneration(jobId) {
      const inFlightJob = inFlightJobs.get(jobId);

      if (!inFlightJob) {
        return;
      }

      inFlightJob.timers.forEach((timer) => clearTimeout(timer));
      emitCanceled(
        inFlightJob.request,
        jobId,
        inFlightJob.createdAt,
        inFlightJob.onUpdate,
      );
      inFlightJobs.delete(jobId);
    },
  };
}
