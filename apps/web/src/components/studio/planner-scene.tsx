"use client";

import { useState } from "react";
import { MapPin, Sparkles } from "lucide-react";

import type { PlannerDraft } from "@/lib/asmr/planner";

type Props = {
  draft: PlannerDraft | null;
  sceneDescription: string | null;
  busy: boolean;
  canGenerate: boolean;
  onGenerate: (instruction: string) => void;
  onEdit: (value: string) => void;
  onEditCharacter?: (value: string) => void;
  onBack: () => void;
};

const fieldClass = "w-full min-w-0 resize-none rounded-xl border border-studio-line bg-black/15 px-4 py-3 text-sm leading-7 text-studio-text outline-none placeholder:text-studio-muted/50 focus:border-violet-300/40 focus:ring-2 focus:ring-violet-300/10";
const buttonClass = "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-300/20 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40";

export function PlannerSceneEditor({ draft, sceneDescription, busy, canGenerate, onGenerate, onEdit, onEditCharacter, onBack }: Props) {
  const [instruction, setInstruction] = useState("");

  return <div className="mx-auto max-w-[860px] space-y-4">
    <div className="rounded-xl border border-violet-300/10 bg-violet-300/[0.035] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-300/10 text-violet-200"><MapPin className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0"><h3 className="text-sm font-semibold">剧情背景</h3></div>
        </div>
        {draft ? <button type="button" className={buttonClass} disabled={busy || !canGenerate} onClick={() => onGenerate(instruction)}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{sceneDescription?.trim() ? "重新生成背景" : "生成背景"}</button> : null}
      </div>
      {draft ? <details className="mt-4 border-t border-violet-300/10 pt-3 text-xs text-studio-muted"><summary className="w-fit cursor-pointer hover:text-violet-100">背景偏好 <span className="ml-1 text-studio-muted/55">选填</span></summary><textarea aria-label="背景生成要求" value={instruction} maxLength={1200} rows={2} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} mt-2`} placeholder="例如：屋内温暖安静，窗外下着雪。" /></details> : null}
    </div>
    {draft || sceneDescription !== null ? <div className="space-y-3 rounded-xl border border-studio-line bg-black/[0.08] p-4 sm:p-5">
      {draft && onEditCharacter ? <label className="block min-w-0 space-y-2"><span className="text-xs font-medium text-violet-200/80">文案角色</span><input aria-label="文案角色" className={fieldClass} value={draft.character.role} maxLength={200} onChange={(event) => onEditCharacter(event.target.value)} /></label> : null}
      <label className="block min-w-0 space-y-2"><span className="text-xs font-medium text-violet-200/80">背景描述</span><textarea aria-label="剧情背景" value={sceneDescription ?? draft?.scene ?? ""} maxLength={4000} rows={5} spellCheck={false} onChange={(event) => onEdit(event.target.value)} className={`${fieldClass} min-h-36 [field-sizing:content]`} placeholder="雪地中的木屋内，壁炉温暖，窗外飘雪。" /></label>
    </div> : <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-studio-line px-6 py-10 text-center">
      <MapPin className="mb-3 h-8 w-8 text-violet-200/45" aria-hidden="true" /><h4 className="text-base font-medium">先写下故事，再确定背景</h4><p className="mt-2 max-w-sm text-xs leading-6 text-studio-muted">生成或载入文案后，准备一段简短的剧情背景。</p><button type="button" className={`${buttonClass} mt-4`} onClick={onBack}>返回文案</button>
    </div>}
  </div>;
}
