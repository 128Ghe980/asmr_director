"use client";

import { Clapperboard, VolumeX } from "lucide-react";
import type { AsmrProject } from "@/lib/asmr/schema";
import { getSpeechParagraphs } from "@/lib/asmr/speech-workspace";
import { flattenClips } from "@/lib/asmr/view-model";
import type { ClipPatch } from "@/lib/asmr/edit-project";

type Props = {
  project: AsmrProject;
  selectedClipId?: string;
  onSelectClip: (id: string) => void;
  onUpdateParagraph: (id: string, text: string) => void;
  onUpdateClip: (id: string, patch: ClipPatch) => void;
  onDurationChange: (id: string, duration: number) => void;
  onOpenStoryboard?: (id: string) => void;
  onDeleteClip: (id: string) => void;
};

export function ParagraphScriptList({ project, selectedClipId, onSelectClip, onUpdateParagraph, onUpdateClip, onDurationChange, onOpenStoryboard, onDeleteClip }: Props) {
  const paragraphs = getSpeechParagraphs(project);
  const silent = flattenClips(project).filter((clip) => clip.type === "voice" && clip.kind === "silent");
  const entries = [
    ...paragraphs.map((paragraph) => ({ start: paragraph.clips[0]?.start ?? 0, paragraph, silent: undefined })),
    ...silent.map((clip) => ({ start: clip.start, paragraph: undefined, silent: clip })),
  ].sort((a, b) => a.start - b.start);
  return <div className="space-y-3">
    {entries.map(({ paragraph, silent: clip }, index) => {
      if (clip?.type === "voice") return <article key={clip.id} className={`rounded-lg border p-3 ${clip.id === selectedClipId ? "border-violet-300/30 bg-violet-300/5" : "border-studio-line"}`}>
        <div className="mb-2 flex items-center justify-between text-xs text-violet-200">
          <button type="button" className="inline-flex items-center gap-2" onClick={() => onSelectClip(clip.id)}><VolumeX className="h-3.5 w-3.5" />无对白镜头</button>
          <div className="flex items-center gap-3"><button type="button" onClick={() => { onSelectClip(clip.id); onOpenStoryboard?.(clip.id); }}>分镜</button><button type="button" aria-label="删除无对白镜头" className="text-studio-muted hover:text-rose-200" onClick={() => onDeleteClip(clip.id)}>删除</button></div>
        </div>
        <textarea aria-label="无对白镜头描述" value={clip.text} onFocus={() => onSelectClip(clip.id)} onChange={(event) => onUpdateClip(clip.id, { text: event.target.value })} rows={2} className="w-full resize-none rounded-md border border-studio-line bg-black/10 px-2 py-1.5 text-sm leading-6 outline-none focus:border-violet-300/40" />
        <label className="mt-2 flex items-center gap-2 text-xs text-studio-muted">镜头时长<input aria-label="无对白镜头时长" type="number" min="0.5" max="600" step="0.5" value={clip.duration} onChange={(event) => { const value = Number(event.target.value); if (value >= 0.5 && value <= 600) onDurationChange(clip.id, value); }} className="w-16 rounded border border-studio-line bg-black/10 px-2 py-1" />秒</label>
      </article>;
      if (!paragraph) return null;
      const selected = paragraph.clipIds.includes(selectedClipId ?? "");
      const stale = paragraph.clips.some((item) => item.audio_stale);
      const adopted = paragraph.clips.every((item) => item.asset.uri);
      return <article key={paragraph.id} className={`rounded-lg border p-3 transition-colors ${selected ? "border-sky-300/30 bg-sky-300/[0.035]" : "border-studio-line hover:bg-white/[0.02]"}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" aria-label={`选择整段 ${index + 1}`} aria-pressed={selected} onClick={() => onSelectClip(paragraph.clipIds[0])} className="flex items-center gap-2 text-xs font-medium"><span className="text-sky-200 tabular-nums">{String(index + 1).padStart(2, "0")}</span><span>整段</span><span className="font-normal text-studio-muted">{paragraph.clips.length} 个短句</span></button>
          <span className={`text-[11px] ${stale ? "text-amber-200" : adopted ? "text-emerald-200" : "text-studio-muted"}`}>{stale ? "文案已改 · 待更新" : adopted ? "已采用" : "待生成"}</span>
        </div>
        <textarea aria-label={`整段 ${index + 1} 文案`} value={paragraph.text} onFocus={() => { if (!selected) onSelectClip(paragraph.clipIds[0]); }} onChange={(event) => onUpdateParagraph(paragraph.id, event.target.value)} rows={3} className="block w-full min-w-0 resize-none rounded-md border border-studio-line bg-black/10 px-2.5 py-2 text-sm leading-7 outline-none [field-sizing:content] focus:border-sky-300/50" />
        {selected && <div className="mt-3 space-y-1 border-t border-studio-line pt-2">
          <p className="mb-2 text-[11px] text-studio-muted">生成后按这些短句切分；每句保留独立分镜。</p>
          {paragraph.clips.map((item, sentence) => <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 ${item.id === selectedClipId ? "bg-sky-300/5" : ""}`}>
            <button type="button" aria-label={`选择整段内短句 ${sentence + 1}`} onClick={() => onSelectClip(item.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left text-xs leading-5"><span className="shrink-0 text-studio-muted/70">{sentence + 1}</span><span className="min-w-0 break-words text-studio-muted">{item.text}</span></button>
            {onOpenStoryboard && <button type="button" aria-label={`整段内短句 ${sentence + 1} 分镜`} title="查看或生成本句分镜" onClick={() => { onSelectClip(item.id); onOpenStoryboard(item.id); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-studio-line text-violet-200 hover:bg-violet-300/10"><Clapperboard className="h-3.5 w-3.5" /></button>}
          </div>)}
        </div>}
      </article>;
    })}
    {!entries.length && <p className="px-2 py-4 text-sm text-studio-muted">添加台词或采用 AI 创意，开始编排。</p>}
  </div>;
}
