"use client";

import clsx from "clsx";

import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import {
  flattenClips,
  formatTimeRange,
  getPositionLabel,
} from "@/lib/asmr/view-model";

import { StatusBadge } from "./status-badge";

type StoryboardPanelProps = {
  project: AsmrProject;
  selectedClipId: string | undefined;
  onSelectClip: (clipId: string) => void;
};

function getClipTitle(clip: TimelineClip): string {
  switch (clip.type) {
    case "voice":
      return clip.text;
    case "breath":
      return clip.breath.replaceAll("_", " ");
    case "sfx":
      return clip.sfx.replaceAll("_", " ");
    case "ambience":
      return clip.ambience.replaceAll("_", " ");
  }
}

function getClipMetadata(clip: TimelineClip): string {
  const details = [
    clip.track.toUpperCase(),
    formatTimeRange(clip.start, clip.duration),
    getPositionLabel(clip.position),
    `${clip.volume_db} dB`,
  ];

  if (clip.type === "voice") {
    details.splice(1, 0, clip.emotion.replaceAll("_", " "));
  }

  return details.join(" · ");
}

export function StoryboardPanel({
  project,
  selectedClipId,
  onSelectClip,
}: StoryboardPanelProps) {
  const clips = flattenClips(project);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-studio-line px-4">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">Storyboard</h2>
          <p className="text-xs text-studio-muted">{clips.length} timeline clips</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {clips.map((clip) => {
            const isSelected = clip.id === selectedClipId;

            return (
              <button
                key={clip.id}
                type="button"
                onClick={() => onSelectClip(clip.id)}
                aria-pressed={isSelected}
                className={clsx(
                  "group min-h-[92px] rounded-lg border px-3 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300/45",
                  isSelected
                    ? "border-sky-300/45 bg-sky-300/12"
                    : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.045]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-studio-text">
                    {getClipTitle(clip)}
                  </p>
                  <StatusBadge status={clip.generation.status} />
                </div>
                <p className="mt-3 text-xs leading-5 text-studio-muted">
                  {getClipMetadata(clip)}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
