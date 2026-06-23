"use client";

import { Play, RadioTower } from "lucide-react";

import type {
  GenerationSlotTone,
  ProjectPreviewSummary,
} from "@/lib/asmr/generation-summary";
import type { SelectedClipPreview } from "@/lib/asmr/generation-view";

import {
  GenerationSlotList,
  getGenerationSlotToneClassName,
} from "./generation-slot-list";
import { PreviewWaveformPlaceholder } from "./preview-waveform-placeholder";

type PreviewLayerPanelProps = {
  preview: ProjectPreviewSummary;
  selectedClipPreview: SelectedClipPreview;
  onPlaySelectedClip: () => void;
};

const playbackUnavailableLabel = "无法播放预览：真实音频尚未生成";

function getPreviewStatusClassName(tone: GenerationSlotTone) {
  return getGenerationSlotToneClassName(tone, "shrink-0");
}

export function PreviewLayerPanel({
  preview,
  selectedClipPreview,
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
          <p className="mt-1 text-xs text-studio-muted">真实音频尚未生成</p>
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

      <div className="mt-3">
        <PreviewWaveformPlaceholder
          bars={preview.waveformBars}
          tone={preview.statusTone}
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
