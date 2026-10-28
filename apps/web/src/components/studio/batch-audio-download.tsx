"use client";

import { Archive, Check, Clapperboard, Download, FileText, Folder, Headphones, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { getBatchDownloadClips, getBatchDownloadFilename, getBatchDownloadFolderName } from "@/lib/asmr/batch-download";
import type { AsmrProject } from "@/lib/asmr/schema";
import { getBatchStoryboardClips, getBatchStoryboardDownloadFilename, getBatchStoryboardDownloadFolderName } from "@/lib/asmr/storyboard-batch-download";
import { getStudioStoryboardProgress } from "@/lib/asmr/studio-storyboard-overview";
import { getVideoPackageFilename, getVideoPackageSummary } from "@/lib/asmr/video-package";
import { getCurrentAudioPostProcessingReceipts } from "@/lib/asmr/audio-post-processing";

type DownloadMode = "audio" | "storyboard" | "video";
type DownloadState = { source: string; mode: DownloadMode; status: "idle" | "preparing" | "downloaded" | "error"; error?: string };
const modes = [{ mode: "audio", label: "音频", icon: Headphones }, { mode: "storyboard", label: "分镜", icon: Clapperboard }, { mode: "video", label: "视频包", icon: Archive }] as const;

export function BatchAudioDownload({ project }: { project: AsmrProject }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DownloadMode>("audio");
  const [state, setState] = useState<DownloadState>();
  const [reference, setReference] = useState<File | null>(null);
  const [referenceError, setReferenceError] = useState<string>();
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const tabRefs = useRef<Record<DownloadMode, HTMLButtonElement | null>>({ audio: null, storyboard: null, video: null });
  const focusAfterCancelRef = useRef(false);
  const source = JSON.stringify(project);
  const clips = getBatchDownloadClips(project);
  const storyboards = getBatchStoryboardClips(project);
  const progress = getStudioStoryboardProgress(project);
  const video = getVideoPackageSummary(project);
  const voiceClips = project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []);
  const speechClips = voiceClips.filter(clip => clip.kind !== "silent");
  const videoIssueIds = new Set(video.issues.map(issue => issue.clipId));
  const videoAsmrReady = voiceClips.filter(clip => !videoIssueIds.has(clip.id) && project.videoPlan?.shots[clip.id]?.asmrSound).length;
  const preparedReceipts = getCurrentAudioPostProcessingReceipts(project);
  const videoUsesPrepared = speechClips.length > 0 && speechClips.every(clip => preparedReceipts.has(clip.id));
  const status = state?.source === source && state.mode === mode ? state.status : "idle";
  const error = status === "error" ? state?.error : undefined;
  const count = mode === "audio" ? clips.length : mode === "storyboard" ? storyboards.length : video.total;
  const busy = status === "preparing";
  const videoBlocked = mode === "video" && (video.issues.length > 0 || Boolean(referenceError));
  const modeLabel = mode === "audio" ? "音频" : mode === "storyboard" ? "分镜" : "视频包";

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Invalidate an in-flight snapshot before a new project/source can be used.
  useLayoutEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, [source]);

  useEffect(() => {
    if (!busy && focusAfterCancelRef.current) {
      focusAfterCancelRef.current = false;
      actionRef.current?.focus();
    }
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    function fitPanel() {
      if (panel) panel.style.maxHeight = `${Math.max(0, (window.visualViewport?.height ?? window.innerHeight) - panel.getBoundingClientRect().top - 8)}px`;
    }
    fitPanel();
    (actionRef.current?.disabled ? panel : actionRef.current)?.focus({ preventScroll: true });
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !panel?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    }
    function dismissEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented
        && (panel?.contains(document.activeElement) || document.activeElement === triggerRef.current)) {
        event.preventDefault(); setOpen(false); triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    window.addEventListener("resize", fitPanel);
    window.visualViewport?.addEventListener("resize", fitPanel);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
      window.removeEventListener("resize", fitPanel);
      window.visualViewport?.removeEventListener("resize", fitPanel);
    };
  }, [open]);

  function changeMode(next: DownloadMode) {
    if (busy || requestRef.current || mode === next) return;
    setMode(next);
    setState(undefined);
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
    const next = modes[nextIndex].mode;
    changeMode(next);
    tabRefs.current[next]?.focus();
  }

  async function download() {
    if (requestRef.current || count === 0 || videoBlocked) return;
    const snapshot = JSON.parse(source) as AsmrProject;
    const filename = mode === "audio" ? getBatchDownloadFilename(snapshot) : mode === "storyboard" ? getBatchStoryboardDownloadFilename(snapshot) : getVideoPackageFilename(snapshot);
    const controller = new AbortController();
    requestRef.current = controller;
    const active = () => !controller.signal.aborted && requestRef.current === controller;
    setState({ source, mode, status: "preparing" });
    try {
      const form = new FormData();
      if (mode === "video") {
        form.set("project", JSON.stringify(snapshot));
        if (reference) form.set("reference", reference);
      }
      const response = await fetch(mode === "video" ? "/api/assets/video-package" : "/api/assets/batch-download", {
        method: "POST", headers: mode === "video" ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
        body: mode === "video" ? form : JSON.stringify(mode === "audio" ? { project: snapshot } : { project: snapshot, kind: "storyboard" }), signal: controller.signal,
      });
      if (!active()) return;
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof detail?.error === "string" ? detail.error : "下载准备失败，请重试。");
      }
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("下载文件暂不可用，请重试。");
      const archive = await response.json() as { downloadUrl?: unknown; filename?: unknown; clipCount?: unknown; size?: unknown } | null;
      if (!active()) return;
      if (!archive || typeof archive.downloadUrl !== "string"
        || !/^\/api\/assets\/batch-download\?token=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(archive.downloadUrl)
        || archive.filename !== filename || archive.clipCount !== count
        || typeof archive.size !== "number" || !Number.isSafeInteger(archive.size) || archive.size <= 0) throw new Error("下载文件暂不可用，请重试。");
      const anchor = document.createElement("a");
      anchor.href = archive.downloadUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setState({ source, mode, status: "downloaded" });
    } catch (cause) {
      if (!active()) return;
      const connectionFailed = cause instanceof TypeError && /failed to fetch|fetch failed|networkerror|load failed/i.test(cause.message);
      setState({ source, mode, status: "error", error: connectionFailed ? `${mode === "video" ? "视频项目包" : `${modeLabel}包`}下载连接中断，请重试。` : cause instanceof Error ? cause.message : "下载准备失败，请重试。" });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function cancel() {
    requestRef.current?.abort();
    requestRef.current = null;
    focusAfterCancelRef.current = true;
    setState(undefined);
  }

  return <>
    <button
      ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)}
      aria-label="批量下载" aria-controls={panelId} aria-expanded={open}
      title={busy ? "正在准备批量下载" : "批量下载音频、分镜与视频项目包"}
      className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/16 focus:outline-none focus:ring-2 focus:ring-emerald-300/45"
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
      <span className="sr-only sm:not-sr-only">批量下载</span>
      {count > 0 && <span aria-hidden="true" className="hidden min-w-4 rounded bg-emerald-200/10 px-1 py-0.5 text-[10px] leading-none tabular-nums md:inline-block">{count}</span>}
    </button>
    {open && <div
      ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) setOpen(false);
      }}
      className="absolute right-2 top-full z-30 mt-2 w-[min(23rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-white/12 bg-studio-panel p-4 text-studio-text shadow-[0_18px_60px_rgba(0,0,0,0.5)] outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 pt-1 text-sm font-semibold"><Archive className="h-4 w-4 text-emerald-200" aria-hidden="true" />批量下载</h2>
        <button type="button" onClick={close} aria-label="关闭批量下载" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-studio-muted transition hover:bg-white/5 hover:text-studio-text focus:outline-none focus:ring-2 focus:ring-sky-300/45"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div role="tablist" aria-label="下载内容" className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-white/[0.06] bg-black/20 p-1">
        {modes.map((item, index) => <button key={item.mode} ref={(element) => { tabRefs.current[item.mode] = element; }} type="button" role="tab"
          id={`${panelId}-${item.mode}-tab`} aria-selected={mode === item.mode} aria-controls={`${panelId}-${item.mode}-panel`} tabIndex={mode === item.mode ? 0 : -1}
          disabled={busy} onClick={() => changeMode(item.mode)} onKeyDown={(event) => moveTab(event, index)}
          className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300/45 disabled:cursor-wait ${mode === item.mode ? item.mode === "audio" ? "bg-emerald-300/10 text-emerald-100" : "bg-violet-300/10 text-violet-100" : "text-studio-muted hover:bg-white/5 hover:text-studio-text"}`}>
          <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{item.label}
        </button>)}
      </div>
      <div id={`${panelId}-${mode}-panel`} role="tabpanel" aria-labelledby={`${panelId}-${mode}-tab`} aria-busy={busy}>
      {mode === "audio" ? <>
      <p className="mt-3 text-xs leading-5 text-studio-muted">{clips.length > 0 ? `当前工程已采用 ${clips.length} 个片段，打包为一个 ZIP。` : "采用生成的音频后，即可在这里打包下载。"}</p>
      <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/15 p-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium"><Folder className="h-4 w-4 shrink-0 text-amber-200/80" aria-hidden="true" /><span className="truncate" title={getBatchDownloadFolderName(project)}>{getBatchDownloadFolderName(project)}</span></div>
        <div className="ml-2 mt-3 space-y-3 border-l border-white/10 pl-3">
          <div className="flex items-start gap-2"><Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-studio-muted" aria-hidden="true" /><div><p className="text-xs font-medium">无后处理</p><p className="mt-0.5 text-[11px] leading-5 text-studio-muted">已采用原声，保留原始音频文件。</p></div></div>
          <div className="flex items-start gap-2"><Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-200/80" aria-hidden="true" /><div><p className="text-xs font-medium">后处理</p><p className="mt-0.5 text-[11px] leading-5 text-studio-muted">附上已生成且当前有效的后处理成品；请先在分镜右侧点击「生成后处理」。下载直接读取文件。</p></div></div>
        </div>
      </div>
      <p className="mt-2.5 text-[11px] leading-5 text-studio-muted">两个版本使用相同编号，按时间线顺序排列。</p>
      </> : mode === "storyboard" ? <>
        <p className="mt-3 text-xs leading-5 text-studio-muted">当前工程 {progress.total} 段台词，{storyboards.length} 段可下载。</p>
        <div role="group" aria-label="分镜下载状态" className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "已完成", value: progress.ready, tone: "text-emerald-200" },
            { label: "待生成", value: progress.pending, tone: "text-studio-muted" },
            { label: "需更新", value: progress.needsUpdate, tone: "text-amber-200" },
          ].map((item) => <div key={item.label} aria-label={`${item.label} ${item.value} 段`} className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-2">
            <p className={`text-base font-semibold leading-5 tabular-nums ${item.tone}`}>{item.value}</p><p className="mt-1 text-[10px] text-studio-muted">{item.label}</p>
          </div>)}
        </div>
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/15 p-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium"><Folder className="h-4 w-4 shrink-0 text-violet-200/80" aria-hidden="true" /><span className="truncate" title={getBatchStoryboardDownloadFolderName(project)}>{getBatchStoryboardDownloadFolderName(project)}</span></div>
          <div className="ml-2 mt-3 space-y-2 border-l border-white/10 pl-3">
            {storyboards.slice(0, 3).map((item) => <div key={item.clip.id} className="flex min-w-0 items-center gap-2 text-[11px] text-studio-muted"><FileText className="h-3.5 w-3.5 shrink-0 text-violet-200/60" aria-hidden="true" /><span className="truncate" title={item.filename}>{item.filename}</span></div>)}
            {storyboards.length > 3 && <p className="text-[11px] text-studio-muted">另外 {storyboards.length - 3} 段 TXT</p>}
            {storyboards.length === 0 && <p className="text-[11px] leading-5 text-studio-muted">暂无可下载分镜，请先生成或更新本段分镜。</p>}
          </div>
        </div>
        <p className="mt-2.5 text-[11px] leading-5 text-studio-muted">每段一个完整 H3 提示词 TXT，按台词顺序打包为 ZIP。</p>
        <p className="mt-1 text-[11px] leading-5 text-studio-muted">仅打包已保存、完整且未过期的提示词；待生成与需更新段落不包含在内。</p>
      </> : <>
        <p className="mt-3 text-xs leading-5 text-studio-muted">当前项目共 {video.total} 镜，打包音频、分镜和独立运行程序。</p>
        <p className="mt-2 text-[11px] leading-5 text-studio-muted">对白音频使用{videoUsesPrepared ? "已生成的后处理成品" : "已采用原音（整批后处理尚未完成）"}。按镜头顺序生成；无对白镜头带环境底噪，最长 5 秒。</p>
        {video.total > 0 && <div className="mt-2 rounded-lg border border-violet-300/15 bg-violet-300/[0.035] px-3 py-2 text-[11px] leading-5 text-studio-muted">
          <p>ASMR 触发音：{videoAsmrReady} / {video.total} 镜已规划</p>
          <p>{videoAsmrReady === video.total ? "勾选合并顺序预览后，输出原版与 ASMR 叠加版。" : `补齐剩余 ${video.total - videoAsmrReady} 镜的 ASMR 规划后，可合并叠加版。${video.issues.length ? "" : "当前可导出原版视频包。"}`}</p>
        </div>}
        <label className="mt-3 block text-xs font-medium" htmlFor={`${panelId}-reference`}>角色参考图（可选）</label>
        <input id={`${panelId}-reference`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setReference(file);
            setReferenceError(file && file.size > 8 * 1024 * 1024 ? "角色参考图不能超过 8 MiB。" : undefined);
            setState(undefined);
          }}
          className="mt-2 block w-full min-w-0 text-[11px] text-studio-muted file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-2 file:text-xs file:text-studio-text" />
        {reference && <p className="mt-1 break-all text-[11px] text-studio-muted">已选：{reference.name}</p>}
        {reference && <button type="button" disabled={busy} onClick={() => { setReference(null); setReferenceError(undefined); setState(undefined); const input = document.getElementById(`${panelId}-reference`) as HTMLInputElement | null; if (input) input.value = ""; }} className="mt-1 text-[11px] text-studio-muted underline underline-offset-2">移除参考图</button>}
        <p className="mt-2 text-[11px] leading-5 text-studio-muted">也可在生成主机运行前选择或替换参考图。</p>
        {referenceError && <p role="alert" className="mt-2 text-xs text-amber-100">{referenceError}</p>}
        {video.issues.length > 0 && <div className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/5 p-3 text-[11px] leading-5 text-amber-100">
          <p>请先补齐以下镜头：</p>
          <ul className="mt-1 list-inside list-disc">{video.issues.slice(0, 3).map((issue, index) => <li key={`${issue.clipId}-${index}`}>第 {issue.index} 镜：{issue.message}</li>)}</ul>
          {video.issues.length > 3 && <p>另有 {video.issues.length - 3} 项待补齐。</p>}
        </div>}
      </>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">{error}</p>}
      {status === "downloaded" && <p role="status" className="mt-3 flex items-center gap-2 text-xs leading-5 text-emerald-200"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{mode === "audio" ? "下载已发起，解压后即可查看两个文件夹。" : mode === "storyboard" ? "下载已发起，解压后即可逐段查看 H3 提示词。" : "下载已发起，解压后在生成主机打开 run.bat。"}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button ref={actionRef} type="button" onClick={() => void download()} disabled={count === 0 || busy || videoBlocked} className={`inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-studio-muted ${mode === "audio" ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100 hover:bg-emerald-300/22 focus:ring-emerald-300/45" : "border-violet-300/30 bg-violet-300/15 text-violet-100 hover:bg-violet-300/22 focus:ring-violet-300/45"}`}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          {busy ? `正在准备${modeLabel}…` : `${status === "error" ? "重试" : ""}下载${mode === "audio" ? "音频 ZIP" : mode === "storyboard" ? "分镜 TXT" : "视频项目包"}`}
        </button>
        {busy && <button type="button" onClick={cancel} className="h-10 rounded-lg border border-studio-line px-3 text-xs text-studio-muted transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-sky-300/45">取消</button>}
      </div>
      {busy && <p role="status" className="mt-2 text-[11px] leading-5 text-studio-muted">{mode === "audio" ? "正在整理原声与后处理音频，请稍候。" : mode === "storyboard" ? "正在整理分镜 TXT，请稍候。" : "正在整理逐镜素材与运行程序，请稍候。"}</p>}
      </div>
    </div>}
  </>;
}
