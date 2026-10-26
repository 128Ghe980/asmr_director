"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import type { CreativeTemplate } from "@/lib/asmr/reference-template";

type Props = {
  templates: CreativeTemplate[];
  selected?: CreativeTemplate;
  disabled: boolean;
  onApply: (template: CreativeTemplate) => void;
  onUpdate: (template: CreativeTemplate) => void;
  onLoadDemo: (template: CreativeTemplate) => void;
  onRemove: () => void;
};

const fieldClass = "w-full min-w-0 rounded-xl border border-studio-line bg-black/20 px-4 py-3 text-sm leading-7 text-studio-text outline-none focus:border-amber-200/40 focus:ring-2 focus:ring-amber-200/10 disabled:opacity-50";
const buttonClass = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-studio-line px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-40";

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

export function CreativeTemplatePanel({ templates, selected, disabled, onApply, onUpdate, onLoadDemo, onRemove }: Props) {
  const available = selected && !templates.some((template) => template.id === selected.id) ? [...templates, selected] : templates;
  return <div className="mx-auto max-w-[960px] space-y-3">
    {available.map((template) => <TemplateCard key={template.id} template={template} selected={selected?.id === template.id ? selected : undefined} disabled={disabled} onApply={onApply} onUpdate={onUpdate} onLoadDemo={onLoadDemo} onRemove={onRemove} />)}
  </div>;
}

function TemplateCard({ template: original, selected, disabled, onApply, onUpdate, onLoadDemo, onRemove }: Omit<Props, "templates"> & { template: CreativeTemplate }) {
  const [previews, setPreviews] = useState<Record<string, CreativeTemplate>>({});
  const template = selected ?? previews[original.id] ?? original;
  const applied = Boolean(selected);

  function edit(patch: Partial<CreativeTemplate>) {
    const next = { ...template, ...patch };
    if (applied) onUpdate(next);
    else setPreviews((current) => ({ ...current, [next.id]: next }));
  }

  return <details aria-label={`模板：${template.title}`} className="rounded-xl border border-studio-line bg-black/10">
    <summary className="cursor-pointer px-4 py-4 text-sm font-medium sm:px-5"><span>{template.title}</span>{applied ? <span className="ml-3 inline-flex items-center gap-1 text-[11px] text-amber-100"><Check className="h-3 w-3" aria-hidden="true" />已选择</span> : null}</summary>
    <div className="space-y-4 border-t border-studio-line p-4 sm:p-5">
      <p className="whitespace-pre-line text-sm leading-7 text-studio-text/85">{original.summary}</p>
      <p className="text-[11px] text-studio-muted">{template.source.filename} · {durationLabel(template.source.durationSeconds)}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className={`${buttonClass} border-amber-200/30 bg-amber-200/10 text-amber-100`} onClick={() => onApply(template)}><Check className="h-3.5 w-3.5" aria-hidden="true" />{applied ? "已应用到创作设定" : "应用到创作设定"}</button>
        <button type="button" disabled={disabled} className={buttonClass} onClick={() => onLoadDemo(template)}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />载入中文示例稿</button>
        {selected ? <button type="button" disabled={disabled} className={`${buttonClass} text-studio-muted`} onClick={onRemove}>取消使用模板</button> : null}
      </div>
      <details className="rounded-lg border border-studio-line p-3 sm:p-4" aria-label="模板创作提示词">
        <summary className="cursor-pointer text-sm font-medium">创作 Prompt</summary>
        <textarea aria-label="模板创作 Prompt" className={`${fieldClass} mt-3`} value={template.creativePrompt} maxLength={6000} rows={8} disabled={disabled} onChange={(event) => edit({ creativePrompt: event.target.value })} />
      </details>
      <details className="rounded-lg border border-studio-line p-3 sm:p-4" aria-label="模板分镜设计">
        <summary className="cursor-pointer text-sm font-medium">场景与分镜</summary>
        <div className="mt-3 space-y-4">
      <label className="block space-y-2"><span className="text-xs text-studio-muted">统一场景描述</span><textarea aria-label="模板场景描述" className={fieldClass} value={template.sceneDescription} maxLength={4000} rows={4} disabled={disabled} onChange={(event) => edit({ sceneDescription: event.target.value })} /></label>
      <label className="block space-y-2"><span className="text-xs text-studio-muted">分镜与连续性约束</span><textarea aria-label="模板分镜约束" className={fieldClass} value={template.storyboardRules} maxLength={6000} rows={5} disabled={disabled} onChange={(event) => edit({ storyboardRules: event.target.value })} /></label>
      <div className="space-y-2">
        {template.beats.map((beat, index) => <details key={beat.id} className="rounded-lg border border-studio-line bg-black/10 px-3 py-3 sm:px-4">
          <summary className="cursor-pointer text-sm leading-6"><span className="mr-2 text-xs tabular-nums text-amber-200/70">{String(index + 1).padStart(2, "0")}</span>{beat.title}<span className="ml-3 inline-block text-[11px] text-studio-muted">参考 {beat.referenceRange}</span></summary>
          <p className="mt-3 text-xs leading-6 text-studio-text/85">{beat.story}</p>
          <dl className="mt-3 grid gap-3 text-xs leading-6 sm:grid-cols-2">
            {([['visual', '画面'], ['action', '动作'], ['camera', '镜头'], ['sound', '声音'], ['continuity', '连续性']] as const).map(([key, label]) => <div key={key} className={key === "continuity" ? "sm:col-span-2" : ""}><dt className="text-studio-muted">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-studio-text/85">{beat[key]}</dd></div>)}
          </dl>
        </details>)}
      </div>
        </div>
      </details>
    </div>
  </details>;
}
