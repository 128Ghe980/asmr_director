"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Clapperboard, Copy, Download, Link2, LoaderCircle, ScanLine, Sparkles } from "lucide-react";
import type { AsmrProject } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { sanitizeDownloadName } from "@/lib/asmr/batch-download";
import { getSpeechWorkspaceMode } from "@/lib/asmr/speech-workspace";
import { createStoryboardGenerationContextFingerprint } from "@/lib/asmr/storyboard-context";
import { AsmrSoundEditor } from "./asmr-sound-editor";
import {
  ClipVideoStoryboardSchema, createClipH3Prompt, createClipVideoSourceFingerprint,
  getPreviousVoiceClip, getPreviousClipPromptFingerprint, isClipVideoStoryboardCurrent,
  getClipStoryboardReferenceMode, type ClipVideoStoryboard, type StoryboardReferenceMode,
} from "@/lib/asmr/video-plan";

type Provider = { id: "ollama" | "api"; label: string; model: string; configured: boolean };
type Props = {
  project: AsmrProject;
  clipId: string;
  batchBusy?: boolean;
  referenceModeBusy?: boolean;
  onReferenceModeChange?: (clipId: string, mode: StoryboardReferenceMode) => void;
  onBusyChange?: (busy: boolean) => void;
  onProviderChange?: (provider: "api" | "ollama") => void;
  onSceneChange: (description: string) => void;
  onSave: (projectId: string, shot: ClipVideoStoryboard) => boolean;
  onEdit: (clipId: string, patch: Partial<Pick<ClipVideoStoryboard, "title" | "visual" | "action" | "camera" | "ambientSound" | "asmrSound">>) => void;
};

const buttonClass = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-violet-300/20 px-2.5 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-300/10 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass = "w-full min-w-0 resize-none rounded-lg border border-studio-line bg-black/15 px-3 py-2 text-sm leading-6 outline-none [field-sizing:content] focus:border-violet-300/40 focus:ring-2 focus:ring-violet-300/10";

export function ClipStoryboardEditor({ project, clipId, batchBusy = false, referenceModeBusy = false, onReferenceModeChange, onBusyChange, onProviderChange, onSceneChange, onSave, onEdit }: Props) {
  const clip = flattenClips(project).find((item) => item.id === clipId && item.type === "voice");
  const silent = clip?.type === "voice" && clip.kind === "silent";
  const workspaceMode = getSpeechWorkspaceMode(project);
  const narrativeFingerprint = createStoryboardGenerationContextFingerprint(project);
  const shot = project.videoPlan?.shots[clipId];
  const voices = flattenClips(project).filter((item) => item.type === "voice").sort((a, b) => a.start - b.start);
  const index = voices.findIndex((item) => item.id === clipId);
  const previous = getPreviousVoiceClip(project, clipId);
  const previousFingerprint = getPreviousClipPromptFingerprint(project, clipId);
  const [localReferenceMode, setLocalReferenceMode] = useState<{ projectId: string; clipId: string; mode: StoryboardReferenceMode }>();
  const savedReferenceMode = getClipStoryboardReferenceMode(project, clipId);
  const referenceMode = !previous ? "new" : !onReferenceModeChange && localReferenceMode?.projectId === project.project_id && localReferenceMode.clipId === clipId ? localReferenceMode.mode : savedReferenceMode;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<"ollama" | "api">("api");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const latestProject = useRef(project);
  const latestReferenceMode = useRef(referenceMode);
  const preview = useRef<HTMLTextAreaElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const effectiveProvider = silent ? "api" : provider;
  const configured = providers.find((item) => item.id === effectiveProvider)?.configured;
  const invalidSilentDuration = silent && (clip.duration <= 0 || clip.duration > 5);
  const sceneDescription = project.videoPlan?.sceneDescription ?? project.scene.name;
  const usePrevious = !!previousFingerprint;
  const waitingForPrevious = referenceMode === "continuous" && !previousFingerprint;
  const continuitySource = usePrevious ? previousFingerprint : undefined;
  let sourceFingerprint = "";
  try { sourceFingerprint = createClipVideoSourceFingerprint(project, clipId); }
  catch { /* The generation control explains missing adopted audio below. */ }
  const current = isClipVideoStoryboardCurrent(project, clipId);
  let prompt = "";
  try { prompt = createClipH3Prompt(project, clipId); }
  catch { /* Preserve incomplete or stale visual notes for editing. */ }

  const fitPromptPreview = useCallback(() => {
    const element = preview.current;
    if (!element || !disclosure.current?.open) return;
    element.style.height = "auto";
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
  }, []);
  useLayoutEffect(() => {
    fitPromptPreview();
    const element = preview.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let previousWidth = element.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== previousWidth) {
        previousWidth = entry.contentRect.width;
        fitPromptPreview();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [prompt, fitPromptPreview]);

  useEffect(() => { latestProject.current = project; }, [project]);
  useEffect(() => { latestReferenceMode.current = referenceMode; }, [referenceMode]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/planner", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("config");
      return await response.json() as { providers: Provider[]; defaultProvider: "ollama" | "api" };
    }).then((catalog) => {
      if (controller.signal.aborted) return;
      setProviders(catalog.providers);
      const initialProvider = silent ? "api" : catalog.defaultProvider;
      setProvider(initialProvider);
      onProviderChange?.(initialProvider);
    }).catch(() => { if (!controller.signal.aborted) setError("暂时无法读取分镜模型配置，请切回后重试。"); });
    return () => controller.abort();
  }, [onProviderChange, silent]);
  useEffect(() => {
    // The model also reads the whole narrative; changed neighboring context cancels old work.
    return () => { requestRef.current?.abort(); };
  }, [sourceFingerprint, continuitySource, narrativeFingerprint, referenceMode, clipId, project.project_id, workspaceMode]);
  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; onBusyChange?.(false); }, [onBusyChange]);

  function cancel() {
    requestRef.current?.abort(); requestRef.current = null;
    onBusyChange?.(false);
    setBusy(false); setNotice("已取消分镜生成。");
  }

  async function generate() {
    if (batchBusy || waitingForPrevious || invalidSilentDuration || clip?.type !== "voice" || !sourceFingerprint || !sceneDescription.trim() || requestRef.current || !configured) return;
    if (shot && !window.confirm("重新生成本段分镜？成功后将替换本段已有分镜及手动修改，失败或取消会保留原分镜。")) return;
    const snapshot = structuredClone(project);
    const controller = new AbortController();
    requestRef.current = controller; setBusy(true); setError(""); setNotice("");
    onBusyChange?.(true);
    try {
      const response = await fetch("/api/clip-storyboard", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ provider: effectiveProvider, project: snapshot, clipId, referenceMode, includePrevious: usePrevious, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) }),
      });
      const body = await response.json();
      if (requestRef.current !== controller || controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "本段分镜生成失败，请重试。");
      const result = ClipVideoStoryboardSchema.parse(body.storyboard);
      const latest = latestProject.current;
      if (latest.project_id !== snapshot.project_id || result.clipId !== clipId || result.sourceFingerprint !== sourceFingerprint
        || getSpeechWorkspaceMode(latest) !== workspaceMode
        || result.referenceMode !== referenceMode || latestReferenceMode.current !== referenceMode
        || (silent ? result.kind !== "silent" || result.audio !== undefined || result.duration !== clip.duration || !result.ambientSound?.trim()
          : result.kind === "silent" || result.audio?.assetId !== clip.asset.asset_id || result.audio?.uri !== clip.asset.uri)
        || createClipVideoSourceFingerprint(latest, clipId) !== sourceFingerprint
        || createStoryboardGenerationContextFingerprint(latest) !== narrativeFingerprint
        || getPreviousClipPromptFingerprint(latest, clipId) !== previousFingerprint
        || Boolean(result.previousClipId) !== usePrevious
        || (usePrevious && (result.previousClipId !== previous?.id || result.previousPromptFingerprint !== previousFingerprint))) {
        throw new Error("台词、音频、镜头模式或参考分镜已更新，请重新生成。");
      }
      if (!onSave(snapshot.project_id, result)) throw new Error("当前段落已更新，请重新生成。");
      setNotice("本段分镜已生成并保存。");
    } catch (caught) {
      if (requestRef.current !== controller) return;
      if (controller.signal.aborted) setNotice("素材已更新，已取消旧分镜请求。");
      else setError(caught instanceof Error ? caught.message : "本段分镜生成失败，请重试。");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); onBusyChange?.(false); }
    }
  }

  function edit(patch: Parameters<Props["onEdit"]>[1]) {
    if (requestRef.current) cancel();
    setNotice(""); onEdit(clipId, patch);
  }

  function changeReferenceMode(mode: StoryboardReferenceMode) {
    if (busy || batchBusy || referenceModeBusy || (mode === "continuous" && !previous)) return;
    setError(""); setNotice("");
    if (onReferenceModeChange) onReferenceModeChange(clipId, mode);
    else setLocalReferenceMode({ projectId: project.project_id, clipId, mode });
  }

  async function copy() {
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); setCopiedPrompt(prompt); setNotice(""); }
    catch {
      setCopiedPrompt("");
      if (disclosure.current) disclosure.current.open = true;
      preview.current?.focus(); preview.current?.select();
      setNotice("自动复制未成功，已选中提示词，请手动复制。");
    }
  }

  function download() {
    if (!prompt) return;
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `${sanitizeDownloadName(project.title)}-第${String(index + 1).padStart(3, "0")}段-H3.txt`;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  if (clip?.type !== "voice") return null;
  return <section aria-label="本段视频分镜" className="min-w-0 space-y-4 px-4 py-4">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-300/10 text-violet-200"><Clapperboard className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0"><h2 className="text-sm font-semibold">第 {index + 1} 段 · {silent ? "无对白分镜" : "视频分镜"}</h2></div>
    </div>
    {invalidSilentDuration ? <p className="text-xs leading-5 text-amber-100">请将无对白镜头时长调整为不超过 5 秒，再生成分镜。</p> : null}
    {silent && shot && !shot.ambientSound?.trim() ? <p className="text-xs leading-5 text-amber-100">旧无对白分镜缺少环境底噪描述，请重新生成分镜。</p> : null}
    <div className="rounded-lg border border-studio-line bg-black/10 px-3 py-2.5">
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{clip.text}</p>
      {silent ? <p className="mt-2 text-[11px] text-violet-200">无对白 · {clip.duration.toFixed(1)} 秒</p> : sourceFingerprint ? <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-violet-200/80"><span>已采用音频{clip.asset.duration ? ` · ${(shot?.audio?.assetId === clip.asset.asset_id ? shot.audio!.duration : clip.asset.duration).toFixed(3)} 秒` : ""}</span><a href={`/api/assets/clip/${encodeURIComponent(clip.asset.asset_id!)}`} download={`第${String(index + 1).padStart(3, "0")}段音频.wav`} className="inline-flex items-center gap-1 hover:text-violet-100"><Download className="h-3 w-3" aria-hidden="true" />下载本段音频</a></div> : <p className="mt-2 text-xs leading-5 text-amber-100">先生成并采用本段音频，再生成对应分镜。</p>}
    </div>
    <details className="rounded-lg border border-studio-line px-3 py-2.5 text-xs text-studio-muted">
      <summary className="cursor-pointer hover:text-studio-text">剧情背景 <span className="ml-1 text-studio-muted/55">全工程参考</span></summary>
      <textarea aria-label="工程剧情背景" disabled={batchBusy} value={sceneDescription} maxLength={4000} rows={3} className={`${fieldClass} mt-3 text-studio-text`} placeholder="雪地中的木屋内，壁炉温暖，窗外飘雪。" onChange={(event) => { if (busy) cancel(); onSceneChange(event.target.value); }} />
      <p className="mt-2 text-[11px] leading-5">仅作剧情参考，分镜选取本段具体画面，不原文复制背景。</p>
    </details>
    {!sceneDescription.trim() ? <p className="text-xs leading-5 text-amber-100">请补全剧情背景后生成分镜。</p> : null}
    <div className="space-y-3 rounded-lg border border-violet-300/15 bg-violet-300/[0.035] p-3">
      <div className="space-y-2">
        <div role="radiogroup" aria-label="下一次分镜生成模式" className="grid grid-cols-2 gap-2">
          {(["continuous", "new"] as const).map((mode) => <label key={mode} title={mode === "continuous" && !previous ? "首段从剧情背景开始，无上一段镜头可延续。" : undefined} className={`flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors focus-within:outline-2 focus-within:outline-violet-300 ${busy || batchBusy || referenceModeBusy || (mode === "continuous" && !previous) ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-white/5"} ${referenceMode === mode ? mode === "continuous" ? "border-violet-300/35 bg-violet-300/10 text-violet-100" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-studio-line text-studio-muted"}`}>
            <input type="radio" name={`storyboard-reference-mode-${clipId}`} aria-label={mode === "continuous" ? "连续镜头" : "新镜头"} checked={referenceMode === mode} disabled={busy || batchBusy || referenceModeBusy || (mode === "continuous" && !previous)} onChange={() => changeReferenceMode(mode)} className="sr-only" />
            {mode === "continuous" ? <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ScanLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}{mode === "continuous" ? "连续镜头" : "新镜头"}
          </label>)}
        </div>
        {waitingForPrevious ? <p className="text-[11px] leading-5 text-amber-100">上一段尚无可用分镜，先生成上一段后再生成连续镜头。</p> : null}
        <details className="text-[11px] leading-5 text-studio-muted">
          <summary className="cursor-pointer hover:text-studio-text">镜头参考说明</summary>
          <div className="mt-2 space-y-1">
            <p>{referenceMode === "continuous" ? "接续上一镜的场景、构图与动作。" : "按背景与本段内容设计新画面，上一镜仅作剧情参考。"}</p>
            {!previous ? <p>首段从剧情背景开始。</p> : !previousFingerprint && !waitingForPrevious ? <p>上一镜尚未就绪，本次新镜头仅参考背景。</p> : null}
            <p>模式用于下次生成，已有提示词保持原样。</p>
            <p>{silent ? "使用角色参考图 1，无需上传语音。" : "使用角色参考图 1 和本段音频 1。"}</p>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select aria-label="分镜模型" value={effectiveProvider} disabled={busy || batchBusy || silent} onChange={(event) => { const next = event.target.value as "ollama" | "api"; setProvider(next); onProviderChange?.(next); }} className="min-w-0 max-w-40 rounded-md border border-studio-line bg-studio-panel px-2 py-1.5 text-xs text-studio-muted">{providers.length ? providers.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label}</option>) : <option value="api">读取模型配置…</option>}</select>
        {busy ? <button type="button" className={buttonClass} onClick={cancel}><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />取消生成</button> : <button type="button" className={`${buttonClass} bg-violet-300/10`} disabled={batchBusy || waitingForPrevious || invalidSilentDuration || !sourceFingerprint || !sceneDescription.trim() || !configured} onClick={() => void generate()}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{shot ? "重做分镜" : "生成分镜"}</button>}
      </div>
      <details className="border-t border-violet-300/10 pt-2 text-[11px] text-studio-muted"><summary className="cursor-pointer">本段偏好 <span className="ml-1 opacity-60">选填</span></summary><textarea aria-label="本段分镜要求" rows={2} value={instruction} maxLength={1200} disabled={busy || batchBusy} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} mt-2 text-studio-text`} placeholder="例如：平缓固定机位，轻轻递来水杯。" /></details>
    </div>
    {error ? <p role="alert" className="text-xs leading-5 text-amber-100">{error}</p> : null}
    {notice ? <p role="status" className="text-xs leading-5 text-studio-muted">{notice}</p> : null}
    {shot && !current ? <p role="status" className="rounded-lg border border-amber-200/15 bg-amber-200/5 px-3 py-2 text-xs leading-5 text-amber-100">本段台词、音频、剧情背景或参考分镜已变化。已保留画面说明，请重新生成后使用提示词。</p> : null}
    {shot ? <div className="space-y-3">
      <input aria-label="本段分镜标题" disabled={batchBusy} value={shot.title} maxLength={120} className="w-full min-w-0 rounded bg-transparent py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-violet-300/25" onChange={(event) => edit({ title: event.target.value })} />
      {([['visual', '画面', 800], ['action', '动作', 600], ['camera', '镜头', 400]] as const).map(([field, label, maxLength]) => <label key={field} className="block min-w-0 space-y-1.5"><span className="text-[11px] font-medium text-studio-muted">{label}</span><textarea aria-label={`本段分镜${label}`} disabled={batchBusy} className={fieldClass} value={shot[field]} rows={field === "visual" ? 3 : 2} maxLength={maxLength} onChange={(event) => edit({ [field]: event.target.value })} /></label>)}
      {silent ? <label className="block min-w-0 space-y-1.5"><span className="text-[11px] font-medium text-studio-muted">环境声</span><textarea aria-label="本段分镜环境声" disabled={batchBusy} className={fieldClass} value={shot.ambientSound ?? ""} rows={2} maxLength={600} placeholder="Soft rain outside the window with a faint room tone." onChange={(event) => edit({ ambientSound: event.target.value })} /></label> : null}
      {shot.asmrSound ? <AsmrSoundEditor key={shot.clipId} sound={shot.asmrSound} duration={silent ? clip.duration : shot.audio?.duration ?? clip.asset.duration ?? 0} silent={silent} disabled={batchBusy} onChange={asmrSound => edit({ asmrSound })} /> : <p className="text-[11px] text-studio-muted">重做分镜可生成本段 ASMR 触发音。</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!prompt} onClick={() => void copy()}>{copiedPrompt === prompt && prompt ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}{copiedPrompt === prompt && prompt ? "已复制 H3 提示词" : "复制 H3 提示词"}</button><button type="button" className={buttonClass} disabled={!prompt} onClick={download}><Download className="h-3.5 w-3.5" aria-hidden="true" />下载提示词</button></div>
      <details ref={disclosure} onToggle={fitPromptPreview} className="rounded-lg border border-studio-line px-3 py-2.5 text-xs text-studio-muted"><summary className="cursor-pointer">H3 提示词预览</summary>{prompt ? <textarea ref={preview} aria-label="本段 H3 提示词" readOnly value={prompt} rows={8} spellCheck={false} className="mt-3 w-full min-w-0 resize-none overflow-hidden rounded-lg bg-black/20 px-2 py-2 font-mono text-xs leading-6 outline-none focus:ring-1 focus:ring-violet-300/30" /> : <p className="mt-2 leading-5">补全画面、动作与镜头，并确保分镜对应当前音频。</p>}</details>
    </div> : null}
  </section>;
}
