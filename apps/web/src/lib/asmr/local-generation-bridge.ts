import type {
  GenerateClipRequest,
  GeneratedAssetResult,
  GenerationBridge,
  GenerationJobSnapshot,
  GenerationJobUpdate,
} from "./generation-bridge";

export type LocalGenerationBridgeOptions = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  jobIdPrefix?: string;
  now?: () => Date;
};

type InFlightLocalJob = {
  request: GenerateClipRequest;
  createdAt: string;
  onUpdate: (update: GenerationJobUpdate) => void;
  canceled: boolean;
};

function getErrorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

function getAsset(payload: unknown): GeneratedAssetResult {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "asset" in payload &&
    typeof payload.asset === "object" &&
    payload.asset !== null
  ) {
    const asset = payload.asset as Partial<GeneratedAssetResult>;

    if (
      typeof asset.assetId === "string" &&
      typeof asset.uri === "string" &&
      typeof asset.duration === "number"
    ) {
      return {
        assetId: asset.assetId,
        uri: asset.uri,
        duration: asset.duration,
      };
    }
  }

  throw new Error("Invalid generation response");
}

export function createLocalGenerationBridge({
  endpoint = "/api/generation/clip",
  fetchImpl = fetch,
  jobIdPrefix = "local_job",
  now = () => new Date(),
}: LocalGenerationBridgeOptions = {}): GenerationBridge {
  let nextJobNumber = 1;
  const inFlightJobs = new Map<string, InFlightLocalJob>();

  function nowIso() {
    return now().toISOString();
  }

  function makeSnapshot(
    request: GenerateClipRequest,
    jobId: string,
    createdAt: string,
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
      createdAt,
      updatedAt: nowIso(),
    };
  }

  function emit(
    job: InFlightLocalJob,
    update: GenerationJobUpdate,
  ): boolean {
    if (job.canceled && update.type !== "canceled") {
      return false;
    }

    job.onUpdate(update);

    return true;
  }

  return {
    async generateClip(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const createdAt = nowIso();
      const job: InFlightLocalJob = {
        request,
        createdAt,
        onUpdate,
        canceled: false,
      };

      inFlightJobs.set(jobId, job);
      emit(job, {
        type: "snapshot",
        job: makeSnapshot(request, jobId, createdAt, 0, "queued", "等待生成"),
      });
      emit(job, {
        type: "snapshot",
        job: makeSnapshot(
          request,
          jobId,
          createdAt,
          35,
          "generating",
          "生成中",
        ),
      });

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify(request),
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "Generation failed"));
        }

        const asset = getAsset(payload);
        emit(job, {
          type: "succeeded",
          job: makeSnapshot(
            request,
            jobId,
            createdAt,
            100,
            "succeeded",
            "生成完成",
          ),
          asset,
        });
      } catch (error) {
        emit(job, {
          type: "failed",
          job: makeSnapshot(
            request,
            jobId,
            createdAt,
            100,
            "failed",
            "生成失败",
          ),
          error: error instanceof Error ? error.message : "Generation failed",
        });
      } finally {
        inFlightJobs.delete(jobId);
      }

      return { jobId };
    },

    async cancelGeneration(jobId) {
      const job = inFlightJobs.get(jobId);

      if (!job || job.canceled) {
        return;
      }

      job.canceled = true;
      job.onUpdate({
        type: "canceled",
        job: makeSnapshot(
          job.request,
          jobId,
          job.createdAt,
          0,
          "canceled",
          "已取消",
        ),
      });
    },
  };
}
