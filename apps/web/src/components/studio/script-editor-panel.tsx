"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Clapperboard, Film, Link2, MoreHorizontal, Plus, ScanLine, Scissors, Sparkles, Undo2 } from "lucide-react";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import type { ClipPatch } from "@/lib/asmr/edit-project";
import { getVoiceGapAfter, type VoiceClipMoveDirection } from "@/lib/asmr/voice-segments";
import { getTrackLabel, getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";
import type { StudioAudioState } from "@/lib/asmr/studio-audio-overview";
import { getStudioStoryboardProgress } from "@/lib/asmr/studio-storyboard-overview";
import { getClipStoryboardReferenceMode, type StoryboardReferenceMode } from "@/lib/asmr/video-plan";
import { ScriptRewrite } from "./script-rewrite";
import { StatusBadge } from "./status-badge";

type ScriptEditorPanelProps = {
  project: AsmrProject;
  selectedClipId: string | undefined;
  busy: boolean;
  canUndo: boolean;
  notice?: string;
  batchActions?: ReactNode;
  workspaceTabs?: ReactNode;
  paragraphBody?: ReactNode;
  audioStates?: Record<string, StudioAudioState>;
  audioStatesStatus?: "loading" | "ready" | "error";
  onSelectClip: (clipId: string) => void;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
  onAddClip: (afterClipId?: string) => void;
  onAddSilentClip?: (afterClipId?: string) => void;
  onSilentDurationChange?: (clipId: string, seconds: number) => void;
  onDeleteClip: (clipId: string) => void;
  onSplitClip: (clipId: string, start: number, end: number, generate?: boolean) => void;
  onMergeClip: (clipId: string) => void;
  onMoveClip?: (clipId: string, direction: VoiceClipMoveDirection) => void;
  onGapChange: (clipId: string, seconds: number) => void;
  onRewriteClip: (clipId: string, original: string, replacement: string) => void;
  onUndo: () => void;
  onOpenStoryboard?: (clipId: string) => void;
  onReferenceModeChange?: (clipId: string, mode: StoryboardReferenceMode) => void;
  referenceModeBusy?: boolean;
};

const buttonClass = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-studio-line px-2.5 py-1.5 text-xs text-studio-muted hover:bg-white/5 hover:text-studio-text focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-35 disabled:cursor-not-allowed";

const audioStateStyles = {
  adopted: { label: "已采用", dot: "bg-emerald-200 ring-emerald-300/15", number: "text-emerald-200/85", badge: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" },
  pending: { label: "待生成", dot: "bg-slate-400 ring-slate-300/10", number: "text-studio-muted", badge: "border-slate-400/25 bg-slate-400/10 text-slate-200" },
  unadopted: { label: "已生成未采用", dot: "bg-amber-200 ring-amber-300/15", number: "text-amber-200/85", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  needs_update: { label: "文案已改 · 待更新", dot: "bg-amber-200 ring-amber-300/15", number: "text-amber-200/85", badge: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
} as const;

const storyboardStateStyles = {
  ready: { label: "设计已完成", dot: "bg-emerald-200 ring-emerald-300/15", button: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15" },
  pending: { label: "设计待生成", dot: "bg-slate-400 ring-slate-300/10", button: "border-transparent text-studio-muted/55 hover:border-slate-300/20 hover:bg-white/5 hover:text-slate-200" },
  needs_update: { label: "设计待更新", dot: "bg-amber-200 ring-amber-300/15", button: "border-amber-300/25 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15" },
} as const;

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
    段后等待
    <input aria-label={label} type="number" min="0" max="600" step="0.1" value={input}
      className="w-20 rounded-md border border-studio-line bg-black/20 px-2 py-1.5 text-studio-text"
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => { const seconds = Number(input); if (input.trim() && Number.isFinite(seconds) && seconds >= 0 && seconds <= 600) { if (Math.abs(seconds - value) > 0.0005) onChange(seconds); } else setInput(String(value)); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />秒
  </label>;
}

export function ScriptEditorPanel({ project, selectedClipId, busy, canUndo, notice, batchActions, workspaceTabs, paragraphBody, audioStates, audioStatesStatus = "ready", onSelectClip, onUpdateClip, onAddClip, onAddSilentClip, onSilentDurationChange, onDeleteClip, onSplitClip, onMergeClip, onMoveClip, onGapChange, onRewriteClip, onUndo, onOpenStoryboard, onReferenceModeChange, referenceModeBusy = false }: ScriptEditorPanelProps) {
  const clips = flattenClips(project);
  const voices = clips.filter((clip) => clip.type === "voice");
  const storyboardProgress = useMemo(() => getStudioStoryboardProgress(project), [project]);
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
      <div>{workspaceTabs ?? <h2 className="text-sm font-semibold">文案与分段</h2>}</div>
      <div className="flex items-center gap-1.5"><button type="button" aria-label="撤回编辑" title="撤回文案编辑" className={buttonClass} disabled={!canUndo} onClick={onUndo}><Undo2 className="h-3.5 w-3.5" /></button><button type="button" aria-label="新增一段" className={buttonClass} onClick={() => onAddClip(selectedClipId ?? voices.at(-1)?.id)}><Plus className="h-3.5 w-3.5" />台词</button>{onAddSilentClip && <button type="button" aria-label="新增无台词段" className={`${buttonClass} text-violet-200`} onClick={() => onAddSilentClip(selectedClipId ?? voices.at(-1)?.id)}><Film className="h-3.5 w-3.5" />无台词</button>}</div>
    </div>
    {batchActions && <div className="shrink-0">{batchActions}</div>}
    <div data-script-scroll className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-2">
      {notice && <p role="status" className="rounded-lg bg-sky-300/5 px-3 py-2 text-xs leading-5 text-sky-100">{notice}</p>}
      {paragraphBody}
      {!paragraphBody && !voices.length && <p className="p-3 text-sm text-studio-muted">添加第一段台词，开始编排。</p>}
      {!paragraphBody && clips.map((clip) => {
        const isSelected = clip.id === selectedClipId;
        const index = voices.findIndex((voice) => voice.id === clip.id);
        const range = isSelected && selection?.clipId === clip.id && clip.type === "voice" && selection.text === clip.text ? selection : undefined;
        const hasRange = !!range && range.end > range.start && !!clipTitle(clip).slice(range.start, range.end).trim();
        const canSplit = !!range && (hasRange ? range.start > 0 || range.end < clipTitle(clip).length : range.start > 0 && range.start < clipTitle(clip).length);
        const gap = clip.type === "voice" ? getVoiceGapAfter(project, clip.id) : null;
        if (clip.type !== "voice") return <button type="button" key={clip.id} aria-pressed={isSelected} onClick={() => onSelectClip(clip.id)} className={`w-full rounded-md px-2 py-1.5 text-left ${isSelected ? "bg-sky-300/10 ring-1 ring-sky-300/35" : "text-studio-muted hover:bg-white/[0.025]"}`}><span className="text-sm">{clipTitle(clip)}</span><span className="ml-3 text-xs text-studio-muted">{getTrackLabel(clip.track)} · {formatTimeRange(clip.start, clip.duration)}</span></button>;
        const silent = clip.kind === "silent";
        const audioState = silent ? undefined : audioStates?.[clip.id];
        const knownState = audioState && (audioState === "adopted" || audioStatesStatus === "ready") ? audioStateStyles[audioState] : undefined;
        const audioStateLabel = knownState?.label ?? (!clip.text.trim() ? "待填写台词" : audioStatesStatus === "error" ? "音频状态暂不可用" : "正在读取音频状态");
        const storyboardState = storyboardProgress.byClip[clip.id] ?? "pending";
        const storyboardStyle = storyboardStateStyles[storyboardState];
        const referenceMode = getClipStoryboardReferenceMode(project, clip.id);
        const referenceLabel = referenceMode === "continuous" ? "连续镜头" : "新镜头";
        const nextReferenceMode = referenceMode === "continuous" ? "new" : "continuous";
        const referenceTitle = index === 0 ? `第 1 段：新镜头。首段从剧情背景开始，无上一段镜头可延续。` : `第 ${index + 1} 段：${referenceLabel}，点击切换为${referenceMode === "continuous" ? "新镜头" : "连续镜头"}（用于下次生成）`;
        const showReferenceMode = !!onOpenStoryboard && !!onReferenceModeChange;
        const rowColumns = onMoveClip
          ? showReferenceMode ? "grid-cols-[22px_minmax(0,1fr)_48px_32px_32px]" : onOpenStoryboard ? "grid-cols-[22px_minmax(0,1fr)_48px_32px]" : "grid-cols-[22px_minmax(0,1fr)_48px]"
          : showReferenceMode ? "grid-cols-[22px_minmax(0,1fr)_32px_32px]" : onOpenStoryboard ? "grid-cols-[22px_minmax(0,1fr)_32px]" : "grid-cols-[22px_minmax(0,1fr)]";
        const textField = <textarea aria-label={silent ? "无台词段描述" : isSelected ? "台词" : `第 ${index + 1} 段台词`} value={clip.text} rows={1}
          onFocus={() => onSelectClip(clip.id)}
          onSelect={(event) => { const node = event.currentTarget; setSelection({ clipId: clip.id, text: clip.text, start: node.selectionStart, end: node.selectionEnd }); }}
          onChange={(event) => { setSelection(undefined); onUpdateClip(clip.id, { text: event.target.value }); }}
          className={`block min-h-8 w-full min-w-0 resize-none rounded border px-1.5 py-0.5 text-sm leading-7 outline-none [field-sizing:content] ${silent
            ? `text-violet-50/90 focus:border-violet-300/45 ${isSelected ? "border-violet-300/15 bg-black/10" : "border-transparent bg-transparent"}`
            : isSelected ? "border-sky-300/25 bg-black/10 focus:border-sky-300/50" : "border-transparent bg-transparent"}`} />;
        return <article key={clip.id} data-clip-kind={silent ? "silent" : "speech"} aria-label={silent ? `第 ${index + 1} 段无台词段` : undefined} ref={(node) => { if (node) cards.current.set(clip.id, node); else cards.current.delete(clip.id); }} className={`min-w-0 transition-colors ${silent
          ? `my-2 rounded-lg border border-l-2 bg-linear-to-r px-2 py-2 ${isSelected ? "border-violet-300/30 border-l-violet-300/75 from-violet-300/10 to-violet-300/[0.025]" : "border-violet-300/15 border-l-violet-300/40 from-violet-300/[0.055] to-violet-300/[0.015] hover:border-violet-300/25"}`
          : `rounded-md px-1.5 py-1 ${isSelected ? "bg-sky-300/[0.045]" : "hover:bg-white/[0.02]"}`}`}>
          <div className={`grid min-w-0 items-start gap-2 ${rowColumns}`}>
          <button type="button" aria-label={`选择第 ${index + 1} 段`} aria-pressed={isSelected} title={silent ? "无台词段 · 表演与声音" : audioStates ? audioStateLabel : undefined} className={`flex min-h-8 flex-col items-center justify-center gap-1 text-[11px] tabular-nums ${isSelected ? "font-semibold" : "font-medium"} ${silent ? "text-violet-200" : knownState?.number ?? (isSelected ? "text-sky-100" : "text-studio-muted/60")}`} onClick={() => onSelectClip(clip.id)}>
            {silent ? <Film className="h-3.5 w-3.5 text-violet-200/80" aria-hidden="true" /> : audioStates && <span role="img" aria-label={`第 ${index + 1} 段音频状态：${audioStateLabel}`} data-audio-state={knownState ? audioState : "unknown"} className={`h-1.5 w-1.5 shrink-0 rounded-full ${knownState ? `ring-2 ${knownState.dot}` : "border border-slate-400/40"}`} />}
            <span>{String(index + 1).padStart(2, "0")}</span>
          </button>
          {silent ? <div className="min-w-0">
            <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1.5">
              <span className="shrink-0 rounded border border-violet-300/15 bg-violet-300/[0.07] px-1.5 py-0.5 text-[10px] font-medium leading-none tracking-wide text-violet-100/90">无台词段</span>
              <span className="shrink-0 text-[10px] tabular-nums text-violet-200/60">{Number(clip.duration.toFixed(1))} 秒</span>
            </div>
            {textField}
          </div> : textField}
          {onMoveClip && <div data-clip-move-controls className="flex h-8 w-12 shrink-0 items-center rounded-md border border-studio-line/60">
            {(["up", "down"] as const).map((direction) => <button key={direction} type="button" aria-label={`${direction === "up" ? "上移" : "下移"}第 ${index + 1} 段`} title={`${direction === "up" ? "上移" : "下移"}本段（保留已采用音频）`} disabled={busy || (direction === "up" ? index === 0 : index === voices.length - 1)} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); onMoveClip(clip.id, direction); }} className="flex h-8 w-6 items-center justify-center rounded text-studio-muted/65 hover:bg-white/5 hover:text-sky-100 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-25">{direction === "up" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}</button>)}
          </div>}
          {onOpenStoryboard ? <button type="button" aria-label={`第 ${index + 1} 段画面与声音`} title={`${storyboardStyle.label} · ${project.videoPlan?.shots[clip.id] ? "查看本段画面与声音" : "生成本段画面与声音"}`} onClick={() => onOpenStoryboard(clip.id)} className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-violet-300 ${storyboardStyle.button}`}><Clapperboard className="h-3.5 w-3.5" aria-hidden="true" /><span role="img" aria-label={`第 ${index + 1} 段分镜状态：${storyboardStyle.label}`} data-storyboard-state={storyboardState} className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-2 ${storyboardStyle.dot}`} /></button> : null}
          {showReferenceMode ? <button type="button" aria-label={referenceTitle} title={referenceTitle} aria-pressed={referenceMode === "continuous"} data-reference-mode={referenceMode} disabled={index === 0 || referenceModeBusy} onClick={(event) => { event.stopPropagation(); onReferenceModeChange?.(clip.id, nextReferenceMode); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-45 ${referenceMode === "continuous" ? "border-violet-300/25 bg-violet-300/10 text-violet-200 hover:bg-violet-300/20 focus-visible:outline-violet-300" : "border-cyan-300/20 bg-cyan-300/5 text-cyan-200 hover:bg-cyan-300/15 focus-visible:outline-cyan-300"}`}>{referenceMode === "continuous" ? <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> : <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />}</button> : null}
          </div>
          {isSelected && <div className="ml-[30px] mt-1 space-y-2 pb-1">
            <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] tabular-nums text-studio-muted">{formatTimeRange(clip.start, clip.duration)}</span>{silent ? <span className="text-[11px] text-violet-200/75">表演与声音</span> : knownState && clip.generation.status !== "asset_generating" && clip.generation.status !== "asset_failed" ? <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold ${knownState.badge}`}>{knownState.label}</span> : <StatusBadge status={clip.generation.status} />}</div>
            {hasRange && <p className="text-xs text-sky-100">已选 {range!.end - range!.start} 字：<span className="break-words">{clip.text.slice(range!.start, range!.end).slice(0, 100)}{range!.end - range!.start > 100 ? "…" : ""}</span></p>}
            {!silent && (canSplit || hasRange) && <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} title={clip.asset.uri ? "拆分后需重新生成涉及片段；原音可从历史版本恢复" : undefined} disabled={!canSplit} onClick={() => range && onSplitClip(clip.id, range.start, range.end)}><Scissors className="h-3.5 w-3.5" />{hasRange ? "选区独立成段" : "在光标处分段"}</button>
              <button type="button" className={`${buttonClass} border-sky-300/30 text-sky-100`} disabled={!hasRange || busy} onClick={() => range && onSplitClip(clip.id, range.start, range.end, true)}>生成选区音频</button>
              <button type="button" className={buttonClass} disabled={!clip.text.trim()} onClick={() => setRewrite(hasRange ? range : { clipId: clip.id, text: clip.text, start: 0, end: clip.text.length })}><Sparkles className="h-3.5 w-3.5" />{hasRange ? "AI 改写选区" : "AI 改写本段"}</button>
            </div>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {silent && onSilentDurationChange ? <label className="flex items-center gap-2 text-xs text-violet-200/75">段落时长<input aria-label="无台词段时长" type="number" min="0.5" max="600" step="0.5" value={clip.duration} onChange={(event) => { const value = Number(event.target.value); if (value >= 0.5 && value <= 600) onSilentDurationChange(clip.id, value); }} className="w-16 rounded-md border border-violet-300/20 bg-black/10 px-2 py-1 text-violet-100 outline-none focus:border-violet-300/45" />秒</label> : gap !== null && !clip.performance && <GapInput key={`${clip.id}:${gap}`} value={gap} label={`第 ${index + 1} 段后等待秒数`} onChange={(seconds) => onGapChange(clip.id, seconds)} />}
              <details className="relative ml-auto"><summary aria-label="本段更多操作" className={`${buttonClass} cursor-pointer list-none`}><MoreHorizontal className="h-4 w-4" /></summary><div className="absolute right-0 top-full z-20 mt-1 grid min-w-36 gap-1 rounded-lg border border-studio-line bg-studio-panel p-1.5 shadow-xl">
                {!silent && <button type="button" className={buttonClass} disabled={!clip.text.trim()} onClick={() => setRewrite({ clipId: clip.id, text: clip.text, start: 0, end: clip.text.length })}><Sparkles className="h-3.5 w-3.5" />AI 改写本段</button>}
                <button className={buttonClass} type="button" onClick={() => onAddClip(clip.id)}>下方插入台词</button>{onAddSilentClip && <button className={buttonClass} type="button" onClick={() => onAddSilentClip(clip.id)}>下方插入无台词</button>}
                {!silent && <button className={buttonClass} type="button" disabled={index === voices.length - 1 || voices[index + 1]?.kind === "silent"} onClick={() => onMergeClip(clip.id)}>合并下一段</button>}
                <button className={`${buttonClass} hover:text-rose-200`} type="button" onClick={() => onDeleteClip(clip.id)}>删除本段</button>
              </div></details>
            </div>
          </div>}
        </article>;
      })}
    </div>
    {rewrite && <ScriptRewrite key={`${rewrite.clipId}:${rewrite.start}:${rewrite.end}`} project={project} range={rewrite} onApply={onRewriteClip} onClose={() => setRewrite(undefined)} />}
  </section>;
}
