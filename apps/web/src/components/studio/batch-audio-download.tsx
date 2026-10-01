"use client";

import { Archive, Check, Download, Folder, Headphones, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { getBatchDownloadClips, getBatchDownloadFilename, getBatchDownloadFolderName } from "@/lib/asmr/batch-download";
import type { AsmrProject } from "@/lib/asmr/schema";

export function BatchAudioDownload({ project }: { project: AsmrProject }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "preparing" | "downloaded" | "error">("idle");
  const [error, setError] = useState<string>();
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const focusAfterCancelRef = useRef(false);
  const clips = getBatchDownloadClips(project);
  const busy = status === "preparing";

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => () => { requestRef.current?.abort(); }, []);

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
    function dismissEscape(event: KeyboardEvent) {
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

  async function download() {
    if (requestRef.current || clips.length === 0) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("preparing");
    setError(undefined);
    try {
      const response = await fetch("/api/assets/batch-download", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project }), signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof detail?.error === "string" ? detail.error : "下载准备失败，请重试。");
      }
      if (!response.headers.get("content-type")?.includes("application/zip")) throw new Error("下载文件暂不可用，请重试。");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = getBatchDownloadFilename(project);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Let the browser start reading the Blob before releasing its URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setStatus("downloaded");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "下载准备失败，请重试。");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function cancel() {
    requestRef.current?.abort();
    requestRef.current = null;
    focusAfterCancelRef.current = true;
    setStatus("idle");
    setError(undefined);
  }

  return <>
    <button
      ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)}
      aria-label="批量下载音频" aria-controls={panelId} aria-expanded={open}
      title={busy ? "正在准备音频下载" : "批量下载已采用音频"}
      className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/16 focus:outline-none focus:ring-2 focus:ring-emerald-300/45"
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
      <span className="sr-only sm:not-sr-only">批量下载</span>
      {clips.length > 0 && <span aria-hidden="true" className="hidden min-w-4 rounded bg-emerald-200/10 px-1 py-0.5 text-[10px] leading-none tabular-nums md:inline-block">{clips.length}</span>}
    </button>
    {open && <div
      ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) setOpen(false);
      }}
      className="absolute right-2 top-full z-30 mt-2 w-[min(23rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl border border-white/12 bg-studio-panel p-4 text-studio-text shadow-[0_18px_60px_rgba(0,0,0,0.5)] outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><Archive className="h-4 w-4 text-emerald-200" aria-hidden="true" />批量下载音频</h2>
          <p className="mt-1.5 text-xs leading-5 text-studio-muted">{clips.length > 0 ? `当前工程已采用 ${clips.length} 个片段，打包为一个 ZIP。` : "采用生成的音频后，即可在这里打包下载。"}</p>
        </div>
        <button type="button" onClick={close} aria-label="关闭批量下载" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-studio-muted transition hover:bg-white/5 hover:text-studio-text focus:outline-none focus:ring-2 focus:ring-sky-300/45"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/15 p-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium"><Folder className="h-4 w-4 shrink-0 text-amber-200/80" aria-hidden="true" /><span className="truncate" title={getBatchDownloadFolderName(project)}>{getBatchDownloadFolderName(project)}</span></div>
        <div className="ml-2 mt-3 space-y-3 border-l border-white/10 pl-3">
          <div className="flex items-start gap-2"><Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-studio-muted" aria-hidden="true" /><div><p className="text-xs font-medium">无后处理</p><p className="mt-0.5 text-[11px] leading-5 text-studio-muted">已采用原声，保留原始音频文件。</p></div></div>
          <div className="flex items-start gap-2"><Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-200/80" aria-hidden="true" /><div><p className="text-xs font-medium">后处理</p><p className="mt-0.5 text-[11px] leading-5 text-studio-muted">{project.timeline.mixing.binaural ? "沿用当前空间、距离与移动设置，以及音量和淡入淡出。" : "沿用当前音量、声像和淡入淡出；双耳空间当前已关闭。"}</p></div></div>
        </div>
      </div>
      <p className="mt-2.5 text-[11px] leading-5 text-studio-muted">两个版本使用相同编号，按时间线顺序排列。</p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">{error}</p>}
      {status === "downloaded" && <p role="status" className="mt-3 flex items-center gap-2 text-xs leading-5 text-emerald-200"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />下载已发起，解压后即可查看两个文件夹。</p>}
      <div className="mt-4 flex items-center gap-2">
        <button ref={actionRef} type="button" onClick={() => void download()} disabled={clips.length === 0 || busy} className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/15 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/22 focus:outline-none focus:ring-2 focus:ring-emerald-300/45 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-studio-muted">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          {busy ? "正在准备音频…" : status === "error" ? "重试下载 ZIP" : "下载 ZIP"}
        </button>
        {busy && <button type="button" onClick={cancel} className="h-10 rounded-lg border border-studio-line px-3 text-xs text-studio-muted transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-sky-300/45">取消</button>}
      </div>
      {busy && <p role="status" className="mt-2 text-[11px] leading-5 text-studio-muted">正在整理原声与后处理音频，请稍候。</p>}
    </div>}
  </>;
}
