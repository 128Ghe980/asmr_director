"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PlannerBriefSchema, PlannerDraftSchema, type PlannerSection } from "@/lib/asmr/planner";
import { PlannerReplacementSchema, validPlannerRange } from "@/lib/asmr/planner-editing";
import type { AsmrProject } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";

type Provider = { id: "ollama" | "api"; label: string; configured: boolean };
type Range = { clipId: string; text: string; start: number; end: number };

export function ScriptRewrite({ project, range, onApply, onClose }: {
  project: AsmrProject;
  range: Range;
  onApply: (clipId: string, original: string, replacement: string) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<"ollama" | "api">("ollama");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const [originalProjectId] = useState(project.project_id);
  const target = flattenClips(project).find((clip) => clip.id === range.clipId);
  const stale = project.project_id !== originalProjectId || target?.type !== "voice" || target.text !== range.text;
  const requestContext = JSON.stringify([project.project_id, range.clipId, range.text, range.start, range.end, stale]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/planner", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("无法读取文字模型配置。");
      const config = await response.json() as { providers: Provider[]; defaultProvider: "ollama" | "api" };
      if (!controller.signal.aborted) { setProviders(config.providers); setProvider(config.defaultProvider); }
    }).catch(() => { if (!controller.signal.aborted) setError("无法读取文字模型配置，请关闭后重试。"); });
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, []);
  // Invalidate before asynchronous replies can commit after a new target, text,
  // project or selection has rendered, including a same-text range change.
  useLayoutEffect(() => () => { requestRef.current?.abort(); }, [requestContext]);

  async function rewrite() {
    if (stale || busy || target?.type !== "voice") return;
    if (!validPlannerRange(range.text, range)) {
      setError("所选文字范围已失效，请重新选择。");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    try {
      const selectedText = range.text.slice(range.start, range.end);
      if (selectedText.length > 3000) throw new Error("单次最多改写 3000 字，请选择较短的范围或先分段。");
      const voices = flattenClips(project).filter((clip) => clip.type === "voice");
      const index = voices.findIndex((clip) => clip.id === range.clipId);
      const windowed = range.text.length > 3000;
      // Context is advisory and bounded independently from the editable range.
      // For a long original, send the selection as its own section; the response
      // is still spliced into the full original string using the original offsets.
      const excerpt = (text: string, fromEnd = false) => {
        const cut = fromEnd ? text.slice(-1500) : text.slice(0, 1500);
        return cut.replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "").trim();
      };
      const before = excerpt(windowed
        ? `${voices[index - 1]?.text ?? ""}\n${range.text.slice(0, range.start)}`
        : voices[index - 1]?.text ?? "", true);
      const after = excerpt(windowed
        ? `${range.text.slice(range.end)}\n${voices[index + 1]?.text ?? ""}`
        : voices[index + 1]?.text ?? "");
      const makeSection = (id: string, title: string, text: string): PlannerSection => ({
        id, title, text,
        emotion: target.emotion.slice(0, 120), style: target.style.slice(0, 120), pace: target.pace.slice(0, 120),
        direction: "", soundSuggestions: "", pauseAfter: "short", position: target.position,
      });
      const section = makeSection("selected_section", "当前改写段落", windowed ? selectedText : range.text);
      const requestRange = windowed ? { start: 0, end: selectedText.length } : { start: range.start, end: range.end };
      const sections = [
        ...(before ? [makeSection("context_before", "上文（节选，仅供参考）", before)] : []),
        section,
        ...(after ? [makeSection("context_after", "下文（节选，仅供参考）", after)] : []),
      ];
      const brief = PlannerBriefSchema.parse({ theme: project.title.slice(0, 2000), role: project.character.role.slice(0, 200) });
      const contextTraits = (values: string[], fallback: string) => {
        const bounded = values.slice(0, 12).map((value) => value.slice(0, 120).trim()).filter(Boolean);
        return bounded.length ? bounded : [fallback];
      };
      const draft = PlannerDraftSchema.safeParse({ title: project.title.slice(0, 200), scene: project.scene.name.slice(0, 2000), character: { role: project.character.role.slice(0, 200), personality: contextTraits(project.character.personality, "自然"), speechStyle: contextTraits(project.character.speech_style, "轻声") }, sections });
      if (!draft.success) throw new Error("文案或角色设置不完整，请补全后重试。");
      const response = await fetch("/api/planner", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "rewrite", provider, brief, draft: draft.data, sectionId: section.id, instruction, range: requestRange }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "改写失败，请重试。");
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const parsedReplacement = PlannerReplacementSchema.safeParse({ text: result.replacement });
      if (!parsedReplacement.success) throw new Error("模型没有返回有效的选区文案，请重试。");
      const replacement = parsedReplacement.data.text;
      const nextText = range.text.slice(0, range.start) + replacement + range.text.slice(range.end);
      onApply(range.clipId, range.text, nextText);
      onClose();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "改写失败，请重试。");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }

  return <div role="region" aria-label="工程文案改写" className="max-h-[55%] shrink-0 space-y-3 overflow-y-auto border-t border-sky-300/20 bg-studio-panel p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">改写选定文字</h3><button type="button" className="text-xs text-studio-muted" onClick={() => { requestRef.current?.abort(); onClose(); }}>{busy ? "取消改写" : "关闭"}</button></div>
    <p className="max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/15 p-2 text-xs leading-5 text-sky-100">{range.text.slice(range.start, range.end)}</p>
    {stale ? <p role="status" className="text-xs text-amber-100">文案已修改，本次改写已取消。请重新选择范围。</p> : <>
      <label className="block space-y-1 text-xs text-studio-muted">改写要求<textarea aria-label="工程选区改写要求" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2000} rows={2} className="block w-full rounded-md border border-studio-line bg-black/20 p-2 text-sm text-studio-text" placeholder="例如：说得更自然一点，保留原意。" /></label>
      <div className="flex flex-wrap items-center justify-between gap-2"><select aria-label="工程改写模型" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as "ollama" | "api")} className="min-w-0 rounded-md border border-studio-line bg-studio-panel px-2 py-2 text-xs">{providers.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label}{item.configured ? "" : "（未配置）"}</option>)}</select><button type="button" disabled={busy || !instruction.trim() || !providers.find((item) => item.id === provider)?.configured} onClick={() => void rewrite()} className="rounded-md border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100 disabled:opacity-40">{busy ? "正在改写…" : "只改写选定文字"}</button></div>
    </>}
    {error && <p role="alert" className="text-xs leading-5 text-amber-100">{error}</p>}
  </div>;
}
