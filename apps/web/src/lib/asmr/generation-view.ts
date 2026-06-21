import { getProjectPreviewSummary } from "./generation-summary";
import type {
  GenerationSlotTone,
  ProjectPreviewSummary,
} from "./generation-summary";
import type { GenerationJobSnapshot } from "./generation-bridge";
import type { GenerationRuntimeState } from "./generation-runtime";
import { getGenerationJobForClip } from "./generation-runtime";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";

export type SelectedClipGenerationAction =
  | "generate"
  | "regenerate"
  | "retry"
  | "cancel"
  | "none";

export type SelectedClipGenerationControl = {
  action: SelectedClipGenerationAction;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  statusLabel: string;
  tone: GenerationSlotTone;
  progress?: number;
  error?: string;
  jobId?: string;
};

export type SelectedClipPreview = {
  canPlay: boolean;
  label: string;
  uri?: string;
};

export type GenerationView = {
  preview: ProjectPreviewSummary;
  selectedClipControl: SelectedClipGenerationControl;
  selectedClipPreview: SelectedClipPreview;
};

type GenerationViewInput = {
  project: AsmrProject;
  selectedClip: TimelineClip | undefined;
  runtimeState: GenerationRuntimeState;
  selectedClipHasValidationIssues: boolean;
};

function cloneProjectWithRuntimeJobs(
  project: AsmrProject,
  runtimeState: GenerationRuntimeState,
): AsmrProject {
  const tracks = project.timeline.tracks.map((track) => {
    const clips = (track.clips as TimelineClip[]).map((clip) => {
      const job = getGenerationJobForClip(runtimeState, clip.id);

      if (!job || job.status === "failed" || job.status === "canceled") {
        return clip;
      }

      return {
        ...clip,
        generation: {
          ...clip.generation,
          status: "asset_generating" as const,
        },
      };
    });

    return { ...track, clips } as TimelineTrack;
  });

  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks,
    },
  };
}

function getRuntimeControl(
  job: GenerationJobSnapshot,
): SelectedClipGenerationControl {
  const isCanceling = job.status === "canceling";

  return {
    action: "cancel",
    label: "取消",
    disabled: isCanceling,
    disabledReason: isCanceling ? "正在取消" : undefined,
    statusLabel: isCanceling ? "取消中" : "生成中",
    tone: "accent",
    progress: job.progress,
    jobId: job.jobId,
  };
}

function getSelectedClipControl({
  selectedClip,
  job,
  selectedClipHasValidationIssues,
}: {
  selectedClip: TimelineClip | undefined;
  job: GenerationJobSnapshot | undefined;
  selectedClipHasValidationIssues: boolean;
}): SelectedClipGenerationControl {
  if (!selectedClip) {
    return {
      action: "none",
      label: "无片段",
      disabled: true,
      disabledReason: "未选择片段",
      statusLabel: "无片段",
      tone: "neutral",
    };
  }

  if (job && job.status !== "failed" && job.status !== "canceled") {
    return getRuntimeControl(job);
  }

  const disabled = selectedClipHasValidationIssues;
  const disabledReason = disabled ? "先修正片段" : undefined;

  if (selectedClip.generation.status === "asset_failed") {
    return {
      action: "retry",
      label: "重试",
      disabled,
      disabledReason,
      statusLabel: "失败",
      tone: "warn",
      error: selectedClip.generation.error ?? undefined,
    };
  }

  if (
    selectedClip.generation.status === "asset_generated" ||
    selectedClip.asset.asset_id ||
    selectedClip.asset.uri
  ) {
    return {
      action: "regenerate",
      label: "重生成",
      disabled,
      disabledReason,
      statusLabel: "可预览",
      tone: "ok",
    };
  }

  return {
    action: "generate",
    label: "生成",
    disabled,
    disabledReason,
    statusLabel: "待生成",
    tone: "neutral",
  };
}

function getSelectedClipPreview(
  selectedClip: TimelineClip | undefined,
): SelectedClipPreview {
  if (!selectedClip?.asset.uri) {
    return {
      canPlay: false,
      label: "暂无音频",
    };
  }

  return {
    canPlay: true,
    label: "播放片段",
    uri: selectedClip.asset.uri,
  };
}

export function getGenerationView({
  project,
  selectedClip,
  runtimeState,
  selectedClipHasValidationIssues,
}: GenerationViewInput): GenerationView {
  const displayProject = cloneProjectWithRuntimeJobs(project, runtimeState);
  const displaySelectedClip = selectedClip
    ? displayProject.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedClip.id)
    : undefined;
  const selectedClipJob = selectedClip
    ? getGenerationJobForClip(runtimeState, selectedClip.id)
    : undefined;

  return {
    preview: getProjectPreviewSummary({
      project: displayProject,
      selectedClip: displaySelectedClip,
    }),
    selectedClipControl: getSelectedClipControl({
      selectedClip,
      job: selectedClipJob,
      selectedClipHasValidationIssues,
    }),
    selectedClipPreview: getSelectedClipPreview(selectedClip),
  };
}
