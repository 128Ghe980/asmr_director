"use client";

import { useState } from "react";
import { renderAsmrSoundH3Prompt, type AsmrSound } from "@/lib/asmr/asmr-sound";

const distances = { far: "远处", mid: "中距离", near: "近处", close: "耳旁", very_close: "贴近耳边" } as const;
const movements = { static: "静止", approach: "靠近", recede: "远离", left_to_right: "从左向右", right_to_left: "从右向左", orbit: "环绕", orbit_approach: "环绕靠近" } as const;
const field = "w-full min-w-0 rounded-md border border-studio-line bg-studio-panel px-2 py-1.5 text-xs outline-none focus:border-violet-300/40 disabled:opacity-40";

export function formatAsmrSound(sound: AsmrSound | undefined): string {
  if (!sound) return "（无）";
  const p = sound.postProcessing;
  return `${sound.prompt}${sound.mixMode ? `\n${sound.mixMode === "replace" ? "作为本段主声音" : "叠加到原声音"}` : ""}\n${movements[p.movement]} · ${distances[p.start.distance]} (${p.start.pan}) → ${distances[p.end.distance]} (${p.end.pan}) · ${p.gainDb} dB`;
}

export function AsmrSoundEditor({ sound, duration, silent = false, disabled, onChange }: {
  sound: AsmrSound; duration: number; silent?: boolean; disabled: boolean; onChange: (sound: AsmrSound) => void;
}) {
  const [draft, setDraft] = useState<{ source: string; text: string }>();
  const prompt = draft?.source === sound.prompt ? draft.text : sound.prompt;
  const p = sound.postProcessing;
  function update(patch: Partial<AsmrSound["postProcessing"]>) {
    const next = { ...p, ...patch };
    if (next.movement === "static") next.end = { ...next.start };
    onChange({ ...sound, postProcessing: next });
  }
  return <details className="rounded-lg border border-violet-300/20 bg-violet-300/[0.035] p-3">
    <summary className="cursor-pointer text-xs font-medium text-violet-100">环境与触发音 · {silent ? `${duration.toFixed(3)} 秒` : "随本段音频时长"}</summary>
    <div className="mt-3 space-y-3">
      <label className="block space-y-1.5"><span className="text-[11px] text-studio-muted">触发材料与动作</span>
        <textarea aria-label="ASMR 触发音提示词" rows={4} maxLength={2000} disabled={disabled} className={`${field} leading-6`} value={prompt}
          onChange={event => setDraft({ source: sound.prompt, text: event.target.value })}
          onBlur={() => { if (prompt.trim() && prompt.trim() !== sound.prompt) onChange({ ...sound, prompt: prompt.trim() }); setDraft(undefined); }} />
      </label>
      {silent ? <label className="block space-y-1.5 text-[11px] text-studio-muted">声音用法<select aria-label="ASMR 声音用法" className={field} disabled={disabled} value={sound.mixMode ?? "overlay"} onChange={event => onChange({ ...sound, mixMode: event.target.value as "overlay" | "replace" })}><option value="replace">作为本段主声音</option><option value="overlay">叠加到原声音</option></select></label> : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-studio-muted">声音移动<select aria-label="ASMR 声音移动" className={field} disabled={disabled} value={p.movement} onChange={event => update({ movement: event.target.value as typeof p.movement })}>{Object.entries(movements).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1 text-[11px] text-studio-muted">声音音量<select aria-label="ASMR 叠加音量" className={field} disabled={disabled} value={p.gainDb} onChange={event => update({ gainDb: Number(event.target.value) })}>{[...new Set([-36, -30, -24, -18, -12, -9, -6, -3, 0, 3, 6, p.gainDb])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} dB</option>)}</select></label>
      </div>
      {(["start", "end"] as const).map(key => <div key={key} className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-studio-muted">{key === "start" ? "起点" : "终点"}距离<select aria-label={`ASMR ${key === "start" ? "起点" : "终点"}距离`} className={field} disabled={disabled || key === "end" && p.movement === "static"} value={p[key].distance} onChange={event => update({ [key]: { ...p[key], distance: event.target.value as typeof p.start.distance } })}>{Object.entries(distances).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="space-y-1 text-[11px] text-studio-muted">{key === "start" ? "起点" : "终点"}声位 · {p[key].pan}<input aria-label={`ASMR ${key === "start" ? "起点" : "终点"}声位`} type="range" min={-1} max={1} step={.05} disabled={disabled || key === "end" && p.movement === "static"} value={p[key].pan} onChange={event => update({ [key]: { ...p[key], pan: Number(event.target.value) } })} className="mt-2 w-full accent-violet-300" /></label>
      </div>)}
      <details className="text-[11px] text-studio-muted"><summary className="cursor-pointer">ASMR 视频提示词</summary><textarea aria-label="ASMR H3 提示词" readOnly value={renderAsmrSoundH3Prompt(sound)} rows={8} className={`${field} mt-2 font-mono leading-5`} /></details>
    </div>
  </details>;
}
