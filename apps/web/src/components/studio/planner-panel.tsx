"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, LoaderCircle, Sparkles, Undo2 } from "lucide-react";

import {
  PlannerBriefSchema,
  PlannerDraftSchema,
  PlannerSectionSchema,
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

type Provider = { id: "ollama" | "api"; label: string; model: string; configured: boolean };
type PlannerPanelProps = {
  source?: PlannerSource;
  onAdopt: (brief: PlannerBrief, draft: PlannerDraft) => void;
};

const fieldClass = "w-full min-w-0 rounded-lg border border-studio-line bg-black/20 px-3 py-2 text-sm leading-6 text-studio-text outline-none placeholder:text-studio-muted/60 focus:border-sky-300/50 focus:ring-2 focus:ring-sky-300/15 disabled:opacity-50";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-studio-line px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
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

function downloadDraft(brief: PlannerBrief, draft: PlannerDraft) {
  const body = [
    draft.title, `主题：${brief.theme}`, `场景：${draft.scene}`, `角色：${draft.character.role}`,
    `目标时长：${brief.durationSeconds / 60} 分钟（规划参考）`, "",
    ...draft.sections.flatMap((section, index) => [
      `${index + 1}. ${section.title}`, section.text, "",
      `导演提示：${section.direction || "无"}`,
      `音效建议：${section.soundSuggestions || "无"}`,
      `情绪：${section.emotion}；风格：${section.style}；语速：${section.pace}`,
      `段后留白：${{ short: "短", medium: "中", long: "长" }[section.pauseAfter]}`, "",
    ]),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${draft.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "ASMR策划稿"}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  const [pending, setPending] = useState<"generate" | "rewrite" | null>(null);
  const [rewriteId, setRewriteId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
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
        // A restored or user-selected provider wins over the server default.
        if (!restoredRef.current && !providerSelectedRef.current) {
          setWorking((current) => ({ ...current, provider: catalog.defaultProvider }));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigError("暂时无法读取模型配置，请重试。");
      });
    return () => controller.abort();
  }, [configVersion]);

  useEffect(() => {
    if (!loaded || !canPersist) return;
    const timer = window.setTimeout(() => {
      try {
        const result = savePlannerDraft(window.localStorage, working);
        setSaveError(result.success ? "" : result.error);
      } catch {
        setSaveError("本地草稿保存不可用，请及时下载文案。");
      }
      setSaving(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [working, loaded, canPersist]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const { brief, draft } = working;
  const draftBrief = working.draftBrief ?? brief;
  const provider = providers.find((item) => item.id === working.provider);
  const busy = pending !== null;
  const changedBrief = !!draft && JSON.stringify(brief) !== JSON.stringify(draftBrief);
  const draftValidation = draft ? PlannerDraftSchema.safeParse(draft) : null;
  const readableCharacters = draft?.sections.reduce((sum, section) => sum + section.text.replace(/\s/g, "").length, 0) ?? 0;

  function changeWorking(next: PlannerWorkingState) {
    setWorking(next);
    setCanPersist(true);
    setSaving(true);
    setError("");
    setNotice("");
  }

  function remember() {
    setHistory((current) => [...current.slice(-4), structuredClone(working)]);
  }

  function updateBrief(patch: Partial<PlannerBrief>) {
    changeWorking({ ...working, brief: { ...brief, ...patch } });
  }

  function updateDraft(patch: Partial<PlannerDraft>) {
    if (draft) changeWorking({ ...working, draft: { ...draft, ...patch } });
  }

  function updateSection(id: string, patch: Partial<PlannerSection>) {
    if (!draft) return;
    updateDraft({ sections: draft.sections.map((section) => section.id === id ? { ...section, ...patch } : section) });
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
    try {
      const response = await fetch("/api/planner", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(action === "generate"
          ? { action, provider: working.provider, brief: input.data }
          : { action, provider: working.provider, brief: input.data, draft, sectionId: rewriteId, instruction: instruction.trim() }),
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
        nextDraft = PlannerDraftSchema.parse({ ...draft, sections: draft.sections.map((item) => item.id === rewriteId ? section : item) });
      }
      setHistory((current) => [...current.slice(-4), snapshot]);
      setWorking({ ...snapshot, draft: nextDraft, draftBrief: input.data });
      setCanPersist(true);
      setSaving(true);
      setNotice(action === "generate" ? "文案已生成。" : "已改写所选段落。");
      setInstruction("");
    } catch (caught) {
      if (requestRef.current !== controller || controller.signal.aborted) return;
      setError(caught instanceof Error && caught.name !== "ZodError" ? caught.message : "模型返回的草稿不完整，请重新生成。");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending(null);
      }
    }
  }

  function adopt() {
    if (!draft || !draftValidation) return;
    if (!draftValidation.success) { setError(validationMessage(draftValidation.error.issues)); return; }
    try {
      onAdopt(PlannerBriefSchema.parse(draftBrief), draftValidation.data);
      setNotice("已创建工程。");
    } catch {
      setError("暂时无法采用这份草稿，请检查内容后重试。原项目已保留。");
    }
  }

  return (
    <section aria-label="AI 创意策划" className="mx-auto w-full min-w-0 max-w-[1320px] space-y-4">
      <div className="flex justify-end">
        <span className="flex items-center gap-1.5 text-xs text-studio-muted" role="status">
          {!saveError && loaded && !saving ? <Check className="h-3.5 w-3.5 text-studio-green" aria-hidden="true" /> : null}
          {!loaded ? "正在载入" : saveError ? "未保存" : saving ? "保存中…" : "已保存"}
        </span>
      </div>

      {saveError ? <p role="alert" className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{saveError}</p> : null}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4 self-start rounded-xl border border-studio-line bg-studio-panel/90 p-4 lg:sticky lg:top-5">
          <label className="block space-y-2 text-sm"><span>今日主题 <span className="text-studio-muted">· 必填</span></span>
            <textarea aria-label="今日主题" value={brief.theme} onChange={(event) => updateBrief({ theme: event.target.value })} disabled={busy || !loaded} maxLength={2000} rows={4} className={fieldClass} placeholder="例如：深夜书店，店员陪伴刚下班的客人。多一点翻书声，少一点说教。" />
          </label>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="block space-y-2 text-sm"><span>目标时长</span><select aria-label="目标时长" className={fieldClass} value={brief.durationSeconds} onChange={(event) => updateBrief({ durationSeconds: Number(event.target.value) })} disabled={busy || !loaded}>
              {[60, 180, 300, 600].map((seconds) => <option key={seconds} value={seconds}>{seconds / 60} 分钟</option>)}
            </select></label>
            <label className="block space-y-2 text-sm"><span>文案模型</span><select aria-label="文案模型" className={fieldClass} value={working.provider} onChange={(event) => { providerSelectedRef.current = true; changeWorking({ ...working, provider: event.target.value as "ollama" | "api" }); }} disabled={busy || !loaded}>
              <option value="ollama">{providers.find((item) => item.id === "ollama")?.label ?? "本地 Ollama"}</option><option value="api">外部 API</option>
            </select></label>
          </div>
          {configError ? <div className="text-sm text-amber-100" role="alert">{configError} <button className="underline" onClick={() => setConfigVersion((value) => value + 1)}>重试</button></div> : <p className="break-words text-xs leading-5 text-studio-muted">{provider?.model || (provider ? "尚未配置模型" : "正在连接…")}{working.provider === "api" && provider?.configured ? " · 外部服务，按用量计费" : ""}</p>}
          {provider && !provider.configured ? <p role="alert" className="text-sm leading-6 text-amber-100">{working.provider === "api" ? "外部 API 尚未配置完整，请检查地址、密钥和模型。" : "本地模型配置不可用。"}</p> : null}
          <details className="rounded-lg border border-studio-line px-3 py-2">
            <summary className="cursor-pointer text-sm text-studio-muted">更多创作要求</summary>
            <div className="mt-3 space-y-3">
              <label className="block space-y-1 text-sm"><span>角色 / 关系</span><input aria-label="角色 / 关系" className={fieldClass} value={brief.role} maxLength={200} placeholder="例如：熟悉的书店店员" disabled={busy} onChange={(event) => updateBrief({ role: event.target.value })} /></label>
              <label className="block space-y-1 text-sm"><span>说话风格</span><input aria-label="说话风格" className={fieldClass} value={brief.style} maxLength={200} disabled={busy} onChange={(event) => updateBrief({ style: event.target.value })} /></label>
              <label className="block space-y-1 text-sm"><span>补充要求 / 避免的内容</span><textarea aria-label="补充要求 / 避免的内容" className={fieldClass} value={brief.notes} maxLength={2000} rows={3} disabled={busy} onChange={(event) => updateBrief({ notes: event.target.value })} placeholder="例如：不用亲昵称呼，结尾多留一些安静时间" /></label>
            </div>
          </details>
          <button type="button" className={`${primaryClass} w-full`} disabled={busy || !loaded || !provider?.configured || !brief.theme.trim()} onClick={() => void runPlanner("generate")}>
            {pending === "generate" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{draft ? "重新生成策划稿" : "生成策划稿"}
          </button>
          {source ? <details className="text-xs text-studio-muted"><summary className="cursor-pointer py-1">项目原稿</summary><button type="button" className={`${buttonClass} mt-2 w-full text-studio-muted`} disabled={busy || !loaded} onClick={() => { remember(); changeWorking({ ...working, brief: source.brief, draftBrief: source.brief, draft: structuredClone(source.draft) }); setRewriteId(null); setNotice("已载入项目原稿。"); }}>载入当前项目策划稿</button></details> : null}
        </div>

        <div className="min-w-0 space-y-4">
          <div aria-live="polite" aria-atomic="true">
            {busy ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sky-300/5 px-4 py-3 text-sm text-sky-100"><span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{pending === "generate" ? "正在写文案…" : "正在改写…"}</span><button className={buttonClass} type="button" onClick={cancelRequest}>取消</button></div> : null}
            {notice ? <p className="text-xs text-studio-muted">{notice}</p> : null}
          </div>
          {error ? <p role="alert" className="whitespace-pre-wrap rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100">{error}</p> : null}
          {changedBrief ? <p className="rounded-lg border border-amber-300/15 px-4 py-3 text-sm leading-6 text-amber-100">创作要求已修改，重新生成后应用到文案。</p> : null}
          {!draft ? <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-studio-line bg-studio-panel/40 p-8 text-center">
            <Sparkles className="mb-4 h-7 w-7 text-sky-200/60" aria-hidden="true" /><h3 className="text-lg font-semibold">今天想写什么？</h3>
            <p className="mt-3 max-w-sm text-sm leading-7 text-studio-muted">写下主题，开始第一份文案。</p>
          </div> : <>
            <div className="space-y-4 rounded-xl border border-studio-line bg-studio-panel/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-studio-muted">{draft.sections.length} 段 · {readableCharacters} 字</p>
                <div className="flex flex-wrap gap-2"><button aria-label="撤回 AI 修改" className={buttonClass} type="button" disabled={busy || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { changeWorking(previous); setHistory((current) => current.slice(0, -1)); setRewriteId(null); setNotice("已撤回。"); } }}><Undo2 className="h-4 w-4" aria-hidden="true" />撤回</button><button className={buttonClass} type="button" onClick={() => downloadDraft(draftBrief, draft)}><Download className="h-4 w-4" aria-hidden="true" />下载文案</button></div>
              </div>
              <label className="block"><span className="sr-only">文案标题</span><input aria-label="文案标题" className="w-full min-w-0 rounded-md bg-transparent py-2 text-xl font-semibold text-studio-text outline-none focus:ring-2 focus:ring-sky-300/20 disabled:opacity-50" value={draft.title} maxLength={120} disabled={busy} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
              <details><summary className="cursor-pointer text-xs text-studio-muted">场景与角色</summary><div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2"><label className="block space-y-1 text-sm"><span className="text-studio-muted">场景设定</span><textarea aria-label="场景设定" className={fieldClass} value={draft.scene} maxLength={1000} rows={2} disabled={busy} onChange={(event) => updateDraft({ scene: event.target.value })} /></label><label className="block space-y-1 text-sm"><span className="text-studio-muted">角色设定</span><textarea aria-label="角色设定" className={fieldClass} value={draft.character.role} maxLength={200} rows={2} disabled={busy} onChange={(event) => updateDraft({ character: { ...draft.character, role: event.target.value } })} /></label></div></details>
            </div>
            {draft.sections.map((section, index) => <article key={section.id} className={`min-w-0 rounded-xl border bg-studio-panel/90 p-4 ${rewriteId === section.id ? "border-sky-300/40" : "border-studio-line"}`}>
              <div className="mb-3 flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs text-studio-muted">{String(index + 1).padStart(2, "0")}</span><input aria-label={`第 ${index + 1} 段标题`} className={`${fieldClass} font-semibold`} value={section.title} maxLength={120} disabled={busy} onChange={(event) => updateSection(section.id, { title: event.target.value })} /></div>
              <label className="block text-sm"><span className="sr-only">台词</span><textarea aria-label={`第 ${index + 1} 段台词`} className="w-full min-w-0 resize-y rounded-md bg-transparent px-1 py-2 text-base leading-8 text-studio-text outline-none focus:ring-2 focus:ring-sky-300/20 disabled:opacity-50" value={section.text} maxLength={3000} rows={Math.min(12, Math.max(2, Math.ceil(section.text.length / 40)))} disabled={busy} onChange={(event) => updateSection(section.id, { text: event.target.value })} />{section.text.length >= 2800 ? <span className="text-xs text-studio-muted">{section.text.length} / 3000 字</span> : null}</label>
              <div className="relative mt-3 border-t border-studio-line pt-3">
              <details><summary className="min-h-10 cursor-pointer pr-28 text-xs leading-10 text-studio-muted">导演与声音</summary>
              <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2"><label className="block space-y-1 text-xs text-studio-muted"><span>导演提示</span><textarea aria-label={`第 ${index + 1} 段导演提示`} className={fieldClass} value={section.direction} maxLength={1000} rows={2} disabled={busy} onChange={(event) => updateSection(section.id, { direction: event.target.value })} /></label><label className="block space-y-1 text-xs text-studio-muted"><span>音效安排</span><textarea aria-label={`第 ${index + 1} 段音效建议`} className={fieldClass} value={section.soundSuggestions} maxLength={1000} rows={2} disabled={busy} onChange={(event) => updateSection(section.id, { soundSuggestions: event.target.value })} /></label></div>
              <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3">
                {([['emotion', '情绪'], ['style', '风格'], ['pace', '语速']] as const).map(([key, label]) => <label key={key} className="space-y-1 text-xs text-studio-muted"><span>{label}</span><input aria-label={`第 ${index + 1} 段${label}`} className={fieldClass} maxLength={100} value={section[key]} disabled={busy} onChange={(event) => updateSection(section.id, { [key]: event.target.value })} /></label>)}
                <label className="space-y-1 text-xs text-studio-muted"><span>段后留白</span><select aria-label={`第 ${index + 1} 段留白`} className={fieldClass} value={section.pauseAfter} disabled={busy} onChange={(event) => updateSection(section.id, { pauseAfter: event.target.value as PlannerSection['pauseAfter'] })}><option value="short">短</option><option value="medium">中</option><option value="long">长</option></select></label>
                <label className="space-y-1 text-xs text-studio-muted"><span>左右位置</span><select aria-label={`第 ${index + 1} 段位置`} className={fieldClass} value={section.position.pan < -0.2 ? "left" : section.position.pan > 0.2 ? "right" : "center"} disabled={busy} onChange={(event) => updateSection(section.id, { position: { ...section.position, pan: event.target.value === "left" ? -0.7 : event.target.value === "right" ? 0.7 : 0 } })}><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option></select></label>
              </div></details>
              <button aria-label={`AI 改写第 ${index + 1} 段`} className={`${buttonClass} absolute right-0 top-3`} type="button" disabled={busy} onClick={() => { setRewriteId(rewriteId === section.id ? null : section.id); setInstruction(""); setError(""); }} aria-expanded={rewriteId === section.id}><Sparkles className="h-4 w-4" aria-hidden="true" />AI 改写</button></div>
              {rewriteId === section.id ? <div className="mt-3 space-y-3 rounded-lg bg-sky-300/[0.04] p-3"><label className="block space-y-2 text-sm"><span>这一段怎么改？</span><textarea aria-label={`第 ${index + 1} 段改写要求`} value={instruction} onChange={(event) => setInstruction(event.target.value)} className={fieldClass} rows={2} maxLength={2000} disabled={busy} placeholder="例如：更像日常聊天，减少说教，保留翻书的动作。" /></label><button className={primaryClass} type="button" disabled={busy || !instruction.trim() || !provider?.configured} onClick={() => void runPlanner("rewrite")}>改写这一段</button></div> : null}
            </article>)}
            <div className="flex justify-end border-t border-studio-line pt-4"><button aria-label="采用并创建工程" className={primaryClass} type="button" disabled={busy || !loaded} onClick={adopt}>创建音频工程<ArrowRight className="h-4 w-4" aria-hidden="true" /></button></div>
          </>}
        </div>
      </div>
    </section>
  );
}
