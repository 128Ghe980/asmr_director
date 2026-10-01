"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Plus, Scissors, Sparkles, Undo2 } from "lucide-react";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import type { ClipPatch } from "@/lib/asmr/edit-project";
import { getVoiceGapAfter } from "@/lib/asmr/voice-segments";
import { getTrackLabel, getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";
import { ScriptRewrite } from "./script-rewrite";
import { StatusBadge } from "./status-badge";

type ScriptEditorPanelProps = {
  project: AsmrProject;
  selectedClipId: string | undefined;
  busy: boolean;
  canUndo: boolean;
  notice?: string;
  onSelectClip: (clipId: string) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
  onAddClip: (afterClipId?: string) => void;
  onDeleteClip: (clipId: string) => void;
  onSplitClip: (clipId: string, start: number, end: number, generate?: boolean) => void;
  onMergeClip: (clipId: string) => void;
  onGapChange: (clipId: string, seconds: number) => void;
  onRewriteClip: (clipId: string, original: string, replacement: string) => void;
  onUndo: () => void;
  onOpenStoryboard?: (clipId: string) => void;
};

const buttonClass = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-studio-line px-2.5 py-1.5 text-xs text-studio-muted hover:bg-white/5 hover:text-studio-text focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-35 disabled:cursor-not-allowed";

function clipTitle(clip: TimelineClip) {
  switch (clip.type) {
    case "voice": return clip.text;
    case "breath": return getValueLabel(clip.breath);
    case "sfx": return getValueLabel(clip.sfx);
    case "ambience": return getValueLabel(clip.ambience);
  }
}

function GapInput({ value, label, onChange }: { value: number; label: string; onChange: (seconds: number) => void }) {
  const [input, setInput] = useState(String(Number(value.toFixed(3))));
  return <label className="flex items-center gap-2 text-xs text-studio-muted">
    下一段前等待
    <input aria-label={label} type="number" min="0" max="600" step="0.1" value={input}
      className="w-20 rounded-md border border-studio-line bg-black/20 px-2 py-1.5 text-studio-text"
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => { const seconds = Number(input); if (input.trim() && Number.isFinite(seconds) && seconds >= 0 && seconds <= 600) onChange(seconds); else setInput(String(value)); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />秒
  </label>;
}

export function ScriptEditorPanel({ project, selectedClipId, busy, canUndo, notice, onSelectClip, onUpdateClip, onAddClip, onDeleteClip, onSplitClip, onMergeClip, onGapChange, onRewriteClip, onUndo, onOpenStoryboard }: ScriptEditorPanelProps) {
  const clips = flattenClips(project);
  const voices = clips.filter((clip) => clip.type === "voice");
  const [selection, setSelection] = useState<{ clipId: string; text: string; start: number; end: number }>();
  const [rewrite, setRewrite] = useState<{ clipId: string; text: string; start: number; end: number }>();
  const cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const card = selectedClipId ? cards.current.get(selectedClipId) : undefined;
    const scroller = card?.closest("[data-script-scroll]");
    if (!card || !scroller || card.contains(document.activeElement)) return;
    const rect = card.getBoundingClientRect();
    const bounds = scroller.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom) scroller.scrollTop += rect.top - bounds.top - 12;
  }, [selectedClipId]);

  return <section aria-label="文案与分段" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-studio-line bg-studio-panel/88">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-studio-line px-3 py-2">
      <div><h2 className="text-sm font-semibold">文案与分段</h2><p className="mt-0.5 text-[11px] text-studio-muted">选中文字，修改或生成这一句</p></div>
      <div className="flex gap-2"><button type="button" className={buttonClass} disabled={!canUndo} onClick={onUndo}><Undo2 className="h-3.5 w-3.5" />撤回编辑</button><button type="button" className={buttonClass} onClick={() => onAddClip(voices.at(-1)?.id)}><Plus className="h-3.5 w-3.5" />新增一段</button></div>
    </div>
    <div data-script-scroll className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-2">
      {notice && <p role="status" className="rounded-lg bg-sky-300/5 px-3 py-2 text-xs leading-5 text-sky-100">{notice}</p>}
      {!voices.length && <p className="p-3 text-sm text-studio-muted">添加第一段台词，开始编排。</p>}
      {clips.map((clip) => {
        const isSelected = clip.id === selectedClipId;
        const index = voices.findIndex((voice) => voice.id === clip.id);
        const range = isSelected && selection?.clipId === clip.id && clip.type === "voice" && selection.text === clip.text ? selection : undefined;
        const hasRange = !!range && range.end > range.start && !!clipTitle(clip).slice(range.start, range.end).trim();
        const canSplit = !!range && (hasRange ? range.start > 0 || range.end < clipTitle(clip).length : range.start > 0 && range.start < clipTitle(clip).length);
        const gap = clip.type === "voice" ? getVoiceGapAfter(project, clip.id) : null;
        if (clip.type !== "voice") return <button type="button" key={clip.id} aria-pressed={isSelected} onClick={() => onSelectClip(clip.id)} className={`w-full rounded-md px-2 py-1.5 text-left ${isSelected ? "bg-sky-300/10 ring-1 ring-sky-300/35" : "text-studio-muted hover:bg-white/[0.025]"}`}><span className="text-sm">{clipTitle(clip)}</span><span className="ml-3 text-xs text-studio-muted">{getTrackLabel(clip.track)} · {formatTimeRange(clip.start, clip.duration)}</span></button>;
        return <article key={clip.id} ref={(node) => { if (node) cards.current.set(clip.id, node); else cards.current.delete(clip.id); }} className={`min-w-0 rounded-md px-1.5 py-1 transition-colors ${isSelected ? "bg-sky-300/[0.045]" : "hover:bg-white/[0.02]"}`}>
          <div className={`grid min-w-0 items-start gap-2 ${onOpenStoryboard ? "grid-cols-[22px_minmax(0,1fr)_32px]" : "grid-cols-[22px_minmax(0,1fr)]"}`}>
          <button type="button" aria-label={`选择第 ${index + 1} 段`} aria-pressed={isSelected} className={`min-h-8 text-left text-[11px] tabular-nums ${isSelected ? "font-semibold text-sky-100" : "text-studio-muted/60"}`} onClick={() => onSelectClip(clip.id)}>{String(index + 1).padStart(2, "0")}</button>
          <textarea aria-label={isSelected ? "台词" : `第 ${index + 1} 段台词`} value={clip.text} rows={1}
            onFocus={() => onSelectClip(clip.id)}
            onSelect={(event) => { const node = event.currentTarget; setSelection({ clipId: clip.id, text: clip.text, start: node.selectionStart, end: node.selectionEnd }); }}
            onChange={(event) => { setSelection(undefined); onUpdateClip(clip.id, { text: event.target.value }); }}
            className={`block min-h-8 w-full min-w-0 resize-none rounded border px-1.5 py-0.5 text-sm leading-7 outline-none [field-sizing:content] ${isSelected ? "border-sky-300/25 bg-black/10 focus:border-sky-300/50" : "border-transparent bg-transparent"}`} />
          {onOpenStoryboard ? <button type="button" aria-label={`第 ${index + 1} 段视频分镜`} title={project.videoPlan?.shots[clip.id] ? "查看本段视频分镜" : "生成本段视频分镜"} onClick={() => onOpenStoryboard(clip.id)} className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-violet-300 ${project.videoPlan?.shots[clip.id] ? "border-violet-300/25 bg-violet-300/10 text-violet-100" : "border-transparent text-studio-muted/55 hover:border-violet-300/20 hover:bg-violet-300/5 hover:text-violet-200"}`}><Clapperboard className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
          </div>
          {isSelected && <div className="ml-[30px] mt-1 space-y-2 pb-1">
            <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] tabular-nums text-studio-muted">{formatTimeRange(clip.start, clip.duration)}</span><StatusBadge status={clip.generation.status} /></div>
            {hasRange && <p className="text-xs text-sky-100">已选 {range!.end - range!.start} 字：<span className="break-words">{clip.text.slice(range!.start, range!.end).slice(0, 100)}{range!.end - range!.start > 100 ? "…" : ""}</span></p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} title={clip.asset.uri ? "拆分后需重新生成涉及片段；原音可从历史版本恢复" : undefined} disabled={!canSplit} onClick={() => range && onSplitClip(clip.id, range.start, range.end)}><Scissors className="h-3.5 w-3.5" />{hasRange ? "选区独立成段" : "在光标处分段"}</button>
              <button type="button" className={`${buttonClass} border-sky-300/30 text-sky-100`} disabled={!hasRange || busy} onClick={() => range && onSplitClip(clip.id, range.start, range.end, true)}>生成选区音频</button>
              <button type="button" className={buttonClass} disabled={!clip.text.trim()} onClick={() => setRewrite(hasRange ? range : { clipId: clip.id, text: clip.text, start: 0, end: clip.text.length })}><Sparkles className="h-3.5 w-3.5" />{hasRange ? "AI 改写选区" : "AI 改写本段"}</button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {gap !== null && <GapInput key={`${clip.id}:${gap}`} value={gap} label={`第 ${index + 1} 段后等待秒数`} onChange={(seconds) => onGapChange(clip.id, seconds)} />}
              <div className="flex flex-wrap gap-1"><button className={buttonClass} type="button" onClick={() => onAddClip(clip.id)}>下方插入</button><button className={buttonClass} type="button" disabled={index === voices.length - 1} onClick={() => onMergeClip(clip.id)}>合并下一段</button><button className={`${buttonClass} hover:text-rose-200`} type="button" onClick={() => onDeleteClip(clip.id)}>删除本段</button></div>
            </div>
          </div>}
        </article>;
      })}
    </div>
    {rewrite && <ScriptRewrite key={`${rewrite.clipId}:${rewrite.start}:${rewrite.end}`} project={project} range={rewrite} onApply={onRewriteClip} onClose={() => setRewrite(undefined)} />}
  </section>;
}
