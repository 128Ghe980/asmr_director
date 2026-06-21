import type { AsmrProject, AssetStatus, TimelineClip, TrackType } from "./schema";
import { getTrackLabel } from "./ui-copy";
import { flattenClips, formatSeconds, formatTimeRange } from "./view-model";

export type GenerationSummaryTone = "neutral" | "accent" | "ok" | "warn";

export type AssetStatusDisplay = {
  statusLabel: string;
  tone: GenerationSummaryTone;
};

export type GenerationSummarySlot = AssetStatusDisplay & {
  id: "project_mix" | "selected_clip" | PreviewTrackType;
  label: string;
  detail: string;
  clipCount: number;
};

type PreviewTrackType = Exclude<TrackType, "post_processing">;

type ProjectPreviewSummaryInput = {
  project: AsmrProject;
  selectedClip?: TimelineClip;
};

type ProjectPreviewSummary = {
  previewTitle: "项目预览";
  statusLabel: string;
  statusTone: GenerationSummaryTone;
  realAudioCount: number;
  totalClipCount: number;
  pendingClipCount: number;
  generatedClipCount: number;
  generatingClipCount: number;
  failedClipCount: number;
  waveformBars: number[];
  slots: GenerationSummarySlot[];
  selectedClipSlot?: GenerationSummarySlot;
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

export function getAssetStatusDisplay(
  status: AssetStatus,
): AssetStatusDisplay {
  return { ...assetStatusDisplays[status] };
}

export function getProjectPreviewSummary({
  project,
  selectedClip,
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
    statusLabel:
      totalClipCount > 0 && generatedClipCount === totalClipCount
        ? "可预览"
        : "等待素材槽完成",
    statusTone,
    realAudioCount: clips.filter(hasRealAudio).length,
    totalClipCount,
    pendingClipCount,
    generatedClipCount,
    generatingClipCount,
    failedClipCount,
    waveformBars: [...waveformBars],
    slots: buildGenerationSlots(project, clips),
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
}): GenerationSummaryTone {
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

function buildGenerationSlots(
  project: AsmrProject,
  clips: TimelineClip[],
): GenerationSummarySlot[] {
  return [
    buildProjectMixSlot(project, clips),
    ...previewTrackTypes.map((trackType) =>
      buildTrackSlot(project, trackType),
    ),
  ];
}

function buildProjectMixSlot(
  project: AsmrProject,
  clips: TimelineClip[],
): GenerationSummarySlot {
  const display = getAssetStatusDisplay(getAggregateAssetStatus(clips));

  return {
    id: "project_mix",
    label: "项目混音",
    detail: `${clips.length} 个片段 · ${formatSeconds(project.duration)}`,
    ...display,
    clipCount: clips.length,
  };
}

function buildTrackSlot(
  project: AsmrProject,
  trackType: PreviewTrackType,
): GenerationSummarySlot {
  const clips =
    project.timeline.tracks.find((track) => track.track_type === trackType)
      ?.clips ?? [];
  const display = getAssetStatusDisplay(getAggregateAssetStatus(clips));

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
): GenerationSummarySlot {
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
