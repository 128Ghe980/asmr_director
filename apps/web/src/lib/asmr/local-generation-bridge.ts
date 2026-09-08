import type {
  GenerateClipRequest,
  GenerateProjectMixRequest,
  GeneratedAssetResult,
  GenerationBridge,
  GenerationJobSnapshot,
  GenerationJobUpdate,
} from "./generation-bridge";
import { AudioCandidateSchema, getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { flattenClips } from "./view-model";

export type LocalGenerationBridgeOptions = {
  endpoint?: string;
  mixEndpoint?: string;
  fetchImpl?: typeof fetch;
  jobIdPrefix?: string;
  now?: () => Date;
  timeoutMs?: number;
};

type LocalGenerationRequest = GenerateClipRequest | GenerateProjectMixRequest;

type InFlightLocalJob = {
  request: LocalGenerationRequest;
  createdAt: string;
  onUpdate: (update: GenerationJobUpdate) => void;
  canceled: boolean;
  controller: AbortController;
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

function isProjectMixRequest(
  request: LocalGenerationRequest,
): request is GenerateProjectMixRequest {
  return "exportType" in request;
}

function getSnapshotClipId(request: LocalGenerationRequest): string {
  return isProjectMixRequest(request)
    ? `project_mix:${request.exportType}`
    : request.clipId;
}

export function createLocalGenerationBridge({
  endpoint = "/api/generation/clip",
  mixEndpoint = "/api/generation/mix",
  fetchImpl = fetch,
  jobIdPrefix = "local_job",
  now = () => new Date(),
  timeoutMs = 15 * 60 * 1000,
}: LocalGenerationBridgeOptions = {}): GenerationBridge {
  let nextJobNumber = 1;
  const inFlightJobs = new Map<string, InFlightLocalJob>();

  function nowIso() {
    return now().toISOString();
  }

  function makeSnapshot(
    request: LocalGenerationRequest,
    jobId: string,
    createdAt: string,
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
        controller: new AbortController(),
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

      const timer = setTimeout(() => job.controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify(request),
          signal: job.controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "Generation failed"));
        }

        if (typeof payload === "object" && payload !== null && "candidate" in payload) {
          const candidate = AudioCandidateSchema.parse(payload.candidate);
          const voice = flattenClips(request.project).find((item) => item.id === request.clipId);
          if (candidate.projectId !== request.project.project_id || candidate.clipId !== request.clipId ||
              request.voiceOptions?.provider !== "voxcpm2" || candidate.status !== "ready" ||
              voice?.type !== "voice" || candidate.sourceFingerprint !== getVoiceCandidateSourceFingerprint(voice) ||
              candidate.requestFingerprint !== getVoiceCandidateRequestFingerprint(voice, request.voiceOptions) ||
              candidate.provenance.voicePackId !== request.voiceOptions.voicePackId ||
              candidate.provenance.referenceMode !== request.voiceOptions.referenceMode) {
            throw new Error("候选与本次生成请求不匹配，请重试。");
          }
          emit(job, {
            type: "candidate", candidate,
            job: makeSnapshot(request, jobId, createdAt, 100, "succeeded", "候选已生成"),
          });
          return { jobId };
        }
        if (request.voiceOptions?.provider === "voxcpm2") {
          throw new Error("未收到音频候选，请重试。");
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
          error: job.controller.signal.aborted ? "生成超时，请重试。" : error instanceof Error ? error.message : "Generation failed",
        });
      } finally {
        clearTimeout(timer);
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
      job.controller.abort();
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

    async generateProjectMix(request, onUpdate) {
      const jobId = `${jobIdPrefix}_${nextJobNumber}`;
      nextJobNumber += 1;
      const createdAt = nowIso();
      const job: InFlightLocalJob = {
        request,
        createdAt,
        onUpdate,
        canceled: false,
        controller: new AbortController(),
      };

      inFlightJobs.set(jobId, job);
      emit(job, {
        type: "snapshot",
        job: makeSnapshot(request, jobId, createdAt, 0, "queued", "Mix queued"),
      });
      emit(job, {
        type: "snapshot",
        job: makeSnapshot(
          request,
          jobId,
          createdAt,
          65,
          "generating",
          "Mixing",
        ),
      });

      try {
        const response = await fetchImpl(mixEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify(request),
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "Project mix failed"));
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
            "Mix complete",
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
            "Mix failed",
          ),
          error:
            error instanceof Error ? error.message : "Project mix failed",
        });
      } finally {
        inFlightJobs.delete(jobId);
      }

      return { jobId };
    },
  };
}
