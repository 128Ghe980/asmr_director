import type { AsmrProject } from "./schema";

export type GenerateClipReason = "generate" | "regenerate" | "retry";

export type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: GenerateClipReason;
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
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type GenerationJobUpdate =
  | { type: "snapshot"; job: GenerationJobSnapshot }
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
  cancelGeneration(jobId: string): Promise<void>;
}
