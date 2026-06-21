import type {
  GenerateClipRequest,
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

type InFlightJob = {
  cancelled: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

const defaultProgressSteps = [18, 42, 76, 100];

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
    request: GenerateClipRequest,
    jobId: string,
    timestamp: string,
    progress: number,
    status: GenerationJobSnapshot["status"],
    message: string,
  ): GenerationJobSnapshot {
    return {
      jobId,
      clipId: request.clipId,
      status,
      progress,
      message,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function emitCanceled(
    request: GenerateClipRequest,
    jobId: string,
    timestamp: string,
    onUpdate: (update: GenerationJobUpdate) => void,
  ) {
    onUpdate({
      type: "canceled",
      job: makeSnapshot(request, jobId, timestamp, 0, "canceled", "已取消"),
    });
  }

  return {
    async generateClip(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const timestamp = now();
      const inFlightJob: InFlightJob = {
        cancelled: false,
        timers: [],
      };
      const clip = flattenClips(request.project).find(
        (candidate) => candidate.id === request.clipId,
      );

      onUpdate({
        type: "snapshot",
        job: makeSnapshot(request, jobId, timestamp, 0, "queued", "等待生成"),
      });

      if (!clip) {
        const failedJob = makeSnapshot(
          request,
          jobId,
          timestamp,
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

      inFlightJobs.set(jobId, inFlightJob);

      defaultProgressSteps.forEach((progress, index) => {
        const timer = setTimeout(() => {
          if (inFlightJob.cancelled) {
            if (inFlightJobs.has(jobId)) {
              emitCanceled(request, jobId, timestamp, onUpdate);
              inFlightJobs.delete(jobId);
            }
            return;
          }

          if (progress < 100) {
            onUpdate({
              type: "snapshot",
              job: makeSnapshot(
                request,
                jobId,
                timestamp,
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
                timestamp,
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
              timestamp,
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

    async cancelGeneration(jobId) {
      const inFlightJob = inFlightJobs.get(jobId);

      if (!inFlightJob) {
        return;
      }

      inFlightJob.cancelled = true;
    },
  };
}
