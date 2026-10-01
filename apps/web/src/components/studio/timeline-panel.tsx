"use client";

import clsx from "clsx";

import { getAssetStatusDisplay } from "@/lib/asmr/generation-summary";
import type { AsmrProject, TimelineClip, TrackType } from "@/lib/asmr/schema";
import { getTrackLabel, getValueLabel } from "@/lib/asmr/ui-copy";
import { formatTimeRange } from "@/lib/asmr/view-model";

type TimelinePanelProps = {
  project: AsmrProject;
  selectedClipId: string | undefined;
  onSelectClip: (clipId: string) => void;
};

type ClipTrackType = TimelineClip["track"];

const fixedTracks: Array<{ type: TrackType; label: string }> = [
  { type: "voice", label: getTrackLabel("voice") },
  { type: "breath", label: getTrackLabel("breath") },
  { type: "sfx", label: getTrackLabel("sfx") },
  { type: "ambience", label: getTrackLabel("ambience") },
  { type: "post_processing", label: getTrackLabel("post_processing") },
];

const clipTones: Record<ClipTrackType, string> = {
  voice: "border-sky-300/50 bg-sky-300/18 text-sky-50",
  breath: "border-emerald-300/50 bg-emerald-300/16 text-emerald-50",
  sfx: "border-amber-300/55 bg-amber-300/18 text-amber-50",
  ambience: "border-violet-300/50 bg-violet-300/18 text-violet-50",
};

const statusDotTones = {
  neutral: "bg-slate-200/70",
  accent: "bg-sky-200/85",
  ok: "bg-emerald-200/85",
  warn: "bg-amber-200/85",
};

function getTrackClips(project: AsmrProject, trackType: ClipTrackType): TimelineClip[] {
  const track = project.timeline.tracks.find(
    (timelineTrack) => timelineTrack.track_type === trackType,
  );

  return track?.clips ?? [];
}

function getClipLabel(clip: TimelineClip): string {
  switch (clip.type) {
    case "voice":
      return clip.text;
    case "breath":
      return getValueLabel(clip.breath);
    case "sfx":
      return getValueLabel(clip.sfx);
    case "ambience":
      return getValueLabel(clip.ambience);
  }
}

function getTimelineStyle(clip: TimelineClip, projectDuration: number) {
  const left = Math.max(0, (clip.start / projectDuration) * 100);
  const width = Math.max(1.6, (clip.duration / projectDuration) * 100);

  return {
    left: `${left}%`,
    width: `${width}%`,
  };
}

export function TimelinePanel({
  project,
  selectedClipId,
  onSelectClip,
}: TimelinePanelProps) {
  return (
    <section aria-label="时间线" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-studio-line px-3">
        <h2 className="text-sm font-semibold text-studio-text">时间线</h2>
        <div className="text-xs tabular-nums text-studio-muted">
          {formatTimeRange(0, project.duration)}
        </div>
      </div>

      <div role="region" aria-label="时间线轨道" tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-300/45">
        <div className="min-w-[600px] overflow-hidden rounded-md border border-white/[0.06] bg-black/16 lg:min-w-0">
          {fixedTracks.map(({ type, label }) => {
            const clips =
              type === "post_processing"
                ? []
                : getTrackClips(project, type as ClipTrackType);

            return (
              <div
                key={type}
                className="grid h-9 grid-cols-[62px_minmax(0,1fr)] border-b border-white/[0.06] last:border-b-0"
              >
                <div className="flex items-center border-r border-white/[0.06] bg-white/[0.025] px-2">
                  <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
                    {label}
                  </span>
                </div>
                <div className="relative overflow-hidden">
                  <div className="absolute inset-y-0 left-1/4 w-px bg-white/[0.045]" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/[0.06]" />
                  <div className="absolute inset-y-0 left-3/4 w-px bg-white/[0.045]" />
                  {clips.map((clip) => {
                    const isSelected = clip.id === selectedClipId;

                    const timeRange = formatTimeRange(clip.start, clip.duration);
                    const generationStatus = getAssetStatusDisplay(
                      clip.generation.status,
                    );

                    return (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => onSelectClip(clip.id)}
                        aria-label={`${getTrackLabel(clip.track)} ${getClipLabel(
                          clip,
                        )} ${timeRange} ${generationStatus.statusLabel}`}
                        aria-pressed={isSelected}
                        title={`${getClipLabel(clip)} · ${timeRange} · ${generationStatus.statusLabel}`}
                        className={clsx(
                          "absolute top-1 flex h-7 min-w-0 items-center gap-1.5 overflow-hidden rounded border px-2 text-left text-[11px] font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300/45",
                          clipTones[clip.track],
                          isSelected && "ring-2 ring-sky-200/70",
                        )}
                        style={getTimelineStyle(clip, project.duration)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {getClipLabel(clip)}
                        </span>
                        <span
                          className={clsx(
                            "h-2 w-2 shrink-0 rounded-full",
                            statusDotTones[generationStatus.tone],
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
