"use client";

import { useMemo, useState } from "react";

import type { AsmrProject } from "@/lib/asmr/schema";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";

import { ClipInspector } from "./clip-inspector";
import { ProjectHeader } from "./project-header";
import { StoryboardPanel } from "./storyboard-panel";
import { TimelinePanel } from "./timeline-panel";

type StudioAppProps = {
  project: AsmrProject;
};

function exportProjectJson(project: AsmrProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${project.project_id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function EmotionCurve({ project }: { project: AsmrProject }) {
  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 items-center justify-between border-b border-studio-line px-4">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">Emotion Curve</h2>
          <p className="text-xs text-studio-muted">
            {project.emotion_curve.length} director beats
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex h-20 overflow-hidden rounded-lg border border-white/[0.06] bg-black/16">
          {project.emotion_curve.map((point) => {
            const duration = point.end - point.start;
            const width = `${Math.max(6, (duration / project.duration) * 100)}%`;

            return (
              <div
                key={`${point.start}-${point.end}-${point.emotion}`}
                className="flex min-w-0 flex-col justify-between border-r border-white/[0.08] bg-white/[0.035] px-3 py-3 last:border-r-0"
                style={{ width }}
              >
                <span className="truncate text-sm font-semibold text-studio-text">
                  {point.emotion.replaceAll("_", " ")}
                </span>
                <span className="truncate text-xs text-studio-muted">
                  {formatTimeRange(point.start, duration)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function StudioApp({ project }: StudioAppProps) {
  const clips = useMemo(() => flattenClips(project), [project]);
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(
    () => clips[0]?.id,
  );
  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? clips[0];
  const activeClipId = selectedClip?.id;

  return (
    <div className="min-h-screen bg-studio-bg text-studio-text">
      <ProjectHeader
        project={project}
        onExportJson={() => exportProjectJson(project)}
      />

      <main className="grid gap-4 px-4 py-4 md:px-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)_minmax(280px,340px)]">
        <div className="min-h-[520px] lg:h-[calc(100vh-112px)]">
          <StoryboardPanel
            project={project}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <TimelinePanel
            project={project}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
          <EmotionCurve project={project} />
        </div>

        <div>
          <ClipInspector selectedClip={selectedClip} />
        </div>
      </main>
    </div>
  );
}
