"use client";

import { AudioLines, Clapperboard, LoaderCircle, X } from "lucide-react";

import type { StudioBatchAction } from "@/lib/asmr/studio-batch-generation";
import type { StudioAudioOverview } from "@/lib/asmr/studio-audio-overview";

export type StudioBatchProgress = {
  action: StudioBatchAction;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentClipId?: string;
};

type StudioBatchActionsProps = {
  counts: Record<StudioBatchAction, number>;
  audioOverview?: StudioAudioOverview;
  overviewStatus?: "loading" | "ready" | "error";
  disabled?: boolean;
  progress?: StudioBatchProgress;
  notice?: string;
  onRun: (action: StudioBatchAction) => void;
  onCancel: () => void;
};

const groups = [
  {
    label: "音频",
    icon: AudioLines,
    tone: "border-sky-300/15 bg-sky-300/[0.035] text-sky-100",
    buttonTone: "border-sky-300/20 bg-sky-300/[0.06] hover:bg-sky-300/12 focus-visible:outline-sky-300",
    actions: [
      { action: "audio_missing", label: "全部生成", accessibleLabel: "音频全部生成", title: "生成尚未采用音频的段落，沿用当前声音设置。" },
      { action: "audio_all", label: "全部重生成", accessibleLabel: "音频全部重新生成", title: "按当前声音设置重新生成全部音频。" },
    ],
  },
  {
    label: "分镜",
    icon: Clapperboard,
    tone: "border-violet-300/15 bg-violet-300/[0.035] text-violet-100",
    buttonTone: "border-violet-300/20 bg-violet-300/[0.06] hover:bg-violet-300/12 focus-visible:outline-violet-300",
    actions: [
      { action: "storyboard_missing", label: "全部生成", accessibleLabel: "分镜全部生成", title: "使用已采用音频生成分镜。" },
      { action: "storyboard_all", label: "全部重生成", accessibleLabel: "分镜全部重新生成", title: "使用已采用音频重新生成全部分镜。" },
    ],
  },
] as const;

export function StudioBatchActions({ counts, audioOverview, overviewStatus = "ready", disabled = false, progress, notice, onRun, onCancel }: StudioBatchActionsProps) {
  const active = progress !== undefined;
  const total = Math.max(0, progress?.total ?? 0);
  const completed = Math.min(total, Math.max(0, progress?.completed ?? 0));
  const audio = progress?.action.startsWith("audio");
  const result = progress ? [
    progress.succeeded > 0 ? `成功 ${progress.succeeded}` : null,
    progress.failed > 0 ? `失败 ${progress.failed}` : null,
    progress.skipped > 0 ? `跳过 ${progress.skipped}` : null,
  ].filter(Boolean).join(" · ") : "";

  return <div aria-label="批量生成" role="group" className="@container min-w-0 border-b border-studio-line bg-black/10 px-3 py-2">
    {audioOverview && <div aria-label="音频总览" role="group" className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
      <span className="text-studio-muted">音频总览</span>
      <span role="status" aria-live="polite" aria-atomic="true"
        aria-label={overviewStatus === "ready" ? `已采用 ${audioOverview.adopted} 段，待生成 ${audioOverview.pending} 段，已生成未采用 ${audioOverview.unadopted} 段，共 ${audioOverview.total} 段` : overviewStatus === "error" ? "音频总览暂时无法读取" : "正在读取音频总览"}
        title="按当前文案的段落统计；多个候选只计一段，过期或已放弃候选不计入未采用。"
        className="inline-flex items-center gap-1.5 rounded-md border border-white/5 bg-white/[0.025] px-2 py-0.5 text-[13px] font-semibold tabular-nums">
        <span className="text-emerald-200">{audioOverview.adopted}</span><span aria-hidden="true" className="font-normal text-studio-muted/50">/</span>
        <span className="text-studio-text">{overviewStatus === "ready" ? audioOverview.pending : "—"}</span><span aria-hidden="true" className="font-normal text-studio-muted/50">/</span>
        <span className="text-amber-200">{overviewStatus === "ready" ? audioOverview.unadopted : "—"}</span>
      </span>
      <span className="text-[10px] text-studio-muted">已采用 / 待生成 / 已生成未采用</span>
      {overviewStatus === "error" && <span className="text-[10px] text-amber-200/80">统计暂不可用</span>}
    </div>}
    <div className="grid min-w-0 grid-cols-1 gap-2 @min-[34rem]:grid-cols-2">
      {groups.map((group) => <div key={group.label} role="group" aria-label={`批量${group.label}`} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 ${group.tone}`}>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium"><group.icon className="h-3.5 w-3.5" aria-hidden="true" />{group.label}</span>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          {group.actions.map(({ action, label, accessibleLabel, title }) => <button key={action} type="button" aria-label={accessibleLabel} title={title}
            disabled={disabled || active || counts[action] <= 0} onClick={() => onRun(action)}
            className={`inline-flex min-h-8 min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-35 ${group.buttonTone}`}>
            <span className="whitespace-nowrap">{label}</span><span aria-hidden="true" className="rounded bg-white/5 px-1 py-0.5 text-[10px] leading-none tabular-nums">{counts[action]}</span>
          </button>)}
        </div>
      </div>)}
    </div>
    {progress && <div className="mt-2 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
        <p role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-studio-muted"><span className={`inline-flex items-center gap-1.5 ${audio ? "text-sky-100" : "text-violet-100"}`}><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />{audio ? "音频" : "分镜"} · 完成 {completed}/{total}</span>{result && <span>{result}</span>}</p>
        <button type="button" onClick={onCancel} aria-label="取消批量生成" className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-studio-muted hover:bg-white/5 hover:text-studio-text focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-3 w-3" aria-hidden="true" />取消</button>
      </div>
      <div role="progressbar" aria-label={`${audio ? "音频" : "分镜"}批量进度`} aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={completed} aria-valuetext={`完成 ${completed}/${total}`} className="h-1 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full transition-[width] ${audio ? "bg-sky-300/65" : "bg-violet-300/65"}`} style={{ width: `${total > 0 ? completed / total * 100 : 0}%` }} />
      </div>
    </div>}
    {notice && <p role="status" className="mt-2 break-words text-[11px] leading-5 text-studio-muted">{notice}</p>}
  </div>;
}
