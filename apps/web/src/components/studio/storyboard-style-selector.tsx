"use client";

import { effectiveStoryboardStyle, STORYBOARD_STYLE_LABELS, type StoryboardStyle } from "@/lib/asmr/storyboard-style";
import type { ProjectVideoPlan } from "@/lib/asmr/video-plan";

export function StoryboardStyleSelector({ plan, disabled, onChange }: {
  plan?: ProjectVideoPlan;
  disabled?: boolean;
  onChange: (style: StoryboardStyle) => void;
}) {
  return <label className="block space-y-2 border-b border-studio-line px-4 py-3 text-xs text-studio-muted">
    <span>分镜风格{plan?.referenceTemplate ? " · 随模板" : ""}</span>
    <select aria-label="当前工程分镜风格" value={effectiveStoryboardStyle(plan)} disabled={disabled || Boolean(plan?.referenceTemplate)}
      className="w-full min-w-0 rounded-lg border border-studio-line bg-studio-panel px-3 py-2 text-sm text-studio-text outline-none focus:border-violet-300/40 disabled:opacity-50"
      onChange={(event) => onChange(event.target.value as StoryboardStyle)}>
      {Object.entries(STORYBOARD_STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </label>;
}
