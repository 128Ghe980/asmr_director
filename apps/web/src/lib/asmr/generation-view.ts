import { getProjectPreviewSummary } from "./generation-summary";
import type {
  GenerationSlotTone,
  ProjectPreviewSummary,
} from "./generation-summary";
import type { GenerationJobSnapshot } from "./generation-bridge";
import { isCurrentProjectMixFingerprint } from "./generation-fingerprint";
import type { GenerationRuntimeState } from "./generation-runtime";
import {
  getGenerationJobForClip,
  getGenerationJobForProjectMix,
  isActiveGenerationJob,
} from "./generation-runtime";
import {
  isLocalClipAssetUri,
  isLocalMixAssetUri,
} from "./playback-asset-resolver";
import { isMockAssetUri } from "./mock-asset-resolver";
import {
  canGenerateProjectMix,
  getMissingProjectMixClipIds,
  getWavExport,
} from "./project-mix-state";
import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";
import { flattenClips } from "./view-model";

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

export type ProjectMixGenerationAction =
  | "mix"
  | "remix"
  | "retry"
  | "cancel"
  | "none";

export type ProjectMixControl = {
  action: ProjectMixGenerationAction;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  statusLabel: string;
  tone: GenerationSlotTone;
  progress?: number;
  jobId?: string;
  canPlay: boolean;
  playLabel: "试听";
  canDownload: boolean;
  downloadLabel: "WAV";
  uri?: string;
};

export type GenerationView = {
  displayProject: AsmrProject;
  displaySelectedClip?: TimelineClip;
  preview: ProjectPreviewSummary;
  selectedClipControl: SelectedClipGenerationControl;
  selectedClipPreview: SelectedClipPreview;
  projectMixControl: ProjectMixControl;
};

type GenerationViewInput = {
  project: AsmrProject;
  selectedClip: TimelineClip | undefined;
  runtimeState: GenerationRuntimeState;
  selectedClipHasValidationIssues: boolean;
  projectMixFingerprint?: string;
};

function cloneProjectWithRuntimeJobs(
  project: AsmrProject,
  runtimeState: GenerationRuntimeState,
): AsmrProject {
  const tracks = project.timeline.tracks.map((track) => {
    const clips = (track.clips as TimelineClip[]).map((clip) => {
      const job = getGenerationJobForClip(runtimeState, clip.id);

      if (!job || !isActiveGenerationJob(job)) {
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
    statusLabel: isCanceling ? "取消中" : job.message || "生成中",
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

  if (selectedClip.type === "voice" && selectedClip.kind === "silent") {
    return { action: "none", label: "无对白", disabled: true, statusLabel: "无对白", tone: "neutral", disabledReason: "无对白镜头无需语音" };
  }
  if (job && isActiveGenerationJob(job)) {
    return getRuntimeControl(job);
  }

  const disabled = selectedClipHasValidationIssues;
  const disabledReason = disabled ? "先修正片段" : undefined;
  if (selectedClip.type === "voice" && selectedClip.audio_stale && (selectedClip.asset.asset_id || selectedClip.asset.uri)) {
    return { action: "regenerate", label: "重生成", disabled, disabledReason, statusLabel: "音频待更新", tone: "warn" };
  }

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
  if (selectedClip?.type === "voice" && selectedClip.kind === "silent") return { canPlay: false, label: "无对白镜头" };
  if (!selectedClip?.asset.uri) {
    return {
      canPlay: false,
      label: "暂无音频",
    };
  }

  if (
    !isMockAssetUri(selectedClip.asset.uri) &&
    !isLocalClipAssetUri(selectedClip.asset.uri)
  ) {
    return {
      canPlay: false,
      label: "暂无音频",
      uri: selectedClip.asset.uri,
    };
  }

  return {
    canPlay: true,
    label: "播放片段",
    uri: selectedClip.asset.uri,
  };
}

function isPlayableProjectMixUri(uri: string | null | undefined): boolean {
  return Boolean(uri && (isLocalMixAssetUri(uri) || isMockAssetUri(uri)));
}

function getProjectMixRuntimeControl(
  job: GenerationJobSnapshot,
): ProjectMixControl {
  const isCanceling = job.status === "canceling";

  return {
    action: "cancel",
    label: "取消",
    disabled: isCanceling,
    disabledReason: isCanceling ? "正在取消" : undefined,
    statusLabel: isCanceling ? "取消中" : "混音中",
    tone: "accent",
    progress: job.progress,
    jobId: job.jobId,
    canPlay: false,
    playLabel: "试听",
    canDownload: false,
    downloadLabel: "WAV",
  };
}

function getProjectMixControl({
  project,
  job,
  projectMixFingerprint,
}: {
  project: AsmrProject;
  job: GenerationJobSnapshot | undefined;
  projectMixFingerprint: string | undefined;
}): ProjectMixControl {
  if (job && isActiveGenerationJob(job)) {
    return getProjectMixRuntimeControl(job);
  }

  const wavExport = getWavExport(project);
  const uri = wavExport?.uri ?? undefined;
  const canPlay = isPlayableProjectMixUri(uri);
  const canDownload = Boolean(uri && isLocalMixAssetUri(uri));
  const missingClipIds = getMissingProjectMixClipIds(project);
  const canMix =
    canGenerateProjectMix(project) && flattenClips(project).length > 0;
  const disabledReason =
    missingClipIds.length > 0
      ? `还缺 ${missingClipIds.length} 个片段`
      : undefined;

  if (wavExport?.status === "exported" && uri) {
    const isStale =
      !projectMixFingerprint ||
      !isCurrentProjectMixFingerprint(project, projectMixFingerprint);

    return {
      action: "remix",
      label: "重混",
      disabled: !canMix,
      disabledReason: canMix ? undefined : disabledReason,
      statusLabel: isStale ? "需重混" : "可试听",
      tone: isStale ? "warn" : "ok",
      canPlay,
      playLabel: "试听",
      canDownload,
      downloadLabel: "WAV",
      uri,
    };
  }

  if (wavExport?.status === "export_failed") {
    return {
      action: "retry",
      label: "重试",
      disabled: !canMix,
      disabledReason: canMix ? undefined : disabledReason,
      statusLabel: "混音失败",
      tone: "warn",
      canPlay,
      playLabel: "试听",
      canDownload,
      downloadLabel: "WAV",
      uri,
    };
  }

  if (canMix) {
    return {
      action: "mix",
      label: "生成整段",
      disabled: false,
      statusLabel: "可混音",
      tone: "accent",
      canPlay: false,
      playLabel: "试听",
      canDownload: false,
      downloadLabel: "WAV",
    };
  }

  return {
    action: "none",
    label: "生成整段",
    disabled: true,
    disabledReason: disabledReason ?? "暂无片段",
    statusLabel: missingClipIds.length > 0 ? "等待素材" : "无片段",
    tone: "neutral",
    canPlay,
    playLabel: "试听",
    canDownload,
    downloadLabel: "WAV",
    uri,
  };
}

export function getGenerationView({
  project,
  selectedClip,
  runtimeState,
  selectedClipHasValidationIssues,
  projectMixFingerprint,
}: GenerationViewInput): GenerationView {
  const displayProject = cloneProjectWithRuntimeJobs(project, runtimeState);
  const displaySelectedClip = selectedClip
    ? flattenClips(displayProject).find((clip) => clip.id === selectedClip.id)
    : undefined;
  const selectedClipJob = selectedClip
    ? getGenerationJobForClip(runtimeState, selectedClip.id)
    : undefined;
  const projectMixJob = getGenerationJobForProjectMix(runtimeState, "wav");

  return {
    displayProject,
    displaySelectedClip,
    preview: getProjectPreviewSummary({
      project: displayProject,
      selectedClip: displaySelectedClip,
      projectMixJob,
      projectMixFingerprint,
    }),
    selectedClipControl: getSelectedClipControl({
      selectedClip,
      job: selectedClipJob,
      selectedClipHasValidationIssues,
    }),
    selectedClipPreview: getSelectedClipPreview(selectedClip),
    projectMixControl: getProjectMixControl({
      project,
      job: projectMixJob,
      projectMixFingerprint,
    }),
  };
}
