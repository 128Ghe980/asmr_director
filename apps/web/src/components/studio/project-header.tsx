"use client";

import { Download, Radio, SlidersHorizontal } from "lucide-react";

import type { AsmrProject } from "@/lib/asmr/schema";
import {
  getBinauralLabel,
  getLanguageLabel,
  getLimiterLabel,
} from "@/lib/asmr/ui-copy";
import { formatSeconds } from "@/lib/asmr/view-model";

import { StatusBadge } from "./status-badge";

type ProjectHeaderProps = {
  project: AsmrProject;
  onExportJson: () => void;
};

export function ProjectHeader({ project, onExportJson }: ProjectHeaderProps) {
  const mixing = project.timeline.mixing;
  const projectDetails = [
    project.scene.name,
    formatSeconds(project.duration),
    getLanguageLabel(project.language),
  ].join(" · ");
  const mixDetails = [
    `${mixing.target_lufs} LUFS`,
    getBinauralLabel(mixing.binaural),
    getLimiterLabel(mixing.master_limiter),
  ].join(" · ");

  return (
    <header className="border-b border-studio-line bg-studio-bg/88 px-5 py-4 backdrop-blur md:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-sky-300/20 bg-sky-300/10 text-sky-100">
            <Radio className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
                AI ASMR 导演台
              </p>
              <StatusBadge status={project.status} />
            </div>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-studio-text md:text-3xl">
              {project.title}
            </h1>
            <p className="mt-2 text-sm text-studio-muted">{projectDetails}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-studio-line bg-white/[0.03] px-3 text-sm text-studio-muted">
            <SlidersHorizontal className="h-4 w-4 text-studio-gold" aria-hidden="true" />
            <span className="whitespace-nowrap">{mixDetails}</span>
          </div>
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-4 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            导出 JSON
          </button>
        </div>
      </div>
    </header>
  );
}
