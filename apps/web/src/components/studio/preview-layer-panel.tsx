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

import type { ProjectPreviewSummary } from "@/lib/asmr/generation-summary";
import type {
  ProjectMixControl,
  SelectedClipPreview,
} from "@/lib/asmr/generation-view";
import type { AudioAnalysis } from "@/lib/asmr/audio-analysis";
import type { AudioAnalysisStatus } from "@/lib/asmr/product-quality";

import { GenerationSlotList } from "./generation-slot-list";
import { PreviewWaveform } from "./preview-waveform-placeholder";

type PreviewLayerPanelProps = {
  binaural?: boolean;
  onBinauralChange?: (enabled: boolean) => void;
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
        {control.canPlay && <button
          type="button"
          onClick={onPlay}
          aria-label={control.playLabel}
          title={control.playLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-studio-text transition hover:border-sky-300/28 hover:bg-sky-300/12 disabled:cursor-not-allowed disabled:text-studio-muted disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        </button>}
        {control.canDownload && <button
          type="button"
          onClick={onDownload}
          aria-label={control.downloadLabel}
          title={control.downloadLabel}
          className="inline-flex h-9 min-w-12 shrink-0 items-center justify-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition hover:border-sky-300/28 hover:bg-sky-300/12 disabled:cursor-not-allowed disabled:text-studio-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{control.downloadLabel}</span>
        </button>}
      </div>
      {control.progress !== undefined ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-label="整段生成进度"
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
  binaural, onBinauralChange,
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
  const trackSlots = preview.slots.filter(
    (slot) => slot.id !== "project_mix" && slot.clipCount > 0,
  );
  const progressLabel = projectMixControl.action === "cancel"
    ? projectMixControl.statusLabel
    : projectMixControl.tone === "warn"
      ? projectMixControl.statusLabel
      : preview.generatingClipCount > 0
        ? `正在生成 ${preview.generatingClipCount} 个片段`
        : preview.generatedClipCount > 0
          ? `已生成 ${preview.generatedClipCount} / ${preview.totalClipCount} 个片段`
          : "选择片段并生成音频后，即可试听。";

  return (
    <aside
      aria-label="试听与导出"
      className="min-w-0 rounded-lg border border-studio-line bg-white/[0.025] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-studio-text">
            <RadioTower className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="truncate">试听与导出</h2>
          </div>
        </div>

        {selectedClipPreview.canPlay && <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onPlaySelectedClip}
            aria-label={selectedClipPreview.label}
            title={selectedClipPreview.label}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-sky-300/24 bg-sky-300/12 px-2 text-xs text-sky-50 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            片段
          </button>
        </div>}
      </div>

      <p role="status" className={`mt-2 text-xs leading-5 ${projectMixControl.tone === "warn" ? "text-amber-100" : "text-studio-muted"}`}>
        {progressLabel}
      </p>
      {preview.failedClipCount > 0 && (
        <p role="alert" className="mt-2 text-xs leading-5 text-amber-100">
          {preview.failedClipCount} 个片段生成失败，请选择片段重试。
        </p>
      )}

      <ProjectMixControls
        control={projectMixControl}
        onCancel={onCancelProjectMix}
        onDownload={onDownloadProjectMix}
        onGenerate={onGenerateProjectMix}
        onPlay={onPlayProjectMix}
      />

      {onBinauralChange && <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-studio-text">
          <input type="checkbox" checked={Boolean(binaural)} onChange={(event) => onBinauralChange(event.target.checked)} className="accent-sky-300" />
          双耳空间与房间感
        </label>
        <p className="text-xs leading-5 text-studio-muted">用于人声试听和整段导出。距离和移动方式在片段里调整。</p>
      </div>}

      {audioAnalysisStatus === "ready" && audioAnalysis && <div className="mt-3">
        <PreviewWaveform
          bars={audioAnalysis.bars}
          tone={preview.statusTone}
          label={audioAnalysisSourceLabel}
        />
      </div>}
      {audioAnalysisStatus === "loading" && <p className="mt-2 text-xs text-studio-muted">正在读取波形…</p>}
      {audioAnalysisStatus === "error" && <p role="status" className="mt-2 text-xs text-amber-100">波形暂时无法读取。</p>}

      {trackSlots.length > 0 && <details className="mt-3 border-t border-white/[0.06] pt-3">
        <summary className="cursor-pointer text-xs text-studio-muted focus:outline-none focus:ring-2 focus:ring-sky-300/35">各轨进度</summary>
        <div className="mt-3">
          <GenerationSlotList title="音频生成" slots={trackSlots} compact />
        </div>
      </details>}
    </aside>
  );
}
