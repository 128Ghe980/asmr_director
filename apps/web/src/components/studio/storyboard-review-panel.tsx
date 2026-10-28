"use client";

import type { StoryboardReview } from "@/lib/asmr/storyboard-review";
import { useState } from "react";
import { formatAsmrSound } from "./asmr-sound-editor";

const fields = [{ key: "title", label: "标题" }, { key: "visual", label: "画面" }, { key: "action", label: "动作" }, { key: "camera", label: "镜头" }, { key: "ambientSound", label: "环境声" }] as const;
const button = "min-h-7 rounded-md border border-violet-300/20 px-2 text-[11px] text-violet-100 hover:bg-violet-300/10 disabled:opacity-35";
export type StoryboardReviewResult = { review: StoryboardReview; automatic: boolean; applied: boolean; afterFingerprint?: string };

/** Pending review stays in memory. Details expand in page flow without nested scrolling. */
export function StoryboardReviewPanel({ result, notice, disabled = false, current = true, canUndo = false, onApply, onUndo }: {
  result?: StoryboardReviewResult; notice?: string; disabled?: boolean; current?: boolean; canUndo?: boolean; onApply: () => void; onUndo: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!result && !notice) return null;
  return <section aria-label="整批校对结果" className="min-w-0 border-b border-studio-line bg-violet-300/[0.025] px-3 py-2">
    {notice && <p role="status" className="break-words text-[11px] leading-5 text-studio-muted">{notice}</p>}
    {result && <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[11px]">
        <p className="text-studio-muted">{result.applied ? "校对修订已应用" : "校对建议，尚未修改分镜"} · {result.review.changes.length} 镜调整</p>
        {!result.applied && result.review.changes.length > 0 && <button type="button" className={button} disabled={disabled || !current} onClick={onApply}>应用修订</button>}
        {result.applied && result.review.changes.length > 0 && <button type="button" className={button} disabled={disabled || !canUndo} title={canUndo ? "仅还原本次校对的分镜修改，保留当前音频和处理设置。" : "分镜或其来源已修改，不能撤回这次校对。"} onClick={onUndo}>撤回校对</button>}
      </div>
      {!current && !result.applied && <p className="mt-1 text-[11px] text-amber-100">剧情或分镜已修改，请重新整批校对。</p>}
      <details className="mt-1 min-w-0" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer py-1 text-[11px] text-studio-muted">校对改动与说明</summary>
        {expanded && <div className="space-y-2 text-[11px] leading-5">{result.review.changes.map(change => <article key={change.clipId} className="min-w-0 rounded border border-studio-line p-2">
          <p className="break-words text-violet-100">{change.before.title || change.clipId} · {change.reason}</p>
          {fields.filter(field => change.before[field.key] !== change.after[field.key]).map(field => <div key={field.key} className="mt-1 break-words"><p className="text-studio-muted">{field.label}原文：{change.before[field.key] || "（无）"}</p><p className="text-studio-text">修订：{change.after[field.key] || "（无）"}</p></div>)}
          {JSON.stringify(change.before.asmrSound) !== JSON.stringify(change.after.asmrSound) && <div className="mt-1 whitespace-pre-line break-words"><p className="text-studio-muted">ASMR 触发音原文：{formatAsmrSound(change.before.asmrSound)}</p><p className="text-studio-text">修订：{formatAsmrSound(change.after.asmrSound)}</p></div>}
        </article>)}{result.review.notes.map((note, index) => <p key={index} className="break-words text-studio-muted">{note}</p>)}</div>}
      </details>
    </>}
  </section>;
}
