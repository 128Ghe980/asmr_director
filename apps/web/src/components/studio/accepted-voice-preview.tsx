"use client";

import { Download, Headphones, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAcceptedVoicePreviewPlan } from "@/lib/asmr/accepted-voice-preview";
import type { AsmrProject } from "@/lib/asmr/schema";
import { AudioPlayer } from "./audio-player";

type PreviewResult = {
  audioUrl: string; filename: string; clipCount: number; skippedCount: number;
  duration: number; size: number; expiresAt: number;
};
type PreviewState = { source: string; status: "preparing" | "ready" | "error"; result?: PreviewResult; error?: string };
const urlPattern = /^\/api\/assets\/voice-preview\?token=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buttonClass = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-sky-300/25 bg-sky-300/10 px-2.5 text-xs text-sky-100 hover:bg-sky-300/15 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-35";

function releasePreview(url?: string) {
  if (url && urlPattern.test(url)) void fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
}

export function AcceptedVoicePreview({ project, disabled = false, onAudioElementChange, onPlaybackStart }: {
  project: AsmrProject; disabled?: boolean; onAudioElementChange?: (audio: HTMLAudioElement | null) => void; onPlaybackStart?: () => void;
}) {
  const plan = useMemo(() => getAcceptedVoicePreviewPlan(project), [project]);
  const source = plan.fingerprint;
  const sourceRef = useRef(source);
  useLayoutEffect(() => { sourceRef.current = source; }, [source]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const resultRef = useRef<PreviewResult | undefined>(undefined);
  const [state, setState] = useState<PreviewState>();
  // Discard an old result before an undo can revisit its released preview token.
  if (state && state.source !== source) setState(undefined);
  const setAudioElement = useCallback((element: HTMLAudioElement | null) => {
    const previous = audioRef.current;
    if (previous && previous !== element) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
    audioRef.current = element;
    onAudioElementChange?.(element);
    // React may detach and reattach the same element during development checks.
    if (element && resultRef.current) element.setAttribute("src", resultRef.current.audioUrl);
  }, [onAudioElementChange]);
  const current = state?.source === source ? state : undefined;
  const busy = current?.status === "preparing";
  const ready = current?.status === "ready" ? current.result : undefined;

  useEffect(() => {
    const clear = () => {
      requestRef.current?.abort();
      requestRef.current = null;
      const audio = audioRef.current;
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
      releasePreview(resultRef.current?.audioUrl);
      resultRef.current = undefined;
    };
    const pagehide = () => { clear(); setState(undefined); };
    window.addEventListener("pagehide", pagehide);
    return () => { window.removeEventListener("pagehide", pagehide); clear(); };
  }, [source, audioRef]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (resultRef.current !== ready) return;
      audioRef.current?.pause();
      releasePreview(ready.audioUrl);
      resultRef.current = undefined;
      setState({ source, status: "error", error: "预览已到期，点击整体预览重新合并。" });
    }, Math.max(0, ready.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ready, source, audioRef]);

  async function prepare() {
    if (disabled || !plan.entries.length || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    audioRef.current?.pause();
    releasePreview(resultRef.current?.audioUrl);
    resultRef.current = undefined;
    setState({ source, status: "preparing" });
    const active = () => requestRef.current === controller && !controller.signal.aborted && sourceRef.current === source;
    try {
      const response = await fetch("/api/assets/voice-preview", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project }), signal: controller.signal });
      const data = await response.json() as Partial<PreviewResult> & { error?: string };
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "整体预览暂时不可用，请重试。");
      if (!data || typeof data.audioUrl !== "string" || !urlPattern.test(data.audioUrl)
        || data.filename !== plan.filename || data.clipCount !== plan.clipCount || data.skippedCount !== plan.skippedCount
        || typeof data.duration !== "number" || !Number.isFinite(data.duration) || data.duration <= 0
        || typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size <= 44
        || typeof data.expiresAt !== "number" || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) {
        releasePreview(data?.audioUrl);
        throw new Error("预览文件暂不可用，请重新合并。");
      }
      if (!active()) { releasePreview(data.audioUrl); return; }
      resultRef.current = data as PreviewResult;
      setState({ source, status: "ready", result: data as PreviewResult });
    } catch (error) {
      if (active()) setState({ source, status: "error", error: error instanceof Error ? error.message : "整体预览失败，请重试。" });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function cancel() {
    requestRef.current?.abort();
    requestRef.current = null;
    setState(undefined);
  }

  return <section aria-label="已采用语音整体预览" aria-busy={busy} className="min-w-0 border-b border-studio-line bg-sky-300/[0.025] px-3 py-2">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-studio-muted" title="按镜头顺序连接已采用原声，保留无台词时长与段后等待，跳过未采用台词。">
        <Headphones className="h-3.5 w-3.5 shrink-0 text-sky-200" aria-hidden="true" />
        <span>已采用语音 <span className="tabular-nums text-studio-text">{plan.clipCount}/{plan.totalVoiceCount}</span> 段</span>
        {plan.silentCount > 0 && <span className="text-violet-200">含 {plan.silentCount} 段无台词</span>}
        {Boolean(plan.staleCount) && <span className="text-amber-200">{plan.staleCount} 段音频待更新</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={buttonClass} disabled={disabled || !plan.entries.length || busy} onClick={() => void prepare()}
          aria-label={ready ? "更新整体预览" : "整体预览"} title="合并已采用原声，保留段后等待">
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : ready ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {busy ? "合并中…" : ready ? "更新预览" : "整体预览"}
        </button>
        {busy && <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-studio-muted hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-sky-300" aria-label="取消整体预览" onClick={cancel}><X className="h-3.5 w-3.5" /></button>}
        {ready && <a href={`${ready.audioUrl}&download=1`} download={ready.filename} className={buttonClass} aria-label="下载整体预览 WAV"><Download className="h-3.5 w-3.5" aria-hidden="true" />WAV</a>}
      </div>
    </div>
    {ready && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <AudioPlayer ref={setAudioElement} label="已采用语音整体试听" preload="metadata" src={ready.audioUrl} onPlay={onPlaybackStart}
        statusDisplay="none" onError={() => setState({ source, status: "error", error: "预览音频无法读取，请重新合并。" })} className="w-full min-w-0 flex-1" />
      <span className="text-[10px] tabular-nums text-studio-muted">{ready.duration.toFixed(1)} 秒 · 原声{plan.skippedCount > 0 ? ` · 跳过 ${plan.skippedCount} 段` : ""}</span>
    </div>}
    {!plan.entries.length && <p className="mt-1 text-[11px] text-studio-muted">采用音频后，即可合并试听和下载。</p>}
    {current?.status === "error" && <p role="alert" className="mt-1.5 break-words text-xs text-amber-100">{current.error}</p>}
  </section>;
}
