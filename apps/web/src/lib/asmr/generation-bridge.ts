import type { AsmrProject } from "./schema";
import type { AudioCandidate } from "./audio-candidate";
import type { VoiceGenerationOptions } from "./voice-generation-options";

export type GenerateClipReason = "generate" | "regenerate" | "retry";
export type GenerateProjectMixReason = "mix" | "remix" | "retry";
export type ProjectMixExportType = "wav";

export type GenerationJobTarget =
  | { type: "clip"; clipId: string }
  | { type: "project_mix"; exportType: ProjectMixExportType };

export type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: GenerateClipReason;
  voiceOptions?: VoiceGenerationOptions;
};

export type GenerateProjectMixRequest = {
  project: AsmrProject;
  exportType: ProjectMixExportType;
  reason: GenerateProjectMixReason;
};

export type GeneratedAssetResult = {
  assetId: string;
  uri: string;
  duration: number;
};

export type GenerationRuntimeStatus =
  | "queued"
  | "generating"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

export type GenerationJobSnapshot = {
  jobId: string;
  clipId: string;
  target?: GenerationJobTarget;
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type GenerationJobUpdate =
  | { type: "snapshot"; job: GenerationJobSnapshot }
  | { type: "candidate"; job: GenerationJobSnapshot; candidate: AudioCandidate }
  | {
      type: "succeeded";
      job: GenerationJobSnapshot;
      asset: GeneratedAssetResult;
    }
  | { type: "failed"; job: GenerationJobSnapshot; error: string }
  | { type: "canceled"; job: GenerationJobSnapshot };

export interface GenerationBridge {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;
  generateProjectMix(
    request: GenerateProjectMixRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;
  cancelGeneration(jobId: string): Promise<void>;
}
