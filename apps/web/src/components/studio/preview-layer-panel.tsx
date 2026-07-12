"use client";

import {
  Download,
  LoaderCircle,
  Play,
  RadioTower,
  RefreshCcw,
  Sparkles,
  X,
} from "lucide-react";

import type {
  GenerationSlotTone,
  ProjectPreviewSummary,
} from "@/lib/asmr/generation-summary";
import type {
  ProjectMixControl,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
import type { AudioAnalysis } from "@/lib/asmr/audio-analysis";
import type { AudioAnalysisStatus } from "@/lib/asmr/product-quality";

import {
  GenerationSlotList,
  getGenerationSlotToneClassName,
} from "./generation-slot-list";
import { PreviewWaveform } from "./preview-waveform-placeholder";

type PreviewLayerPanelProps = {
  preview: ProjectPreviewSummary;
  audioAnalysis: AudioAnalysis | undefined;
  audioAnalysisStatus: AudioAnalysisStatus;
  audioAnalysisSourceLabel: string;
  projectMixControl: ProjectMixControl;
  selectedClipPreview: SelectedClipPreview;
  onCancelProjectMix: () => void;
  onDownloadProjectMix: () => void;
  onGenerateProjectMix: () => void;
  onPlayProjectMix: () => void;
  onPlaySelectedClip: () => void;
};

const playbackUnavailableLabel = "无法播放预览：真实音频尚未生成";

function getPreviewStatusClassName(tone: GenerationSlotTone) {
  return getGenerationSlotToneClassName(tone, "shrink-0");
}

function ProjectMixControls({
  control,
  onCancel,
  onDownload,
  onGenerate,
  onPlay,
}: {
  control: ProjectMixControl;
  onCancel: () => void;
  onDownload: () => void;
  onGenerate: () => void;
  onPlay: () => void;
}) {
  const isCancel = control.action === "cancel";
  const PrimaryIcon = isCancel
    ? X
    : control.action === "remix" || control.action === "retry"
      ? RefreshCcw
      : Sparkles;
  const primaryLabel = control.disabledReason ?? control.statusLabel;

  return (
    <div className="mt-3 rounded-md border border-white/[0.06] bg-black/14 p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={control.disabled}
          onClick={isCancel ? onCancel : onGenerate}
          title={primaryLabel}
          className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-sky-300/24 bg-sky-300/12 px-3 text-xs font-semibold text-sky-50 transition hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.035] disabled:text-studio-muted"
        >
          {control.action === "cancel" && control.progress !== undefined ? (
            <LoaderCircle
              className="h-3.5 w-3.5 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <PrimaryIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{control.label}</span>
        </button>
        <button
          type="button"
          disabled={!control.canPlay}
          onClick={onPlay}
          aria-label={control.playLabel}
          title={control.playLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-studio-text transition hover:border-sky-300/28 hover:bg-sky-300/12 disabled:cursor-not-allowed disabled:text-studio-muted disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!control.canDownload}
          onClick={onDownload}
          aria-label={control.downloadLabel}
          title={control.downloadLabel}
          className="inline-flex h-9 min-w-12 shrink-0 items-center justify-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition hover:border-sky-300/28 hover:bg-sky-300/12 disabled:cursor-not-allowed disabled:text-studio-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{control.downloadLabel}</span>
        </button>
      </div>
      {control.progress !== undefined ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.max(0, Math.min(100, control.progress))}
        >
          <div
            className="h-full rounded-full bg-sky-300/80 transition-[width]"
            style={{ width: `${Math.max(0, Math.min(100, control.progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function PreviewLayerPanel({
  preview,
  audioAnalysis,
  audioAnalysisStatus,
  audioAnalysisSourceLabel,
  projectMixControl,
  selectedClipPreview,
  onCancelProjectMix,
  onDownloadProjectMix,
  onGenerateProjectMix,
  onPlayProjectMix,
  onPlaySelectedClip,
}: PreviewLayerPanelProps) {
  const selectedClipPlaybackLabel = selectedClipPreview.canPlay
    ? selectedClipPreview.label
    : playbackUnavailableLabel;
  const stats = [
    { label: "片段", value: preview.totalClipCount },
    { label: "真实音频", value: preview.realAudioCount },
    { label: "待生成", value: preview.pendingClipCount },
    { label: "可预览", value: preview.generatedClipCount },
  ];
  const waveformBars =
    audioAnalysisStatus === "ready" && audioAnalysis
      ? audioAnalysis.bars
      : preview.waveformBars;
  const waveformLabel =
    audioAnalysisStatus === "ready"
      ? audioAnalysisSourceLabel
      : audioAnalysisStatus === "loading"
        ? "正在分析真实 WAV"
        : audioAnalysisStatus === "error"
          ? "真实波形不可用"
          : preview.realAudioCount > 0
            ? "选择可试听音频"
            : "音频尚未生成";

  return (
    <aside
      aria-label="预览层"
      className="min-w-0 rounded-lg border border-amber-300/18 bg-amber-300/[0.055] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-amber-100">
            <RadioTower className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="truncate">{preview.previewTitle}</h2>
          </div>
          <p className="mt-1 text-xs text-studio-muted">{waveformLabel}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className={getPreviewStatusClassName(preview.statusTone)}>
            {preview.statusLabel}
          </span>
          <button
            type="button"
            disabled={!selectedClipPreview.canPlay}
            onClick={onPlaySelectedClip}
            aria-label={selectedClipPlaybackLabel}
            title={selectedClipPlaybackLabel}
            className={[
              "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300/35",
              selectedClipPreview.canPlay
                ? "border-sky-300/24 bg-sky-300/12 text-sky-50 hover:bg-sky-300/18"
                : "border-studio-line bg-white/[0.035] text-studio-muted opacity-55 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ProjectMixControls
        control={projectMixControl}
        onCancel={onCancelProjectMix}
        onDownload={onDownloadProjectMix}
        onGenerate={onGenerateProjectMix}
        onPlay={onPlayProjectMix}
      />

      <div className="mt-3">
        <PreviewWaveform
          bars={waveformBars}
          tone={preview.statusTone}
          label={waveformLabel}
          loading={audioAnalysisStatus === "loading"}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-md border border-white/[0.06] bg-black/15 px-2.5 py-2"
          >
            <dt className="truncate text-[11px] text-studio-muted">
              {stat.label}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-studio-text">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        <GenerationSlotList title="生成槽" slots={preview.slots} compact />
      </div>
    </aside>
  );
}
