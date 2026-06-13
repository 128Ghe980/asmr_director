"use client";

import clsx from "clsx";

import type { AsmrProject, TimelineClip, TrackType } from "@/lib/asmr/schema";
import { formatTimeRange } from "@/lib/asmr/view-model";

type TimelinePanelProps = {
  project: AsmrProject;
  selectedClipId: string | undefined;
  onSelectClip: (clipId: string) => void;
};

type ClipTrackType = TimelineClip["track"];

const fixedTracks: Array<{ type: TrackType; label: string }> = [
  { type: "voice", label: "Voice" },
  { type: "breath", label: "Breath" },
  { type: "sfx", label: "SFX" },
  { type: "ambience", label: "Room" },
  { type: "post_processing", label: "Post" },
];

const clipTones: Record<ClipTrackType, string> = {
  voice: "border-sky-300/50 bg-sky-300/18 text-sky-50",
  breath: "border-emerald-300/50 bg-emerald-300/16 text-emerald-50",
  sfx: "border-amber-300/55 bg-amber-300/18 text-amber-50",
  ambience: "border-violet-300/50 bg-violet-300/18 text-violet-50",
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
      return clip.emotion.replaceAll("_", " ");
    case "breath":
      return clip.breath.replaceAll("_", " ");
    case "sfx":
      return clip.sfx.replaceAll("_", " ");
    case "ambience":
      return clip.ambience.replaceAll("_", " ");
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
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 items-center justify-between border-b border-studio-line px-4">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">Timeline</h2>
          <p className="text-xs text-studio-muted">V0.1 fixed tracks</p>
        </div>
        <div className="text-xs tabular-nums text-studio-muted">
          {formatTimeRange(0, project.duration)}
        </div>
      </div>

      <div className="overflow-x-auto p-3">
        <div className="min-w-[720px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/16 lg:min-w-0">
          {fixedTracks.map(({ type, label }) => {
            const clips =
              type === "post_processing"
                ? []
                : getTrackClips(project, type as ClipTrackType);

            return (
              <div
                key={type}
                className="grid h-[64px] grid-cols-[78px_minmax(0,1fr)] border-b border-white/[0.06] last:border-b-0"
              >
                <div className="flex items-center border-r border-white/[0.06] bg-white/[0.025] px-3">
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

                    return (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => onSelectClip(clip.id)}
                        aria-label={`${clip.track} ${getClipLabel(
                          clip,
                        )} ${timeRange}`}
                        aria-pressed={isSelected}
                        title={`${getClipLabel(clip)} · ${timeRange}`}
                        className={clsx(
                          "absolute top-3 flex h-10 min-w-24 items-center overflow-hidden rounded-md border px-2 text-left text-[11px] font-semibold leading-none shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300/45",
                          clipTones[clip.track],
                          isSelected && "ring-2 ring-sky-200/70",
                        )}
                        style={getTimelineStyle(clip, project.duration)}
                      >
                        <span className="truncate">{getClipLabel(clip)}</span>
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
