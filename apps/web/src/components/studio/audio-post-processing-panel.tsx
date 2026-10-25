"use client";

import { Download, Headphones, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createAudioPostProcessingInputFingerprint, getAudioPostProcessingClips, getAudioPostProcessingSummary,
  getCurrentAudioPostProcessingReceipts } from "@/lib/asmr/audio-post-processing";
import type { AudioPostProcessingAnchor } from "@/lib/asmr/audio-post-processing-schema";
import { resolvePlayableAssetUri } from "@/lib/asmr/playback-asset-resolver";
import type { AsmrProject } from "@/lib/asmr/schema";
import { getValueLabel } from "@/lib/asmr/ui-copy";
import { AudioPlayer } from "./audio-player";

type PreviewResult = { audioUrl: string; filename: string; clipCount: number; skippedCount: number; duration: number; size: number; expiresAt: number };
type PreviewState = { source: string; status: "preparing" | "ready" | "error"; result?: PreviewResult; error?: string };
const tokenUrl = /^\/api\/assets\/voice-preview\?token=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buttonClass = "inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-teal-300/20 bg-teal-300/[0.06] px-2.5 text-xs text-teal-100 hover:bg-teal-300/12 focus-visible:outline-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-35";
function release(url?: string) { if (url && tokenUrl.test(url)) void fetch(url, { method: "DELETE", keepalive: true }).catch(() => {}); }
function anchorLabel(anchor: AudioPostProcessingAnchor) {
  return `${anchor.pan < -.05 ? "左侧" : anchor.pan > .05 ? "右侧" : "正前"} · ${getValueLabel(anchor.distance)}`;
}

/** Shows stored results only. Playback and download never start DSP. */
export function AudioPostProcessingPanel({ project, busy = false, notice }: { project: AsmrProject; busy?: boolean; notice?: string }) {
  const summary = useMemo(() => getAudioPostProcessingSummary(project), [project]);
  const clips = useMemo(() => getAudioPostProcessingClips(project).filter(clip => clip.kind !== "silent"), [project]);
  const processing = project.audioPostProcessing;
  const receipts = useMemo(() => getCurrentAudioPostProcessingReceipts(project), [project]);
  const source = useMemo(() => JSON.stringify({ projectId: project.project_id, mode: project.speechWorkspace?.activeMode ?? "short",
    input: createAudioPostProcessingInputFingerprint(project), results: processing?.results,
    settings: clips.map(clip => [clip.id, clip.position, clip.volume_db, clip.fade_in, clip.fade_out]), complete: summary.complete }), [project, processing, clips, summary.complete]);
  const sourceRef = useRef(source);
  useLayoutEffect(() => { sourceRef.current = source; }, [source]);
  const requestRef = useRef<AbortController | null>(null);
  const resultRef = useRef<PreviewResult | undefined>(undefined);
  const [preview, setPreview] = useState<PreviewState>();
  const [expanded, setExpanded] = useState(false);
  const current = preview?.source === source ? preview : undefined;
  const ready = current?.status === "ready" ? current.result : undefined;
  if (preview && preview.source !== source) setPreview(undefined);

  useEffect(() => {
    const clear = () => {
      requestRef.current?.abort(); requestRef.current = null;
      release(resultRef.current?.audioUrl); resultRef.current = undefined;
    };
    const hide = () => { clear(); setPreview(undefined); };
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("pagehide", hide); clear(); };
  }, [source]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (resultRef.current !== ready) return;
      release(ready.audioUrl); resultRef.current = undefined;
      setPreview({ source, status: "error", error: "整体试听已到期，请重新准备。" });
    }, Math.max(0, ready.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ready, source]);

  async function preparePreview() {
    if (busy || !summary.complete || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    release(resultRef.current?.audioUrl); resultRef.current = undefined;
    setPreview({ source, status: "preparing" });
    const active = () => requestRef.current === controller && !controller.signal.aborted && sourceRef.current === source;
    try {
      const response = await fetch("/api/assets/voice-preview", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, audioVersion: "processed" }), signal: controller.signal });
      const data = await response.json() as Partial<PreviewResult> & { error?: string };
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "后处理整体试听暂不可用，请重试。");
      if (!data || typeof data.audioUrl !== "string" || !tokenUrl.test(data.audioUrl) || typeof data.filename !== "string" || !data.filename
        || data.clipCount !== clips.length || data.skippedCount !== 0 || typeof data.duration !== "number" || !Number.isFinite(data.duration) || data.duration <= 0
        || typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size <= 44
        || typeof data.expiresAt !== "number" || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) {
        release(data?.audioUrl); throw new Error("后处理试听文件无效，请重新准备。");
      }
      if (!active()) { release(data.audioUrl); return; }
      resultRef.current = data as PreviewResult;
      setPreview({ source, status: "ready", result: data as PreviewResult });
    } catch (error) {
      if (active()) setPreview({ source, status: "error", error: error instanceof Error ? error.message : "整体试听失败，请重试。" });
    } finally { if (requestRef.current === controller) requestRef.current = null; }
  }
  function cancelPreview() { requestRef.current?.abort(); requestRef.current = null; setPreview(undefined); }

  if (!processing) return notice ? <p role="status" className="border-b border-studio-line px-3 py-2 text-xs text-studio-muted">{notice}</p> : null;
  return <section aria-label="音频后处理结果" className="min-w-0 border-b border-studio-line bg-teal-300/[0.025] px-3 py-2">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="text-[11px] text-studio-muted"><span className="font-medium text-teal-100">后处理结果</span> · 当前完成 {summary.completed}/{summary.total} 镜 · 原音保留</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={buttonClass} disabled={busy || !summary.complete || current?.status === "preparing"} onClick={() => void preparePreview()}
          aria-label="后处理整体试听" title={summary.complete ? "按镜头顺序连接已生成的后处理结果，不重新渲染。" : "全部镜头后处理完成且未过期后，可整体试听。"}>
          {current?.status === "preparing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : ready ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : <Headphones className="h-3.5 w-3.5" aria-hidden="true" />}
          {current?.status === "preparing" ? "准备试听…" : "后处理整体试听"}
        </button>
        {current?.status === "preparing" && <button type="button" className={buttonClass} aria-label="取消后处理整体试听" onClick={cancelPreview}><X className="h-3.5 w-3.5" />取消</button>}
        {ready && <a className={buttonClass} href={`${ready.audioUrl}&download=1`} download={ready.filename} aria-label="下载后处理整体 WAV"><Download className="h-3.5 w-3.5" />WAV</a>}
      </div>
    </div>
    {notice && <p role="status" className="mt-1.5 break-words text-xs text-studio-muted">{notice}</p>}
    {ready && <AudioPlayer key={ready.audioUrl} src={ready.audioUrl} label="后处理整体成品试听" className="mt-2 w-full" />}
    {current?.status === "error" && <p role="alert" className="mt-1.5 break-words text-xs text-amber-100">{current.error}</p>}
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="mt-1.5 min-w-0">
      <summary aria-label="逐镜后处理结果" className="cursor-pointer py-1 text-[11px] text-studio-muted">逐镜处理结果</summary>
      {expanded && <div className="mt-1 space-y-2">{clips.map((clip, index) => {
      const receipt = receipts.get(clip.id);
      const previous = processing.results[clip.id];
      const shot = processing.shots.find(item => item.clipId === clip.id);
      const asset = receipt?.asset ?? previous?.asset;
      const uri = resolvePlayableAssetUri(asset?.uri);
      return <article key={clip.id} aria-label={`第 ${index + 1} 镜后处理`} className="min-w-0 rounded-md border border-studio-line bg-black/10 p-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]"><span className="font-medium text-studio-text">第 {index + 1} 镜</span><span className={receipt ? "text-teal-100" : "text-amber-100"}>{receipt ? "已完成" : previous ? "需更新 · 上次结果保留" : "尚未生成"}</span></div>
        {shot && <p className="mt-1 break-words text-[11px] leading-5 text-studio-muted">起点 {anchorLabel(shot.start)} → 终点 {anchorLabel(shot.end)} · {getValueLabel(shot.movement)}</p>}
        {uri && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5"><AudioPlayer key={uri} src={uri} compact label={`第 ${index + 1} 镜${receipt ? "" : "上次"}后处理试听`} className="min-w-0 flex-1" /><a className={buttonClass} href={`${uri}?download=1`} download aria-label={`下载第 ${index + 1} 镜${receipt ? "" : "上次"}后处理`}><Download className="h-3.5 w-3.5" aria-hidden="true" />WAV</a></div>}
      </article>;
    })}</div>}
    </details>
  </section>;
}
