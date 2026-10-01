"use client";

import { useRef, useState } from "react";
import { Check, Clapperboard, Copy, Film, Sparkles } from "lucide-react";

import type { PlannerDraft } from "@/lib/asmr/planner";
import { isStoryboardCurrent, type PlannerStoryboard, type StoryboardShot } from "@/lib/asmr/storyboard";
import { createH3ShotPrompt } from "@/lib/asmr/storyboard-prompt";

type Props = {
  draft: PlannerDraft | null;
  storyboard: PlannerStoryboard | null;
  busy: boolean;
  canGenerate: boolean;
  onGenerate: (instruction: string) => void;
  onEdit: (id: string, patch: Partial<StoryboardShot>) => void;
  onBack: () => void;
};

const fieldClass = "w-full min-w-0 resize-none rounded-lg border border-studio-line bg-black/15 px-3 py-2 text-sm leading-6 text-studio-text outline-none [field-sizing:content] placeholder:text-studio-muted/50 focus:border-violet-300/40 focus:ring-2 focus:ring-violet-300/10";
const generateClass = "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-300/20 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40";

function H3ShotPrompt({ prompt, index, disabledReason }: { prompt: string; index: number; disabledReason: string }) {
  const preview = useRef<HTMLTextAreaElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [feedback, setFeedback] = useState({ prompt: "", copied: false });
  const currentFeedback = feedback.prompt === prompt && !!prompt;

  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setFeedback({ prompt, copied: true });
    } catch {
      if (disclosure.current) disclosure.current.open = true;
      preview.current?.focus();
      preview.current?.select();
      setFeedback({ prompt, copied: false });
    }
  }

  return <div className="border-t border-violet-300/10 bg-violet-300/[0.025] px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <details ref={disclosure} className="min-w-0 flex-1 basis-44 text-xs text-studio-muted">
        <summary className="w-fit cursor-pointer py-1.5 font-medium text-violet-200/80 hover:text-violet-100">H3 提示词</summary>
        {prompt ? <textarea ref={preview} aria-label={`第 ${index + 1} 镜 H3 提示词`} readOnly value={prompt} rows={8} spellCheck={false} className="mt-3 max-h-80 w-full min-w-0 resize-y rounded-lg border border-violet-300/15 bg-black/20 px-3 py-2 font-mono text-xs leading-6 text-studio-text outline-none focus:border-violet-300/40" /> : <p className="mt-2 text-xs leading-5">{disabledReason}</p>}
      </details>
      <button type="button" aria-label={`复制第 ${index + 1} 镜提示词`} disabled={!prompt} onClick={() => void copy()} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-violet-300/15 px-2.5 py-1.5 text-[11px] text-violet-100 transition-colors hover:bg-violet-300/10 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40">{currentFeedback && feedback.copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}{currentFeedback && feedback.copied ? "已复制" : "复制提示词"}</button>
    </div>
    {currentFeedback && !feedback.copied ? <p role="status" className="mt-2 text-xs leading-5 text-amber-100">自动复制未成功，已选中提示词，请手动复制。</p> : null}
  </div>;
}

export function PlannerStoryboardEditor({ draft, storyboard, busy, canGenerate, onGenerate, onEdit, onBack }: Props) {
  const [instruction, setInstruction] = useState("");
  const stale = !!draft && !!storyboard && !isStoryboardCurrent(storyboard, draft);

  return <div className="mx-auto max-w-[980px] space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-violet-300/10 bg-violet-300/[0.035] px-4 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-300/10 text-violet-200"><Clapperboard className="h-4.5 w-4.5" aria-hidden="true" /></div>
        <div><h3 className="text-sm font-semibold">让故事有画面 <span className="ml-1.5 rounded border border-violet-300/20 px-1.5 py-0.5 text-[9px] font-normal tracking-wide text-violet-200/75">H3</span></h3><p className="mt-1 max-w-lg text-xs leading-5 text-studio-muted">按台词规划英文画面、动作与镜头，保留原文对白。每镜可直接复制 H3 提示词。</p></div>
      </div>
      {draft ? <button type="button" className={generateClass} disabled={busy || !canGenerate} onClick={() => onGenerate(instruction)}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{storyboard ? "重新生成分镜" : "生成分镜"}</button> : null}
      {draft ? <details className="w-full border-t border-violet-300/10 pt-3 text-xs text-studio-muted"><summary className="w-fit cursor-pointer hover:text-violet-100">分镜偏好 <span className="ml-1 text-studio-muted/55">选填</span></summary><textarea aria-label="分镜生成要求" value={instruction} maxLength={1200} rows={2} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} mt-2`} placeholder="例如：保持第一人称视角，镜头平缓，突出手部动作。" /></details> : null}
      {draft ? <p className="w-full text-[11px] leading-5 text-studio-muted/80">每镜单独生成：上传角色参考图作为图 1、对应台词的 TTS 作为音频 1。时长跟随音频；默认保留整条原音、同步口型，不添加配乐或音效。</p> : null}
    </div>
    {stale ? <p role="status" className="rounded-lg border border-amber-200/15 bg-amber-200/5 px-4 py-3 text-xs leading-5 text-amber-100">文案已更新，分镜可能需要调整。已保留你的分镜修改，可参考当前台词或重新生成。</p> : null}
    {storyboard && storyboard.promptFormat !== "minimax-h3" ? <p className="rounded-lg border border-studio-line bg-black/10 px-4 py-3 text-xs leading-5 text-studio-muted">这份分镜使用旧格式，内容已保留。重新生成后可复制和下载 H3 提示词。</p> : null}
    {!storyboard ? <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-studio-line px-6 py-10 text-center">
      <Film className="mb-3 h-8 w-8 text-violet-200/45" aria-hidden="true" />
      <h4 className="text-base font-medium">{draft ? "把台词串成镜头" : "先写下故事，再生成分镜"}</h4>
      <p className="mt-2 max-w-sm text-xs leading-6 text-studio-muted">{draft ? "相邻台词会按情节合成一镜，方便整理画面节奏与动作。" : "生成或载入一份文案后，就可以在这里规划画面。"}</p>
      {!draft ? <button type="button" className={`${generateClass} mt-4`} onClick={onBack}>返回文案</button> : null}
    </div> : <div className="space-y-4">
      {storyboard.shots.map((shot, index) => {
        const linkedSections = draft?.sections.filter((section) => shot.sourceSectionIds.includes(section.id)) ?? [];
        const first = draft?.sections.findIndex((section) => section.id === shot.sourceSectionIds[0]) ?? -1;
        const last = draft?.sections.findIndex((section) => section.id === shot.sourceSectionIds.at(-1)) ?? -1;
        let prompt = "";
        let disabledReason = "请先补全当前文案与分镜内容。";
        if (storyboard.promptFormat !== "minimax-h3") disabledReason = "重新生成分镜后可使用 H3 提示词。";
        else if (stale) disabledReason = "文案已更新，请重新生成分镜后复制提示词。";
        else if (draft) {
          try { prompt = createH3ShotPrompt(storyboard, draft, shot.id); }
          catch (error) { if (error instanceof Error) disabledReason = error.message; }
        }
        return <article key={shot.id} data-storyboard-shot={shot.id} className="min-w-0 overflow-hidden rounded-xl border border-studio-line bg-black/[0.08]">
          <div className="flex items-center gap-3 border-b border-studio-line px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-300/15 bg-violet-300/5 text-xs font-semibold tabular-nums text-violet-200">{String(index + 1).padStart(2, "0")}</span>
            <input aria-label={`第 ${index + 1} 镜标题`} value={shot.title} maxLength={120} onChange={(event) => onEdit(shot.id, { title: event.target.value })} placeholder="镜头标题" className="min-w-0 flex-1 rounded bg-transparent py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-violet-300/25" />
            <span className="shrink-0 text-[10px] tabular-nums text-studio-muted">{shot.sourceSectionIds.length} 句台词</span>
          </div>
          <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <label className="block min-w-0 space-y-2"><span className="text-[11px] font-medium text-violet-200/75">画面</span><textarea aria-label={`第 ${index + 1} 镜画面`} className={fieldClass} value={shot.visual} rows={4} maxLength={800} onChange={(event) => onEdit(shot.id, { visual: event.target.value })} placeholder="场景、人物与画面氛围…" /></label>
            <div className="min-w-0 space-y-3">
              <label className="block space-y-2"><span className="text-[11px] font-medium text-studio-muted">动作</span><textarea aria-label={`第 ${index + 1} 镜动作`} className={fieldClass} value={shot.action} rows={2} maxLength={600} onChange={(event) => onEdit(shot.id, { action: event.target.value })} placeholder="人物做什么，动作如何衔接…" /></label>
              <label className="block space-y-2"><span className="text-[11px] font-medium text-studio-muted">镜头说明</span><textarea aria-label={`第 ${index + 1} 镜镜头说明`} className={fieldClass} value={shot.camera} rows={2} maxLength={400} onChange={(event) => onEdit(shot.id, { camera: event.target.value })} placeholder="景别、视角与镜头运动…" /></label>
            </div>
          </div>
          <details className="border-t border-studio-line bg-black/10 px-4 py-3 text-xs text-studio-muted">
            <summary className="cursor-pointer hover:text-studio-text">{stale ? "当前台词参考" : "关联台词"}{first >= 0 && last >= first ? <span className="ml-2 text-studio-muted/60">第 {first + 1}{last > first ? `–${last + 1}` : ""} 句</span> : null}</summary>
            <div className="mt-3 space-y-2 border-l-2 border-violet-300/15 pl-3 text-sm leading-7">{linkedSections.length ? linkedSections.map((section) => <p key={section.id} className="whitespace-pre-wrap break-words">{section.text}</p>) : <p className="text-xs">原台词已调整，请重新生成分镜来更新关联。</p>}</div>
          </details>
          <H3ShotPrompt prompt={prompt} index={index} disabledReason={disabledReason} />
        </article>;
      })}
    </div>}
  </div>;
}
