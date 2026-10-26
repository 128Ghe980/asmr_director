"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { AudioPlayer } from "./audio-player";

export type ImportedVoiceReference = VoiceProviderCatalog["providers"][number]["references"][number];
export type VoiceReferenceImportResult = { reference: ImportedVoiceReference; catalog: VoiceProviderCatalog };
export type VoiceReferenceImportProps = {
  disabled: boolean;
  onImported: (result: VoiceReferenceImportResult) => void;
  onCatalogRefresh: (catalog: VoiceProviderCatalog) => void;
  onBusyChange: (busy: boolean) => boolean | void;
  onPreviewPlay?: (audio: HTMLAudioElement) => void;
  toolbarContent?: ReactNode;
  compactToolbar?: boolean;
};

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 190_000;
type PendingAction = "import" | "refresh" | "transcribe";
type ReferenceLanguage = "zh" | "en" | "ja" | "ko";
const fieldClass = "w-full min-w-0 rounded-lg border border-studio-line bg-black/20 px-2.5 py-2 text-sm text-studio-text outline-none focus:border-sky-300/50 disabled:opacity-50";
const buttonClass = "min-h-9 rounded-lg border border-studio-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const compactButtonClass = "inline-flex h-8 flex-none items-center justify-center gap-1.5 rounded-lg border border-studio-line px-2 text-xs font-semibold transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";

function validCatalog(value: unknown): value is VoiceProviderCatalog {
  if (!value || typeof value !== "object" || !("providers" in value) || !Array.isArray(value.providers)) return false;
  return value.providers.every((provider) => provider && typeof provider === "object"
    && ["gpt-sovits", "voxcpm2"].includes(provider.id) && Array.isArray(provider.references)
    && provider.references.every((reference: ImportedVoiceReference) => reference && typeof reference.id === "string"
      && typeof reference.label === "string" && Array.isArray(reference.referenceModes)
      && reference.referenceModes.length > 0 && reference.referenceModes.every((mode) => ["reference_only", "with_reference_text"].includes(mode))));
}

function validImport(value: unknown): value is VoiceReferenceImportResult {
  if (!value || typeof value !== "object" || !("catalog" in value) || !("reference" in value) || !validCatalog(value.catalog)) return false;
  const reference = value.reference as ImportedVoiceReference | undefined;
  return Boolean(reference && typeof reference.id === "string" && typeof reference.label === "string"
    && Array.isArray(reference.referenceModes) && reference.referenceModes.length > 0
    && reference.referenceModes.every((mode) => ["reference_only", "with_reference_text"].includes(mode))
    && value.catalog.providers
    .find((provider) => provider.id === "voxcpm2")?.references.some((item) => item.id === reference.id));
}

function timeLabel(seconds: number) { return Number(seconds.toFixed(2)).toString(); }

export function VoiceReferenceImport({ disabled, onImported, onCatalogRefresh, onBusyChange, onPreviewPlay, toolbarContent, compactToolbar = false }: VoiceReferenceImportProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [sourceDuration, setSourceDuration] = useState<number>();
  const [name, setName] = useState("");
  const [promptText, setPromptText] = useState("");
  const [language, setLanguage] = useState<ReferenceLanguage>("zh");
  const [transcribed, setTranscribed] = useState(false);
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("8");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrl = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const request = useRef<{ kind: PendingAction; controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const callbacks = useRef({ onImported, onCatalogRefresh, onBusyChange, onPreviewPlay });
  const segmentPlaying = useRef(false);
  const durationEdited = useRef(false);
  const transcriptionRevision = useRef(0);

  useEffect(() => { callbacks.current = { onImported, onCatalogRefresh, onBusyChange, onPreviewPlay }; }, [onImported, onCatalogRefresh, onBusyChange, onPreviewPlay]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (request.current) {
        request.current.controller.abort(); clearTimeout(request.current.timer); request.current = null;
        callbacks.current.onBusyChange(false);
      }
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    return () => { if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); } };
  }, [sourceUrl]);

  const startSeconds = Number(start);
  const durationSeconds = Number(duration);
  const endSeconds = startSeconds + durationSeconds;
  const intervalValid = start.trim() !== "" && duration.trim() !== "" && Number.isFinite(startSeconds)
    && Number.isFinite(durationSeconds) && startSeconds >= 0 && durationSeconds >= 1 && durationSeconds <= 30
    && (sourceDuration === undefined || endSeconds <= sourceDuration + 0.01);
  const locked = disabled || pending !== null;
  const fieldsLocked = disabled || (pending !== null && pending !== "transcribe");

  function invalidateTranscription(message = "") {
    transcriptionRevision.current += 1;
    setTranscribed(false); setError(""); setNotice(message);
    const active = request.current;
    if (active?.kind === "transcribe") {
      active.controller.abort(); clearTimeout(active.timer); request.current = null;
      setPending(null); callbacks.current.onBusyChange(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    if (fieldsLocked) return;
    const selected = event.target.files?.[0] ?? null;
    if (selected && (!/\.(mp3|wav)$/i.test(selected.name) || selected.size === 0 || selected.size > MAX_FILE_BYTES)) {
      setError(selected.size > MAX_FILE_BYTES ? "文件超过 32 MB，请先剪短录音。" : "请选择有效的 MP3 或 WAV 音频文件。");
      event.target.value = "";
      return;
    }
    invalidateTranscription();
    audioRef.current?.pause(); segmentPlaying.current = false;
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = selected ? URL.createObjectURL(selected) : undefined;
    setFile(selected); setSourceUrl(blobUrl.current); setSourceDuration(undefined);
    setName(selected?.name.replace(/\.(mp3|wav)$/i, "") ?? "");
    durationEdited.current = false;
    setStart("0"); setDuration("8"); setPromptText(""); setError(""); setNotice("");
  }

  function begin(kind: PendingAction) {
    if (disabled || request.current || callbacks.current.onBusyChange(true) === false) return null;
    const controller = new AbortController();
    const active = { kind, controller, timer: setTimeout(() => {
      if (!mounted.current || request.current !== active) return;
      controller.abort(); request.current = null;
      setPending(null); callbacks.current.onBusyChange(false);
      setError(kind === "import" ? "添加等待超时。请刷新参考列表确认是否已保存，再决定是否重试。"
        : kind === "transcribe" ? "文字识别超时，原话未改动。请重试或手动填写。" : "读取参考列表超时，请重试。");
    }, kind === "import" ? IMPORT_TIMEOUT_MS : kind === "transcribe" ? TRANSCRIBE_TIMEOUT_MS : 15_000) };
    request.current = active; setPending(kind); setError(""); setNotice("");
    return active;
  }

  function finish(active: NonNullable<typeof request.current>) {
    clearTimeout(active.timer);
    if (!mounted.current || request.current !== active || active.controller.signal.aborted) return false;
    request.current = null; setPending(null); callbacks.current.onBusyChange(false);
    return true;
  }

  async function submit() {
    if (!file || !name.trim() || !intervalValid) return;
    const active = begin("import");
    if (!active) return;
    audioRef.current?.pause(); segmentPlaying.current = false;
    const body = new FormData();
    body.set("file", file); body.set("name", name.trim()); body.set("promptText", promptText.trim());
    body.set("startSeconds", String(startSeconds)); body.set("durationSeconds", String(durationSeconds));
    try {
      const response = await fetch("/api/voice-references", { method: "POST", body, signal: active.controller.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "参考音频添加失败，请重试。");
      if (!validImport(value)) throw new Error("返回的参考列表不完整。请刷新参考列表确认是否已保存。");
      if (!finish(active)) return;
      callbacks.current.onImported(value); setNotice(`已添加并选中“${value.reference.label}”。`); setOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = undefined; setFile(null); setSourceUrl(undefined); setSourceDuration(undefined);
      setTranscribed(false);
    } catch (cause) {
      if (finish(active)) setError(cause instanceof Error ? cause.message : "参考音频添加失败，请重试。");
    }
  }

  async function refreshCatalog() {
    const active = begin("refresh");
    if (!active) return;
    try {
      const response = await fetch("/api/generation/clip", { signal: active.controller.signal, cache: "no-store" });
      const catalog = await response.json();
      if (!response.ok || !validCatalog(catalog)) throw new Error("参考列表读取失败，请重试。");
      if (finish(active)) { callbacks.current.onCatalogRefresh(catalog); setNotice("参考列表已刷新，可在上方选择已保存的声音。"); }
    } catch (cause) {
      if (finish(active)) setError(cause instanceof Error ? cause.message : "参考列表读取失败，请重试。");
    }
  }

  async function transcribe() {
    if (!file || !intervalValid) return;
    const active = begin("transcribe");
    if (!active) return;
    const revision = transcriptionRevision.current;
    const selectedLanguage = language;
    const selectedStart = startSeconds;
    const selectedDuration = durationSeconds;
    audioRef.current?.pause(); segmentPlaying.current = false;
    const body = new FormData();
    body.set("file", file); body.set("language", selectedLanguage);
    body.set("startSeconds", String(selectedStart)); body.set("durationSeconds", String(selectedDuration));
    try {
      const response = await fetch("/api/voice-references/transcribe", { method: "POST", body, signal: active.controller.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "文字识别失败，请重试或手动填写原话。");
      if (!value || typeof value.transcript !== "string" || !value.transcript.trim() || value.transcript.length > 2000
        || value.language !== selectedLanguage || !Number.isFinite(value.startSeconds) || !Number.isFinite(value.durationSeconds)
        || Math.abs(value.startSeconds - selectedStart) > 0.01 || Math.abs(value.durationSeconds - selectedDuration) > 0.01) {
        throw new Error("识别结果不完整，请重试或手动填写原话。");
      }
      if (!finish(active) || revision !== transcriptionRevision.current) return;
      setPromptText(value.transcript.trim()); setTranscribed(true);
      setNotice("已识别所选片段，请试听并校对，识别可能有误。可手动修改原话，确认后再保存参考音频。");
    } catch (cause) {
      if (finish(active)) setError(cause instanceof Error ? cause.message : "文字识别失败，请重试或手动填写原话。");
    }
  }

  function cancel() {
    const active = request.current;
    if (!active) return;
    active.controller.abort(); clearTimeout(active.timer); request.current = null;
    setPending(null); callbacks.current.onBusyChange(false);
    setNotice(active.kind === "import" ? "已取消等待。若录音刚好已保存，可刷新参考列表查看。"
      : active.kind === "transcribe" ? "已取消文字识别，原话未改动。" : "已取消读取参考列表。");
  }

  return <div className="min-w-0 space-y-2">
    <div aria-label="参考声音工具栏" className={`flex min-w-0 items-center gap-2 ${compactToolbar ? "flex-nowrap" : "flex-wrap"}`}>
      {toolbarContent}
      <div className={`flex flex-none items-center gap-1.5 ${compactToolbar ? "ml-auto" : ""}`}>
        <button type="button" aria-label="添加参考音频" title="添加参考音频" className={`${compactToolbar ? compactButtonClass : buttonClass} text-sky-100`} aria-expanded={open} aria-controls="voice-reference-import-form" disabled={locked} onClick={() => { audioRef.current?.pause(); segmentPlaying.current = false; setOpen(!open); }}>{compactToolbar ? <><Plus aria-hidden="true" size={14} /><span className="hidden @[35rem]/reference:inline">添加</span></> : "添加参考音频"}</button>
        <button type="button" aria-label="刷新参考列表" title="刷新参考列表" className={`${compactToolbar ? compactButtonClass : buttonClass} text-studio-muted`} disabled={locked} onClick={() => void refreshCatalog()}>{compactToolbar ? <RefreshCw aria-hidden="true" size={14} /> : "刷新参考列表"}</button>
      </div>
    </div>
    {open ? <div id="voice-reference-import-form" aria-label="添加参考音频表单" className="min-w-0 space-y-3 rounded-lg border border-studio-line bg-black/10 p-3">
      <label className="block space-y-1.5 text-xs text-studio-muted"><span>音频文件</span><input ref={fileInputRef} aria-label="参考音频文件" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={fieldsLocked} onChange={chooseFile} className="block w-full min-w-0 text-xs file:mr-2 file:rounded-md file:border file:border-studio-line file:bg-black/20 file:px-2 file:py-2 file:text-studio-text" /></label>
      <p className="break-words text-xs leading-5 text-studio-muted">选择 MP3 或 WAV，最多 32 MB，允许选取 1–30 秒。建议先选 3–8 秒干净、单人说话的片段；较长参考更占用内存。</p>
      <label className="block space-y-1.5 text-xs text-studio-muted"><span>声音名称</span><input aria-label="参考声音名称" className={fieldClass} maxLength={100} value={name} disabled={locked} onChange={(event) => setName(event.target.value)} /></label>
      {sourceUrl ? <div className="min-w-0 space-y-2">
        <p className="text-xs text-studio-muted">原录音试听{sourceDuration !== undefined ? ` · ${timeLabel(sourceDuration)} 秒` : ""}</p>
        <AudioPlayer key={sourceUrl} ref={audioRef} label="待添加的原录音试听" preload="metadata" src={sourceUrl} statusDisplay="none" className="w-full min-w-0 max-w-full"
          onLoadedMetadata={(event) => {
            const length = event.currentTarget.duration;
            if (Number.isFinite(length) && length > 0) {
              setSourceDuration(length);
              if (durationEdited.current && endSeconds > length + 0.01) invalidateTranscription("片段已改变，请重新识别或校对原话。");
              if (!durationEdited.current) {
                const nextDuration = String(Math.min(8, length));
                if (nextDuration !== duration) { invalidateTranscription("片段已改变，请重新识别或校对原话。"); setDuration(nextDuration); }
              }
            }
          }} onPlay={(event) => callbacks.current.onPreviewPlay?.(event.currentTarget)}
          onTimeUpdate={(event) => { if (segmentPlaying.current && event.currentTarget.currentTime >= endSeconds) { event.currentTarget.pause(); segmentPlaying.current = false; } }}
          onError={() => setError("浏览器无法试听这个文件。可更换文件，或由添加时检查音频。")}
        />
        <button type="button" className={`${buttonClass} text-studio-muted`} disabled={fieldsLocked} onClick={() => { invalidateTranscription("片段已改变，请重新识别或校对原话。"); setStart(String(Number((audioRef.current?.currentTime ?? 0).toFixed(2)))); segmentPlaying.current = false; }}>从当前播放位置开始</button>
      </div> : null}
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted"><span>开始时间（秒）</span><input aria-label="参考片段开始时间" type="number" min="0" step="0.1" value={start} disabled={fieldsLocked} className={fieldClass} onChange={(event) => { invalidateTranscription("片段已改变，请重新识别或校对原话。"); segmentPlaying.current = false; setStart(event.target.value); }} /></label>
        <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted"><span>片段长度（秒）</span><input aria-label="参考片段长度" type="number" min="1" max="30" step="0.1" value={duration} disabled={fieldsLocked} className={fieldClass} onChange={(event) => { invalidateTranscription("片段已改变，请重新识别或校对原话。"); durationEdited.current = true; segmentPlaying.current = false; setDuration(event.target.value); }} /></label>
      </div>
      {file ? <p className={`break-words text-xs leading-5 ${intervalValid ? "text-studio-muted" : "text-amber-100"}`}>{intervalValid ? `将使用 ${timeLabel(startSeconds)}–${timeLabel(endSeconds)} 秒，共 ${timeLabel(durationSeconds)} 秒。` : "请选择录音内的 1–30 秒片段，开始时间不能小于 0。"}</p> : null}
      {sourceUrl ? <button type="button" className={`${buttonClass} text-studio-muted`} disabled={locked || !intervalValid} onClick={() => {
        const audio = audioRef.current; if (!audio) return;
        audio.currentTime = startSeconds; segmentPlaying.current = true;
        void audio.play().catch(() => { if (mounted.current && audioRef.current === audio) { segmentPlaying.current = false; setError("片段暂时无法试听，请使用上方播放控件重试。"); } });
      }}>试听所选片段</button> : null}
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 space-y-1.5 text-xs text-studio-muted"><span>录音语言</span><select aria-label="参考音频语言" value={language} disabled={fieldsLocked} className={fieldClass} onChange={(event) => { invalidateTranscription("录音语言已改变，请重新识别或校对原话。"); setLanguage(event.target.value as ReferenceLanguage); }}>
          <option value="zh">中文</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option>
        </select></label>
        <button type="button" className={`${buttonClass} text-sky-100`} disabled={locked || !file || !intervalValid} onClick={() => void transcribe()}>识别所选片段文字</button>
      </div>
      <p className="break-words text-xs leading-5 text-studio-muted">先选择录音语言，再识别所选片段；核对结果后可直接修改下方原话，也可以手动填写。</p>
      {transcribed ? <p className="text-xs leading-5 text-sky-100">自动识别结果已填入下方，请核对。</p> : null}
      <label className="block space-y-1.5 text-xs text-studio-muted"><span>片段中的原话（可选，可识别后修改）</span><textarea aria-label="参考片段原话" value={promptText} maxLength={2000} disabled={fieldsLocked} onChange={(event) => { invalidateTranscription(); setPromptText(event.target.value); }} rows={3} className={fieldClass} placeholder="识别后核对，或准确填写所选片段的原话。" /></label>
      <p className="break-words text-xs leading-5 text-studio-muted">原话留空时只参考声音；填写并核对后，可使用“参考音频＋文本”。这是参考使用模式，与“生成方式”中的当前范围或长文连续生成分别选择。</p>
      <button type="button" className={`${buttonClass} border-sky-300/30 bg-sky-300/10 text-sky-100`} disabled={locked || !file || !name.trim() || !intervalValid} onClick={() => void submit()}>保存并选用参考音频</button>
    </div> : null}
    {pending ? <div className="flex flex-wrap items-center gap-2"><p role="status" className="text-xs text-studio-muted">{pending === "import" ? "正在添加参考音频…" : pending === "transcribe" ? "正在识别所选片段文字…" : "正在刷新参考列表…"}</p><button type="button" className={`${buttonClass} text-studio-muted`} onClick={cancel}>取消等待</button></div> : null}
    {error ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{error}</p> : null}
    {notice ? <p role="status" className="break-words text-xs leading-5 text-studio-muted">{notice}</p> : null}
  </div>;
}
