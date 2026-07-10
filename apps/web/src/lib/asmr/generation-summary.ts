import type { AsmrProject, AssetStatus, TimelineClip, TrackType } from "./schema";
import type { GenerationJobSnapshot } from "./generation-bridge";
import {
  canGenerateProjectMix,
  getMissingProjectMixClipIds,
  getWavExport,
} from "./project-mix-state";
import { isCurrentProjectMixFingerprint } from "./generation-fingerprint";
import { isActiveGenerationJob } from "./generation-runtime";
import { isMockAssetUri } from "./mock-asset-resolver";
import { getTrackLabel } from "./ui-copy";
import { flattenClips, formatSeconds, formatTimeRange } from "./view-model";

export type GenerationSlotTone = "neutral" | "accent" | "ok" | "warn";

type AssetStatusDisplay = {
  statusLabel: string;
  tone: GenerationSlotTone;
};

export type GenerationSlot = AssetStatusDisplay & {
  id: "project_mix" | "selected_clip" | PreviewTrackType;
  label: string;
  detail: string;
  clipCount: number;
};

type PreviewTrackType = Exclude<TrackType, "post_processing">;

type ProjectPreviewSummaryInput = {
  project: AsmrProject;
  selectedClip?: TimelineClip;
  projectMixJob?: GenerationJobSnapshot;
  projectMixFingerprint?: string;
};

export type ProjectPreviewSummary = {
  previewTitle: "项目预览";
  statusLabel: string;
  statusTone: GenerationSlotTone;
  realAudioCount: number;
  totalClipCount: number;
  pendingClipCount: number;
  generatedClipCount: number;
  generatingClipCount: number;
  failedClipCount: number;
  waveformBars: number[];
  slots: GenerationSlot[];
  selectedClipSlot?: GenerationSlot;
};

const waveformBars = [28, 44, 36, 62, 48, 76, 42, 58, 34, 66, 46, 30];

const previewTrackTypes = [
  "voice",
  "breath",
  "sfx",
  "ambience",
] as const satisfies readonly PreviewTrackType[];

const assetStatusDisplays: Record<AssetStatus, AssetStatusDisplay> = {
  asset_pending: { statusLabel: "待生成", tone: "neutral" },
  asset_generating: { statusLabel: "队列中", tone: "accent" },
  asset_generated: { statusLabel: "可预览", tone: "ok" },
  asset_failed: { statusLabel: "失败", tone: "warn" },
};

const noClipsDisplay: AssetStatusDisplay = {
  statusLabel: "无片段",
  tone: "neutral",
};

export function getAssetStatusDisplay(
  status: AssetStatus,
): AssetStatusDisplay {
  return { ...assetStatusDisplays[status] };
}

export function getProjectPreviewSummary({
  project,
  selectedClip,
  projectMixJob,
  projectMixFingerprint,
}: ProjectPreviewSummaryInput): ProjectPreviewSummary {
  const clips = flattenClips(project);
  const pendingClipCount = countClipsByStatus(clips, "asset_pending");
  const generatedClipCount = countClipsByStatus(clips, "asset_generated");
  const generatingClipCount = countClipsByStatus(clips, "asset_generating");
  const failedClipCount = countClipsByStatus(clips, "asset_failed");
  const totalClipCount = clips.length;
  const statusTone = getProjectStatusTone({
    totalClipCount,
    generatedClipCount,
    generatingClipCount,
    failedClipCount,
  });

  return {
    previewTitle: "项目预览",
    statusLabel: getProjectStatusLabel({
      totalClipCount,
      pendingClipCount,
      generatedClipCount,
    }),
    statusTone,
    realAudioCount: clips.filter(hasRealAudio).length,
    totalClipCount,
    pendingClipCount,
    generatedClipCount,
    generatingClipCount,
    failedClipCount,
    waveformBars: [...waveformBars],
    slots: buildGenerationSlots(
      project,
      clips,
      projectMixJob,
      projectMixFingerprint,
    ),
    selectedClipSlot: selectedClip
      ? buildSelectedClipSlot(selectedClip)
      : undefined,
  };
}

function countClipsByStatus(
  clips: TimelineClip[],
  status: AssetStatus,
): number {
  return clips.filter((clip) => clip.generation.status === status).length;
}

function hasRealAudio(clip: TimelineClip): boolean {
  if (clip.asset.uri && isMockAssetUri(clip.asset.uri)) {
    return false;
  }

  return Boolean(clip.asset.asset_id || clip.asset.uri);
}

function getProjectStatusTone({
  totalClipCount,
  generatedClipCount,
  generatingClipCount,
  failedClipCount,
}: {
  totalClipCount: number;
  generatedClipCount: number;
  generatingClipCount: number;
  failedClipCount: number;
}): GenerationSlotTone {
  if (failedClipCount > 0) {
    return "warn";
  }

  if (generatingClipCount > 0) {
    return "accent";
  }

  if (totalClipCount > 0 && generatedClipCount === totalClipCount) {
    return "ok";
  }

  return "neutral";
}

function getProjectStatusLabel({
  totalClipCount,
  pendingClipCount,
  generatedClipCount,
}: {
  totalClipCount: number;
  pendingClipCount: number;
  generatedClipCount: number;
}): string {
  if (totalClipCount === 0) {
    return "无片段";
  }

  if (generatedClipCount === totalClipCount) {
    return "可预览";
  }

  if (pendingClipCount === totalClipCount) {
    return "未生成";
  }

  return "等待素材槽完成";
}

function buildGenerationSlots(
  project: AsmrProject,
  clips: TimelineClip[],
  projectMixJob: GenerationJobSnapshot | undefined,
  projectMixFingerprint: string | undefined,
): GenerationSlot[] {
  return [
    buildProjectMixSlot(project, clips, projectMixJob, projectMixFingerprint),
    ...previewTrackTypes.map((trackType) =>
      buildTrackSlot(project, trackType),
    ),
  ];
}

function buildProjectMixSlot(
  project: AsmrProject,
  clips: TimelineClip[],
  projectMixJob: GenerationJobSnapshot | undefined,
  projectMixFingerprint: string | undefined,
): GenerationSlot {
  const display = getProjectMixAssetStatusDisplay({
    project,
    clips,
    projectMixJob,
    projectMixFingerprint,
  });

  return {
    id: "project_mix",
    label: "项目混音",
    detail: `${clips.length} 个片段 · ${formatSeconds(project.duration)}`,
    ...display,
    clipCount: clips.length,
  };
}

function getProjectMixAssetStatusDisplay({
  project,
  clips,
  projectMixJob,
  projectMixFingerprint,
}: {
  project: AsmrProject;
  clips: TimelineClip[];
  projectMixJob: GenerationJobSnapshot | undefined;
  projectMixFingerprint: string | undefined;
}): AssetStatusDisplay {
  if (projectMixJob && isActiveGenerationJob(projectMixJob)) {
    return {
      statusLabel: projectMixJob.status === "canceling" ? "取消中" : "混音中",
      tone: "accent",
    };
  }

  if (clips.length === 0) {
    return { ...noClipsDisplay };
  }

  const wavExport = getWavExport(project);

  if (wavExport?.status === "exported" && wavExport.uri) {
    if (
      projectMixFingerprint &&
      !isCurrentProjectMixFingerprint(project, projectMixFingerprint)
    ) {
      return { statusLabel: "需重混", tone: "warn" };
    }

    return { statusLabel: "可试听", tone: "ok" };
  }

  if (wavExport?.status === "export_failed") {
    return { statusLabel: "混音失败", tone: "warn" };
  }

  if (
    canGenerateProjectMix(project) &&
    getMissingProjectMixClipIds(project).length === 0
  ) {
    return { statusLabel: "可混音", tone: "accent" };
  }

  return getAggregateAssetStatusDisplay(clips);
}

function buildTrackSlot(
  project: AsmrProject,
  trackType: PreviewTrackType,
): GenerationSlot {
  const clips =
    project.timeline.tracks.find((track) => track.track_type === trackType)
      ?.clips ?? [];
  const display = getAggregateAssetStatusDisplay(clips);

  return {
    id: trackType,
    label: `${getTrackLabel(trackType)}轨`,
    detail: `${clips.length} 个片段`,
    ...display,
    clipCount: clips.length,
  };
}

function buildSelectedClipSlot(
  selectedClip: TimelineClip,
): GenerationSlot {
  const display = getAssetStatusDisplay(selectedClip.generation.status);

  return {
    id: "selected_clip",
    label: "当前片段",
    detail: `${getTrackLabel(selectedClip.track)} · ${formatTimeRange(
      selectedClip.start,
      selectedClip.duration,
    )}`,
    ...display,
    clipCount: 1,
  };
}

function getAggregateAssetStatusDisplay(
  clips: TimelineClip[],
): AssetStatusDisplay {
  if (clips.length === 0) {
    return { ...noClipsDisplay };
  }

  return getAssetStatusDisplay(getAggregateAssetStatus(clips));
}

function getAggregateAssetStatus(clips: TimelineClip[]): AssetStatus {
  if (clips.some((clip) => clip.generation.status === "asset_failed")) {
    return "asset_failed";
  }

  if (clips.some((clip) => clip.generation.status === "asset_generating")) {
    return "asset_generating";
  }

  if (
    clips.length > 0 &&
    clips.every((clip) => clip.generation.status === "asset_generated")
  ) {
    return "asset_generated";
  }

  return "asset_pending";
}
