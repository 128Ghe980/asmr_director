"use client";

import type {
  ProjectWorkspaceBadge,
  ProjectWorkspaceBadgeTone,
} from "@/lib/asmr/project-summary";

const toneClasses: Record<ProjectWorkspaceBadgeTone, string> = {
  neutral: "border-white/[0.1] bg-white/[0.035] text-studio-muted",
  accent: "border-sky-300/35 bg-sky-300/10 text-sky-100",
  ok: "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
  warn: "border-amber-400/35 bg-amber-500/10 text-amber-100",
};

const baseBadgeClass =
  "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold leading-none";

export function getProjectWorkspaceBadgeClassName(
  tone: ProjectWorkspaceBadgeTone,
  className?: string,
) {
  return [baseBadgeClass, toneClasses[tone], className]
    .filter(Boolean)
    .join(" ");
}

type WorkspaceBadgeProps = {
  badge: ProjectWorkspaceBadge;
  className?: string;
};

export function WorkspaceBadge({ badge, className }: WorkspaceBadgeProps) {
  return (
    <span className={getProjectWorkspaceBadgeClassName(badge.tone, className)}>
      {badge.label}
    </span>
  );
}
