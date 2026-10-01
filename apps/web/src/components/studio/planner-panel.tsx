"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, FileText, LoaderCircle, MapPin, Plus, Sparkles, Undo2 } from "lucide-react";

import {
  PlannerBriefSchema,
  PlannerDraftSchema,
  PlannerSectionSchema,
  getPlannerPauseSeconds,
  type PlannerBrief,
  type PlannerDraft,
  type PlannerSection,
  type PlannerSource,
} from "@/lib/asmr/planner";
import {
  createEmptyPlannerWorkingState,
  loadPlannerDraft,
  savePlannerDraft,
  type PlannerWorkingState,
} from "@/lib/asmr/planner-persistence";
import {
  insertPlannerSection, mergePlannerSection, PlannerReplacementSchema,
  replacePlannerRange, splitPlannerSection, type PlannerTextRange,
} from "@/lib/asmr/planner-editing";
import { normalizePlannerSemanticDraft } from "@/lib/asmr/planner-semantic";
import { createStoryboardSourceFingerprint, type PlannerStoryboard } from "@/lib/asmr/storyboard";
import { PlannerSceneEditor } from "./planner-scene";

type Provider = { id: "ollama" | "api"; label: string; model: string; configured: boolean };
type PlannerPanelProps = {
  source?: PlannerSource;
  onAdopt: (brief: PlannerBrief, draft: PlannerDraft, storyboard?: PlannerStoryboard, sceneDescription?: string) => void;
};

const fieldClass = "w-full min-w-0 rounded-lg border border-studio-line bg-black/20 px-3 py-2 text-sm leading-6 text-studio-text outline-none placeholder:text-studio-muted/60 focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/15 disabled:opacity-50";
const buttonClass = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-studio-line px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass = `${buttonClass} border-sky-300/30 bg-sky-300/12 text-sky-100 hover:bg-sky-300/20`;

function validationMessage(issues: { path: PropertyKey[] }[]) {
  const issue = issues[0];
  const labels: Record<string, string> = {
    theme: "今日主题", durationSeconds: "目标时长", role: "角色", style: "说话风格",
    notes: "补充要求", title: "标题", scene: "场景", text: "台词", emotion: "情绪",
    pace: "语速", direction: "导演提示", soundSuggestions: "音效建议", character: "角色设定",
  };
  const sectionIndex = issue?.path.find((part) => typeof part === "number");
  const leaf = String(issue?.path.at(-1) ?? "草稿");
  return `${typeof sectionIndex === "number" ? `第 ${sectionIndex + 1} 段的` : ""}${labels[leaf] ?? "草稿内容"}需要检查，请补齐内容或缩短过长的文字。`;
}

function downloadText(body: string, filename: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadDraft(brief: PlannerBrief, draft: PlannerDraft) {
  const body = [
    draft.title, `主题：${brief.theme}`, `场景：${draft.scene}`, `角色：${draft.character.role}`,
    `目标时长：${brief.durationSeconds / 60} 分钟（规划参考）`, "",
    ...draft.sections.flatMap((section, index) => [
      `${index + 1}. ${section.title}`, section.text, "",
      `导演提示：${section.direction || "无"}`,
      `音效建议：${section.soundSuggestions || "无"}`,
      `情绪：${section.emotion}；风格：${section.style}；语速：${section.pace}`,
      `句后等待：${getPlannerPauseSeconds(section)} 秒`, "",
    ]),
  ].join("\n");
  downloadText(body, `${draft.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "ASMR策划稿"}.txt`);
}

export function PlannerPanel({ source, onAdopt }: PlannerPanelProps) {
  const [working, setWorking] = useState(createEmptyPlannerWorkingState);
  const [loaded, setLoaded] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configError, setConfigError] = useState("");
  const [configVersion, setConfigVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<"generate" | "rewrite" | "scene" | null>(null);
  const [activeTab, setActiveTab] = useState<"script" | "scene">("script");
  const [rewriteId, setRewriteId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [selection, setSelection] = useState<(PlannerTextRange & { sectionId: string }) | null>(null);
  const [history, setHistory] = useState<PlannerWorkingState[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const loadRef = useRef(false);
  const restoredRef = useRef(false);
  const providerSelectedRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled || loadRef.current) return;
      loadRef.current = true;
      try {
        const result = loadPlannerDraft(window.localStorage);
        setWorking(result.state);
        restoredRef.current = result.restored;
        setCanPersist(!result.error);
        if (result.error) setSaveError(result.error);
      } catch {
        setSaveError("本地草稿保存不可用，请及时下载文案。");
      }
      setLoaded(true);
    });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/planner", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("config");
        return await response.json() as { providers: Provider[]; defaultProvider: "ollama" | "api" };
      })
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setProviders(catalog.providers);
        setConfigError("");
        if (!restoredRef.current && !providerSelectedRef.current) {
          setWorking((current) => ({ ...current, provider: catalog.defaultProvider }));
        }
      })
      .catch(() => { if (!controller.signal.aborted) setConfigError("暂时无法读取模型配置，请重试。"); });
    return () => controller.abort();
  }, [configVersion]);

  useEffect(() => {
    if (!loaded || !canPersist) return;
    const timer = window.setTimeout(() => {
      try {
        const result = savePlannerDraft(window.localStorage, working);
        setSaveError(result.success ? "" : result.error);
      } catch { setSaveError("本地草稿保存不可用，请及时下载文案。"); }
      setSaving(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [working, loaded, canPersist]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const { brief, draft } = working;
  const storyboard = working.storyboard ?? null;
  const sceneDescription = working.sceneDescription ?? null;
  const draftBrief = working.draftBrief ?? brief;
  const provider = providers.find((item) => item.id === working.provider);
  const busy = pending !== null;
  const changedBrief = !!draft && JSON.stringify(brief) !== JSON.stringify(draftBrief);
  const draftValidation = draft ? PlannerDraftSchema.safeParse(draft) : null;
  const readableCharacters = draft?.sections.reduce((sum, section) => sum + section.text.replace(/\s/g, "").length, 0) ?? 0;

  function changeWorking(next: PlannerWorkingState) {
    const interrupted = !!requestRef.current;
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(null);
    setSelection(null);
    setWorking(next);
    setCanPersist(true);
    setSaving(true);
    setError("");
    setNotice(interrupted ? "已停止 AI 生成，保留你的修改。" : "");
  }

  function remember() {
    setHistory((current) => [...current.slice(-29), structuredClone(working)]);
  }

  function updateBrief(patch: Partial<PlannerBrief>) {
    changeWorking({ ...working, brief: { ...brief, ...patch } });
  }

  function updateDraft(patch: Partial<PlannerDraft>) {
    if (draft) { remember(); changeWorking({ ...working, draft: { ...draft, ...patch } }); }
  }

  function updateSection(id: string, patch: Partial<PlannerSection>) {
    if (!draft) return;
    setActiveSectionId(id);
    if ("text" in patch) setSelection(null);
    updateDraft({ sections: draft.sections.map((section) => section.id === id ? { ...section, ...patch } : section) });
  }

  function editStructure(edit: (current: PlannerDraft) => PlannerDraft) {
    if (!draft) return;
    try {
      const next = edit(draft);
      remember();
      changeWorking({ ...working, draft: next });
      setSelection(null);
      setRewriteId(null);
      const added = next.sections.find((section) => !draft.sections.some((old) => old.id === section.id));
      setActiveSectionId(added?.id ?? (next.sections.some((section) => section.id === activeSectionId) ? activeSectionId : next.sections[0]?.id ?? null));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法修改分段。"); }
  }

  function captureSelection(sectionId: string, textarea: HTMLTextAreaElement) {
    setActiveSectionId(sectionId);
    setSelection({ sectionId, start: textarea.selectionStart, end: textarea.selectionEnd });
  }

  function cancelRequest() {
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(null);
    setNotice("已取消。");
  }

  async function runPlanner(action: "generate" | "rewrite") {
    if (requestRef.current) return;
    const input = PlannerBriefSchema.safeParse(action === "generate" ? brief : draftBrief);
    if (!input.success) { setError(validationMessage(input.error.issues)); return; }
    if (action === "rewrite" && (!draft || !rewriteId || !instruction.trim())) {
      setError("请先填写这一段的改写要求。"); return;
    }
    if (action === "rewrite" && draftValidation && !draftValidation.success) {
      setError(validationMessage(draftValidation.error.issues)); return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(action);
    setError("");
    setNotice("");
    const snapshot = structuredClone(working);
    const range = action === "rewrite" && selection?.sectionId === rewriteId && selection.start < selection.end
      ? { start: selection.start, end: selection.end } : undefined;
    try {
      const response = await fetch("/api/planner", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(action === "generate"
          ? { action, provider: working.provider, brief: input.data }
          : { action, provider: working.provider, brief: input.data, draft, sectionId: rewriteId, instruction: instruction.trim(), ...(range ? { range } : {}) }),
      });
      const body = await response.json();
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "策划暂时失败，请重试。");
      let nextDraft: PlannerDraft;
      if (action === "generate") {
        nextDraft = PlannerDraftSchema.parse(body.draft);
      } else {
        const section = PlannerSectionSchema.parse(body.section);
        if (section.id !== rewriteId || !draft) throw new Error("改写结果与选中的段落不一致，请重试。");
        const original = draft.sections.find((item) => item.id === rewriteId)!;
        const replacement = range
          ? replacePlannerRange(original, range, PlannerReplacementSchema.parse({ text: body.replacement }).text)
          : section;
        nextDraft = { ...draft, sections: draft.sections.map((item) => item.id === rewriteId ? replacement : item) };
        PlannerDraftSchema.parse(nextDraft);
      }
      setHistory((current) => [...current.slice(-29), snapshot]);
      setWorking({ ...snapshot, draft: nextDraft, draftBrief: input.data });
      setCanPersist(true);
      setSaving(true);
      setNotice(action === "generate" ? "文案已生成。" : range ? "已改写选中文字，其他内容保持不变。" : "已改写所选段落。");
      setActiveTab("script");
      setSelection(null);
      setInstruction("");
    } catch (caught) {
      if (requestRef.current !== controller || controller.signal.aborted) return;
      setError(caught instanceof Error && caught.name !== "ZodError" ? caught.message : "模型返回的草稿不完整，请重新生成。");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setPending(null); }
    }
  }

  function editScene(value: string) {
    remember();
    changeWorking({ ...working, sceneDescription: value });
  }

  async function generateScene(instruction: string) {
    if (requestRef.current || !draft) return;
    if (!draftValidation?.success) { setError(validationMessage(draftValidation?.error.issues ?? [])); return; }
    const snapshot = structuredClone(working);
    const controller = new AbortController();
    requestRef.current = controller;
    setPending("scene");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/scene-description", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ provider: working.provider, draft: draftValidation.data, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) }),
      });
      const body = await response.json();
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "背景生成失败，请重试。");
      if (typeof body.sceneDescription !== "string" || !body.sceneDescription.trim() || body.sceneDescription.length > 4000) throw new Error("模型返回的剧情背景不完整，请重试。");
      if (body.sourceFingerprint !== createStoryboardSourceFingerprint(draftValidation.data)) throw new Error("剧情背景与当前文案不一致，请重新生成。");
      setHistory((current) => [...current.slice(-29), snapshot]);
      setWorking({ ...snapshot, sceneDescription: body.sceneDescription.trim() });
      setCanPersist(true);
      setSaving(true);
      setNotice("剧情背景已生成，可以继续修改。");
    } catch (caught) {
      if (requestRef.current !== controller || controller.signal.aborted) return;
      setError(caught instanceof Error && caught.name !== "ZodError" ? caught.message : "模型返回的剧情背景不完整，请重试。");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setPending(null); }
    }
  }

  function switchTab(tab: "script" | "scene") {
    setActiveTab(tab);
    setRewriteId(null);
    setSelection(null);
  }

  function adopt() {
    if (!draft || !draftValidation) return;
    if (!draftValidation.success) { setError(validationMessage(draftValidation.error.issues)); return; }
    try {
      if (sceneDescription?.trim()) onAdopt(PlannerBriefSchema.parse(draftBrief), draftValidation.data, storyboard ? structuredClone(storyboard) : undefined, sceneDescription);
      else if (storyboard) onAdopt(PlannerBriefSchema.parse(draftBrief), draftValidation.data, structuredClone(storyboard));
      else onAdopt(PlannerBriefSchema.parse(draftBrief), draftValidation.data);
      setNotice("已创建工程。");
    } catch { setError("暂时无法采用这份草稿，请检查内容后重试。原项目已保留。"); }
  }

  return (
    <section aria-label="AI 创意策划" className="relative flex h-full min-h-0 min-w-0 flex-col gap-3 lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className={`${briefExpanded ? "absolute inset-x-0 top-0 z-20 max-h-full shadow-2xl lg:static lg:shadow-none" : "max-h-[45%]"} min-h-0 shrink-0 overflow-y-auto rounded-xl border border-studio-line bg-studio-panel lg:max-h-none`}>
        <div className="flex items-center justify-between px-4 py-3"><h2 className="text-sm font-semibold">创作设定</h2><button type="button" className="text-xs text-studio-muted lg:hidden" aria-expanded={briefExpanded} onClick={() => setBriefExpanded((value) => !value)}>{briefExpanded ? "收起设定" : "展开设定"}</button></div>
        <div className={`${briefExpanded ? "block" : "hidden lg:block"} space-y-4 px-4 pb-4`}>
          <label className="block space-y-2 text-xs text-studio-muted"><span>今日主题</span><textarea aria-label="今日主题" value={brief.theme} onChange={(event) => updateBrief({ theme: event.target.value })} disabled={!loaded} maxLength={2000} rows={4} className={fieldClass} placeholder="今晚的故事发生在哪里？你想带来怎样的陪伴？" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-studio-muted"><span>目标时长</span><select aria-label="目标时长" className={fieldClass} value={brief.durationSeconds} onChange={(event) => updateBrief({ durationSeconds: Number(event.target.value) })} disabled={!loaded}>{[60, 180, 300, 600].map((seconds) => <option key={seconds} value={seconds}>{seconds / 60} 分钟</option>)}</select></label>
            <label className="space-y-1 text-xs text-studio-muted"><span>文案模型</span><select aria-label="文案模型" className={fieldClass} value={working.provider} disabled={!loaded} onChange={(event) => { providerSelectedRef.current = true; changeWorking({ ...working, provider: event.target.value as "ollama" | "api" }); }}><option value="ollama">本地模型</option><option value="api">外部 API</option></select></label>
          </div>
          {configError ? <p role="alert" className="text-xs leading-5 text-amber-100">{configError} <button className="underline" onClick={() => setConfigVersion((value) => value + 1)}>重试</button></p> : <p className="break-words text-[11px] leading-5 text-studio-muted">{provider?.model || (provider ? "尚未配置模型" : "正在连接…")}{working.provider === "api" && provider?.configured ? " · 按用量计费" : ""}</p>}
          {provider && !provider.configured ? <p role="alert" className="text-xs leading-5 text-amber-100">模型尚未配置完整，请检查服务设置。</p> : null}
          <details className="border-t border-studio-line pt-3"><summary className="cursor-pointer text-xs text-studio-muted">角色与创作要求</summary><div className="mt-3 space-y-3">
            <label className="block space-y-1 text-xs text-studio-muted"><span>角色 / 关系</span><input aria-label="角色 / 关系" className={fieldClass} value={brief.role} maxLength={200} onChange={(event) => updateBrief({ role: event.target.value })} placeholder="例如：熟悉的书店店员" /></label>
            <label className="block space-y-1 text-xs text-studio-muted"><span>说话风格</span><input aria-label="说话风格" className={fieldClass} value={brief.style} maxLength={200} onChange={(event) => updateBrief({ style: event.target.value })} /></label>
            <label className="block space-y-1 text-xs text-studio-muted"><span>补充要求</span><textarea aria-label="补充要求 / 避免的内容" className={fieldClass} value={brief.notes} rows={3} maxLength={2000} onChange={(event) => updateBrief({ notes: event.target.value })} /></label>
          </div></details>
          <button type="button" className={`${primaryClass} min-h-10 w-full`} disabled={busy || !loaded || !provider?.configured || !brief.theme.trim()} onClick={() => void runPlanner("generate")}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{draft ? "重新生成策划稿" : "生成策划稿"}</button>
          <p className="text-[11px] leading-5 text-studio-muted">文案会按完整意思整理为短句，可随时改写、拆分或合并。</p>
          {source ? <details className="text-xs text-studio-muted"><summary className="cursor-pointer">项目原稿</summary><button className={`${buttonClass} mt-2 w-full`} disabled={!loaded} onClick={() => { remember(); changeWorking({ ...working, brief: source.brief, draftBrief: source.brief, draft: structuredClone(source.draft), storyboard: source.storyboard ? structuredClone(source.storyboard) : null, sceneDescription: source.sceneDescription ?? null }); setRewriteId(null); setActiveSectionId(null); setNotice("已载入项目原稿。"); }}>载入当前项目策划稿</button></details> : null}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-studio-line bg-studio-panel/70">
        <div className="shrink-0 border-b border-studio-line px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <div role="tablist" aria-label="策划内容" className="flex items-center gap-1 rounded-lg border border-studio-line bg-black/20 p-1">
                {([['script', '文案', FileText], ['scene', '场景', MapPin]] as const).map(([tab, label, Icon]) => <button key={tab} type="button" role="tab" id={`planner-tab-${tab}`} aria-selected={activeTab === tab} aria-controls={`planner-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-300 ${activeTab === tab ? tab === "scene" ? "bg-violet-300/15 text-violet-100" : "bg-sky-300/15 text-sky-100" : "text-studio-muted hover:bg-white/5 hover:text-studio-text"}`} onClick={() => switchTab(tab)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "script" : event.key === "End" ? "scene" : tab === "script" ? "scene" : "script"; switchTab(next); document.getElementById(`planner-tab-${next}`)?.focus(); }}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>)}
              </div>
              <span className="flex items-center gap-1 text-[11px] text-studio-muted" role="status">{!saveError && loaded && !saving ? <Check className="h-3 w-3 text-studio-green" aria-hidden="true" /> : null}{!loaded ? "正在载入" : saveError ? "未保存" : saving ? "保存中…" : "已保存"}</span>
            </div>
            {draft ? <div className="flex flex-wrap gap-2"><button aria-label="撤回修改" className={buttonClass} disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { changeWorking(previous); setHistory((current) => current.slice(0, -1)); setRewriteId(null); setActiveSectionId(null); setNotice("已撤回。"); } }}><Undo2 className="h-3.5 w-3.5" aria-hidden="true" />撤回</button><button className={buttonClass} disabled={activeTab === "scene" && !sceneDescription?.trim()} onClick={() => { if (activeTab === "scene" && sceneDescription?.trim()) downloadText(sceneDescription, `${draft.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "ASMR"}-剧情背景.txt`); else downloadDraft(draftBrief, draft); }}><Download className="h-3.5 w-3.5" aria-hidden="true" />{activeTab === "scene" ? "下载背景" : "下载"}</button></div> : null}
          </div>
          {draft ? <div className="mt-2"><input aria-label="文案标题" className="w-full min-w-0 bg-transparent py-1 text-xl font-semibold leading-8 outline-none focus:ring-1 focus:ring-sky-300/25" value={draft.title} maxLength={120} onChange={(event) => updateDraft({ title: event.target.value })} /><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-studio-muted">{activeTab === "script" ? `${draft.sections.length} 条台词 · ${readableCharacters} 字 · 点选台词编辑，选中文字可只改这一小段。` : "先查看剧情背景，再到工程中逐段生成画面。"}</p><details className="relative text-xs text-studio-muted"><summary className="cursor-pointer">文案设置</summary><div className="fixed right-4 top-24 z-30 max-h-[calc(100dvh-128px)] w-64 space-y-3 overflow-y-auto rounded-lg border border-studio-line bg-studio-panel p-3 shadow-xl"><label className="block space-y-1"><span>场景设定</span><textarea aria-label="场景设定" rows={2} className={fieldClass} value={draft.scene} maxLength={1000} onChange={(event) => updateDraft({ scene: event.target.value })} /></label><label className="block space-y-1"><span>角色设定</span><input aria-label="角色设定" className={fieldClass} value={draft.character.role} maxLength={200} onChange={(event) => updateDraft({ character: { ...draft.character, role: event.target.value } })} /></label><button className={buttonClass} onClick={() => editStructure((current) => normalizePlannerSemanticDraft(current, { preserveSectionPauses: true }))}>按语义整理短句</button></div></details></div></div> : null}
        </div>
        <div aria-live="polite" aria-atomic="true" className="max-h-[28%] shrink-0 overflow-y-auto px-4 sm:px-6">
          {busy ? <div className="flex items-center justify-between gap-2 py-2 text-xs text-sky-100"><span className="flex items-center gap-2"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{pending === "generate" ? "正在写文案…" : pending === "scene" ? "正在生成背景…" : "正在改写…"}</span><button className={buttonClass} onClick={cancelRequest}>取消</button></div> : null}
          {notice ? <p className="py-2 text-xs text-studio-muted">{notice}</p> : null}
          {[saveError, error, changedBrief ? "创作要求已修改，重新生成后应用到文案。" : ""].filter(Boolean).map((message, index) => <p key={index} role={index < 2 ? "alert" : undefined} className="py-2 text-xs leading-5 text-amber-100">{message}</p>)}
        </div>
        <div data-planner-scroll role="tabpanel" id={`planner-panel-${activeTab}`} aria-labelledby={`planner-tab-${activeTab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
          {activeTab === "scene" ? <PlannerSceneEditor draft={draft} sceneDescription={sceneDescription} busy={busy} canGenerate={loaded && !!provider?.configured && !!draftValidation?.success} onGenerate={(instruction) => void generateScene(instruction)} onEdit={editScene} onBack={() => switchTab("script")} /> : !draft ? <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 text-center"><Sparkles className="mb-4 h-7 w-7 text-sky-200/60" aria-hidden="true" /><h3 className="text-lg font-semibold">从今晚的一个想法开始</h3><p className="mt-2 max-w-xs text-sm leading-7 text-studio-muted">写下主题，生成一份可以逐句雕琢的陪伴文案。</p><button className={`${buttonClass} mt-4 lg:hidden`} onClick={() => setBriefExpanded(true)}>填写创作设定</button></div> : <div className="mx-auto max-w-[860px] space-y-1">
            {draft.sections.map((section, index) => {
              const active = activeSectionId === section.id;
              const range = selection?.sectionId === section.id ? selection : null;
              const selectedText = range && range.start < range.end ? section.text.slice(range.start, range.end) : "";
              return <article key={section.id} data-planner-unit={section.id} className={`min-w-0 rounded-lg border-l-2 px-2 py-2 sm:px-3 ${active ? "border-sky-300/60 bg-sky-300/[0.045]" : "border-transparent hover:bg-white/[0.025]"}`}>
                <div className="flex items-start gap-3"><button aria-label={`选择第 ${index + 1} 段`} aria-pressed={active} className="mt-2 w-6 shrink-0 text-left text-[10px] tabular-nums text-studio-muted/55" onClick={() => setActiveSectionId(section.id)}>{String(index + 1).padStart(2, "0")}</button><textarea aria-label={`第 ${index + 1} 段台词`} value={section.text} rows={1} maxLength={3000} placeholder="写下一句台词…" className="min-h-8 w-full min-w-0 resize-none overflow-y-auto rounded-sm bg-transparent py-1 text-[15px] leading-8 text-studio-text outline-none [field-sizing:content] focus:ring-0" onFocus={() => setActiveSectionId(section.id)} onSelect={(event) => captureSelection(section.id, event.currentTarget)} onClick={(event) => captureSelection(section.id, event.currentTarget)} onKeyUp={(event) => captureSelection(section.id, event.currentTarget)} onChange={(event) => updateSection(section.id, { text: event.target.value })} /></div>
                {active ? <div className="ml-9 mt-2 space-y-3 border-t border-sky-300/10 pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button aria-label={`AI 改写第 ${index + 1} 段`} className={`${primaryClass}`} aria-expanded={rewriteId === section.id} onClick={() => { setRewriteId(rewriteId === section.id ? null : section.id); setInstruction(""); setError(""); }}><Sparkles className="h-3 w-3" aria-hidden="true" />{selectedText ? "改写选区" : "AI 改写"}</button>
                    <button className={buttonClass} aria-label={`拆分第 ${index + 1} 段`} disabled={!range} onClick={() => range && editStructure((current) => splitPlannerSection(current, section.id, range))}>{selectedText ? "选区独立成句" : "光标处分句"}</button>
                    <button className={buttonClass} aria-label={`合并第 ${index + 1} 段与下一段`} disabled={index === draft.sections.length - 1} title="保留前句声音设置，合并导演和音效提示，沿用后句等待。" onClick={() => editStructure((current) => mergePlannerSection(current, section.id))}>合并下句</button>
                    <button className={buttonClass} aria-label={`在第 ${index + 1} 段后新增`} onClick={() => editStructure((current) => insertPlannerSection(current, section.id))}>下方插入</button>
                    <button className={`${buttonClass} text-studio-muted`} aria-label={`删除第 ${index + 1} 段`} onClick={() => editStructure((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== section.id) }))}>删除</button>
                  </div>
                  {rewriteId === section.id ? <div className="space-y-2 rounded-lg bg-black/15 p-3">{selectedText ? <div className="text-xs"><p className="text-sky-100">仅改写选中文字 · {selectedText.length} 字</p><blockquote className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-studio-muted">{selectedText}</blockquote><button className="mt-1 text-studio-muted underline" onClick={() => setSelection(null)}>改为整段改写</button></div> : <p className="text-xs text-studio-muted">当前改写本条台词，也可在上方选中文字。</p>}<textarea aria-label={`第 ${index + 1} 段改写要求`} value={instruction} onChange={(event) => setInstruction(event.target.value)} className={fieldClass} rows={2} maxLength={2000} placeholder="想怎么改？例如：更像日常聊天，少一点说教。" /><button className={primaryClass} disabled={busy || !instruction.trim() || !provider?.configured} onClick={() => void runPlanner("rewrite")}>{selectedText ? "改写选中文字" : "改写这一段"}</button></div> : null}
                  <details className="text-xs text-studio-muted"><summary className="cursor-pointer">导演与声音 <span className="ml-2 text-studio-muted/65">句后等待 {getPlannerPauseSeconds(section)} 秒</span></summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><label className="space-y-1"><span>台词备注标题</span><input aria-label={`第 ${index + 1} 段标题`} className={fieldClass} value={section.title} maxLength={120} onChange={(event) => updateSection(section.id, { title: event.target.value })} /></label><label className="space-y-1"><span>句后等待（秒）</span><input aria-label={`第 ${index + 1} 段等待秒数`} type="number" min={0} max={30} step={0.05} className={fieldClass} value={getPlannerPauseSeconds(section)} onChange={(event) => { const seconds = Number(event.target.value); if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) updateSection(section.id, { pauseAfterSeconds: seconds }); }} /></label>
                    <label className="space-y-1"><span>导演提示</span><textarea aria-label={`第 ${index + 1} 段导演提示`} rows={2} className={fieldClass} value={section.direction} maxLength={1000} onChange={(event) => updateSection(section.id, { direction: event.target.value })} /></label><label className="space-y-1"><span>音效建议</span><textarea aria-label={`第 ${index + 1} 段音效建议`} rows={2} className={fieldClass} value={section.soundSuggestions} maxLength={1000} onChange={(event) => updateSection(section.id, { soundSuggestions: event.target.value })} /></label>
                    {([['emotion', '情绪'], ['style', '风格'], ['pace', '语速']] as const).map(([key, label]) => <label key={key} className="space-y-1"><span>{label}</span><input aria-label={`第 ${index + 1} 段${label}`} className={fieldClass} value={section[key]} maxLength={100} onChange={(event) => updateSection(section.id, { [key]: event.target.value })} /></label>)}
                    <label className="space-y-1"><span>左右位置</span><select aria-label={`第 ${index + 1} 段位置`} className={fieldClass} value={section.position.pan < -0.2 ? "left" : section.position.pan > 0.2 ? "right" : "center"} onChange={(event) => updateSection(section.id, { position: { ...section.position, pan: event.target.value === "left" ? -0.7 : event.target.value === "right" ? 0.7 : 0 } })}><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option></select></label>
                  </div></details>
                </div> : null}
              </article>;
            })}
            <button className="ml-4 mt-4 flex items-center gap-2 px-3 py-2 text-xs text-studio-muted hover:text-sky-100" onClick={() => editStructure((current) => insertPlannerSection(current))}><Plus className="h-3.5 w-3.5" aria-hidden="true" />新增一句</button>
          </div>}
        </div>
        {draft ? <div className="flex shrink-0 items-center justify-between gap-3 border-t border-studio-line px-4 py-3 sm:px-6"><span className="text-[11px] text-studio-muted">每条台词可独立生成与安排等待</span><button aria-label="采用并创建工程" className={`${primaryClass} shrink-0`} disabled={busy || !loaded} onClick={adopt}>创建音频工程<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button></div> : null}
      </div>
    </section>
  );
}
