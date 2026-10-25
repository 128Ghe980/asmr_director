"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { getAudioCandidateWorkspaceMode, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { resolvePlayableAssetUri, resolveClipPlaybackUri } from "@/lib/asmr/playback-asset-resolver";
import type { SpeechWorkspaceMode, TimelineClip } from "@/lib/asmr/schema";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
import type { VoiceGenerationContext } from "@/lib/asmr/voice-generation-context";
import type { VoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";
import { isVoiceParagraphManuallyConfirmed, type VoiceParagraphResult } from "@/lib/asmr/voice-paragraph-result";
import { isCuttingOnlyRecognition } from "@/lib/asmr/voice-recognition";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { VoiceGenerationRecordingsSchema, type VoiceGenerationRecording } from "@/lib/asmr/voice-generation-recording";
import { VoiceParagraphRecognitionComparison, VoiceRecognitionComparison, VoiceRecordingRecognitionComparison } from "./voice-recognition-comparison";
import { getVoiceReviewWarningForDisplay } from "@/lib/asmr/voice-review-warning";
import { VoiceReferenceImport, type VoiceReferenceImportResult } from "./voice-reference-import";
import { AudioPlayer } from "./audio-player";

export type VoiceGenerationPanelProps = {
  projectId?: string;
  workspaceMode?: SpeechWorkspaceMode;
  voiceContext?: VoiceGenerationContext;
  paragraphContext?: VoiceParagraphContext;
  binaural?: boolean;
  options: VoiceGenerationOptions;
  onOptionsChange: (options: VoiceGenerationOptions) => void;
  catalog: VoiceProviderCatalog | null;
  catalogError?: string;
  busy: boolean;
  candidates: AudioCandidate[];
  selectedClip: TimelineClip;
  onAdopt: (candidate: AudioCandidate) => void;
  onDiscard: (candidate: AudioCandidate) => void;
  onRecheck?: (candidate: AudioCandidate) => void;
  recheckingCandidateId?: string;
  onCancelRecheck?: () => void;
  onForceSplit?: (candidate: AudioCandidate) => void;
  forceSplittingCandidateId?: string;
  onCancelForceSplit?: () => void;
  onConfirmText?: (candidate: AudioCandidate, confirmedClipIds: string[]) => void;
  confirmingCandidateId?: string;
  onCancelConfirmation?: () => void;
  onRegenerateGroup?: (candidate: AudioCandidate, groupIndex: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  hasUndo: boolean;
  error?: string;
  loading?: boolean;
  generationControl?: ReactNode;
  referenceImportBusy?: boolean;
  onReferenceImportBusyChange?: (busy: boolean) => boolean | void;
  onReferenceImported?: (result: VoiceReferenceImportResult) => void;
  onReferenceCatalogRefresh?: (catalog: VoiceProviderCatalog) => void;
};

type Reference = VoiceProviderCatalog["providers"][number]["references"][number];

const fieldClass = "w-full min-w-0 rounded-lg border border-studio-line bg-black/20 px-2.5 py-2 text-sm text-studio-text outline-none focus:border-sky-300/50 disabled:opacity-50";
const buttonClass = "min-h-9 rounded-lg border border-studio-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const referenceModeLabels = {
  reference_only: "仅参考音频",
  with_reference_text: "参考音频＋文本",
} as const;
const generationModeLabels = {
  clip: "当前范围",
  long_text: "长文连续生成",
  paragraph: "整段生成后切分",
} as const;

function preferredMode(reference: Reference): VoiceGenerationOptions["referenceMode"] {
  return reference.referenceModes.includes("with_reference_text")
    ? "with_reference_text"
    : "reference_only";
}

function isCuttingOnlyParagraph(paragraph?: VoiceParagraphResult): boolean {
  return Boolean(paragraph && (isCuttingOnlyRecognition(paragraph.failureRecognition)
    || paragraph.segments.some((segment) => isCuttingOnlyRecognition(segment.recognition))));
}

function VoicePreview({ src, label, compact = false }: {
  src: string;
  label: string;
  compact?: boolean;
}) {
  return <AudioPlayer src={src} label={label} compact={compact}
    waitingLabel="正在准备试听…"
    errorLabel="试听暂不可用，请重试。" />;
}

function OriginalVoiceRecordings({ projectId, clipId, text, workspaceMode, busy }: {
  projectId: string; clipId: string; text: string; busy: boolean;
  workspaceMode: SpeechWorkspaceMode;
}) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const openedForGeneration = useRef(false);
  const [recordings, setRecordings] = useState<VoiceGenerationRecording[]>([]);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loadedOlder = useRef(false);
  const paginationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { paginationRequest.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const query = new URLSearchParams({ projectId, clipId, text, workspaceMode });
        const response = await fetch(`/api/voice-generation-recordings?${query}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("read failed");
        const value = VoiceGenerationRecordingsSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          const ids = new Set(value.recordings.map((recording) => recording.recordingId));
          setRecordings((previous) => [...value.recordings, ...previous.filter((recording) => !ids.has(recording.recordingId))]);
          if (!loadedOlder.current) setNextCursor(value.nextCursor);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("原始录音列表暂时无法更新，可重试读取。已显示的录音仍可试听和下载。");
      } finally {
        if (busy && !controller.signal.aborted) timer = setTimeout(() => { void load(); }, 2000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, clipId, text, workspaceMode, busy, refresh]);

  useEffect(() => {
    if (!busy) openedForGeneration.current = false;
    if (busy && recordings.length > 0 && !openedForGeneration.current) {
      if (disclosureRef.current) disclosureRef.current.open = true;
      openedForGeneration.current = true;
    }
  }, [busy, recordings.length]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const controller = new AbortController();
    paginationRequest.current?.abort();
    paginationRequest.current = controller;
    loadedOlder.current = true;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ projectId, clipId, text, workspaceMode, cursor: nextCursor });
      const response = await fetch(`/api/voice-generation-recordings?${query}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("read failed");
      const value = VoiceGenerationRecordingsSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        setRecordings((previous) => {
          const ids = new Set(previous.map((recording) => recording.recordingId));
          return [...previous, ...value.recordings.filter((recording) => !ids.has(recording.recordingId))];
        });
        setNextCursor(value.nextCursor);
        setError("");
      }
    } catch {
      if (!controller.signal.aborted) setError("较早录音暂时无法读取，请再次加载。已显示的录音仍可试听和下载。");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  return <section aria-label="完整原始录音" className="min-w-0 rounded-lg border border-studio-line p-3">
    <details ref={disclosureRef}>
      <summary className="cursor-pointer text-xs font-semibold text-studio-text">
        完整原始录音{recordings.length > 0 ? ` · ${recordings.length} 条可试听` : ""}
      </summary>
      <div className="mt-3 min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-studio-muted">试听与下载</p>
          <button type="button" className={`${buttonClass} text-studio-muted`} onClick={() => setRefresh((value) => value + 1)}>刷新录音</button>
        </div>
        <p className="break-words text-xs leading-5 text-studio-muted">{workspaceMode === "paragraph" ? "保留整段连续原音，可试听或下载。切分完成后，请试听并自行决定是否采用。" : "完整原音保留，可随时试听或下载；长文录音可能包含补充台词。"}</p>
        {error ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{error}</p> : null}
        {!recordings.length ? <p className="text-xs leading-5 text-studio-muted">{nextCursor ? "本页尚未找到这段台词的录音，可加载更多继续查看。" : busy ? "第一条录音完成后会自动显示在这里。" : "这段台词暂无原始录音。"}</p> : null}
        <div className="min-w-0 space-y-3">
          {recordings.map((recording, index) => <article key={recording.recordingId} aria-label={`完整原音 ${index + 1}`} className="min-w-0 space-y-2 border-t border-studio-line pt-3">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-studio-text">第 {recording.group} 组 · 第 {recording.take} 次</span>
              {recording.duration !== null ? <span className="text-studio-muted">{recording.duration.toFixed(1)} 秒</span> : null}
              {recording.historicalMatch ? <span className="text-studio-muted">历史同文案</span> : null}
            </div>
            <p className="break-words text-xs leading-5 text-studio-muted">{recording.expectedText}</p>
            <VoicePreview src={recording.audioUrl} label={`完整原音 ${index + 1} 试听`} />
            <p className={`break-words text-xs leading-5 ${recording.status === "needs_review" ? "text-amber-100" : "text-studio-muted"}`}>{recording.warning}</p>
            <div className="flex flex-wrap items-center gap-2">
              <a className={`${buttonClass} inline-flex items-center text-studio-text`} href={`${recording.audioUrl}?download=1`} download>下载完整原音</a>
              <span className="text-xs text-studio-muted">{new Date(recording.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            {recording.paragraphRecognition ? <VoiceParagraphRecognitionComparison paragraph={recording.paragraphRecognition}
              expectedText={recording.expectedText} originalRecording />
              : <VoiceRecordingRecognitionComparison recognition={recording.recognition} expectedText={recording.expectedText} review={recording.status === "needs_review"} />}
            <details className="text-xs leading-5 text-studio-muted">
              <summary className="cursor-pointer">查看本次模型朗读文案</summary>
              <p className="mt-1 break-words">{recording.inputText}</p>
            </details>
          </article>)}
        </div>
        {nextCursor ? <button type="button" className={`${buttonClass} text-studio-muted`} disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "正在读取更多录音…" : "加载更多录音"}</button> : null}
      </div>
    </details>
  </section>;
}

function CandidateDetails({ candidate, candidateNumber, referenceLabel, regenerationDisabled, onRegenerateGroup }: {
  candidate: AudioCandidate;
  candidateNumber: number;
  referenceLabel?: string;
  regenerationDisabled: boolean;
  onRegenerateGroup?: VoiceGenerationPanelProps["onRegenerateGroup"];
}) {
  const provenance = candidate.provenance;
  const forced = Boolean(provenance.forcedSegmentation);
  const cuttingOnlyParagraph = isCuttingOnlyParagraph(provenance.paragraph);
  const rows: [string, string][] = [
    ["模型", provenance.model],
    ["参考", referenceLabel || provenance.voicePackId],
    ["模式", referenceModeLabels[provenance.referenceMode]],
    ["生成方式", generationModeLabels[provenance.generationMode]],
    ["随机种子", String(provenance.seed)],
    ["音频", `${candidate.wav.sampleRate / 1000} kHz · ${candidate.wav.channels === 1 ? "单声道" : "双声道"} · ${candidate.wav.bitsPerSample} bit`],
    ...Object.entries(provenance.parameters).map(([key, value]): [string, string] => [key, String(value)]),
  ];
  if (provenance.longText) {
    const { groups, joins, analysisProvider, analysisModel } = provenance.longText;
    const providerLabel = analysisProvider === "local" ? "本地" : analysisProvider === "api" ? "外部 API" : analysisProvider;
    rows.push(["文本分析", providerLabel], ["内部生成组", `${groups.length} 组`]);
    if (analysisModel) rows.push(["分析模型", analysisModel]);
    if (joins.length > 0) rows.push(["内部拼接停顿", `${joins.map((join) => Number(join.actualDurationMs.toFixed(1))).join(" / ")} ms`]);
  }
  if (provenance.paragraph) {
    rows.push(["生成范围", "整段原文一次生成"], ["短句切分", provenance.paragraph.checkStatus !== "review"
      ? `${provenance.paragraph.segments.length} 句 · ${forced ? "已强制切分，待试听" : "切分完成，待试听"}` : cuttingOnlyParagraph ? "切点未确定，完整原音已保留" : "未保存切片，完整原音已保留"], ["原音保留", "整段原声，音量与速度保持"]);
  }
  if (provenance.runtimeVersion) rows.push(["运行版本", provenance.runtimeVersion]);
  if (provenance.modelIdentity) rows.push(["模型版本", provenance.modelIdentity]);
  if (provenance.referenceIdentity) rows.push(["参考版本", provenance.referenceIdentity]);

  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">生成详情</summary>
    <dl className="mt-2 space-y-1.5">
      {rows.map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <dt className="break-words">{label}</dt><dd className="min-w-0 break-all">{value}</dd>
      </div>)}
    </dl>
    {provenance.paragraph && provenance.forcedSegmentation?.alignments.some((alignment) => alignment.previousRecognition) ? <div aria-label="强制切分前识别记录" className="mt-3 space-y-2 border-t border-studio-line pt-3">
      <p className="leading-5">以下是强制切分前保存的识别记录，仅供历史对照。</p>
      {provenance.forcedSegmentation.alignments.map((alignment) => alignment.previousRecognition ? <VoiceParagraphRecognitionComparison
        key={alignment.groupIndex} paragraph={{ checkStatus: "review", clipIds: provenance.paragraph!.clipIds, segments: [],
          failedClipId: alignment.failedClipId ?? provenance.paragraph!.clipIds[0], failureRecognition: alignment.previousRecognition }}
        expectedText={provenance.paragraph!.text} originalRecording /> : null)}
    </div> : null}
    {provenance.generationMode === "long_text" && provenance.longText ? <ol className="mt-3 min-w-0 space-y-3 border-t border-studio-line pt-3">
      {provenance.longText.groups.map((group) => {
        const groupNumber = group.index + 1;
        const audio = resolvePlayableAssetUri(group.asset.uri);
        return <li key={group.index} className="min-w-0 space-y-2">
          <p className="font-semibold text-studio-text">内部生成组 {groupNumber}</p>
          {isCuttingOnlyRecognition(group.recognition) ? <p className={`break-words leading-5 ${group.checkStatus === "review" ? "text-amber-100" : "text-studio-muted"}`}>{group.checkStatus === "review" ? "切点未确定，完整原音已保留。" : group.checkStatus === "passed" ? "切分完成，待试听。" : "已保存原音与定位参考，请试听。"}</p>
            : group.checkStatus === "review" ? <p className="break-words leading-5 text-amber-100">完整原音 · 待试听确认</p> : null}
          <p title={group.text} className="truncate leading-5">{group.text}</p>
          {audio ? <details className="min-w-0">
            <summary className="cursor-pointer py-1">试听本组</summary>
            <AudioPlayer label={`候选 ${candidateNumber} 第 ${groupNumber} 组试听`} preload="none" src={audio} className="mt-1 w-full min-w-0 max-w-full" />
          </details> : null}
          {onRegenerateGroup ? <button type="button" aria-label={`重生成候选 ${candidateNumber} 第 ${groupNumber} 组`} className={`${buttonClass} text-studio-muted`} disabled={regenerationDisabled} onClick={() => onRegenerateGroup(candidate, group.index)}>重生成内部组</button> : null}
        </li>;
      })}
    </ol> : null}
    {provenance.paragraph ? <div className="mt-3 min-w-0 space-y-3 border-t border-studio-line pt-3">
      <p className="break-words leading-5 text-studio-text">{provenance.paragraph.text}</p>
      <p className="leading-5">{provenance.paragraph.checkStatus !== "review"
        ? `${forced ? "已强制切分，待试听" : "切分完成，待试听"}。内容是否符合台词由您试听判断；采用时更新本工作区的整段短句。`
        : cuttingOnlyParagraph ? "切点未确定，完整原音已保留，可试听或下载。" : "未保存完整切片，原音已保留，可试听或下载。"}</p>
      {resolvePlayableAssetUri(provenance.paragraph.sourceAsset.uri) ? <div className="space-y-2">
        <p className="text-studio-text">整段完整原音 · {provenance.paragraph.sourceAsset.duration.toFixed(1)} 秒</p>
        <VoicePreview src={resolvePlayableAssetUri(provenance.paragraph.sourceAsset.uri)!} label={`候选 ${candidateNumber} 整段完整原音试听`} />
        <a className={`${buttonClass} inline-flex items-center`} href={`${resolvePlayableAssetUri(provenance.paragraph.sourceAsset.uri)}?download=1`} download>下载整段原音</a>
      </div> : null}
      {provenance.paragraph.segments.length ? <ol aria-label="整段短句切分" className="min-w-0 space-y-3">
        {provenance.paragraph.segments.map((segment, index) => <li key={segment.clipId} className="space-y-1 border-t border-studio-line pt-2">
          <p className="text-studio-text">短句 {index + 1} · {segment.cutStartSeconds.toFixed(2)}–{segment.cutEndSeconds.toFixed(2)} 秒</p>
          <p className="break-words leading-5">{segment.text}</p>
          {resolvePlayableAssetUri(segment.asset.uri) ? <VoicePreview src={resolvePlayableAssetUri(segment.asset.uri)!} label={`候选 ${candidateNumber} 短句 ${index + 1} 原声试听`} /> : null}
        </li>)}
      </ol> : null}
    </div> : null}
  </details>;
}

export function VoiceGenerationPanel({
  projectId,
  workspaceMode = "short",
  voiceContext,
  paragraphContext,
  options, onOptionsChange, catalog, catalogError, busy, candidates, selectedClip,
  onAdopt, onDiscard, onUndo, canUndo, hasUndo, error, loading = false,
  generationControl, onRegenerateGroup, onForceSplit, forceSplittingCandidateId, onCancelForceSplit,
  binaural = false,
  referenceImportBusy = false, onReferenceImportBusyChange, onReferenceImported, onReferenceCatalogRefresh,
}: VoiceGenerationPanelProps) {
  if (selectedClip.type !== "voice" || selectedClip.kind === "silent") return null;

  const providers = catalog?.providers ?? [];
  const provider = providers.find((item) => item.id === options.provider);
  const reference = provider?.references.find((item) => item.id === options.voicePackId);
  const isVox = options.provider === "voxcpm2";
  const isParagraph = workspaceMode === "paragraph";
  const isLongText = !isParagraph && isVox && options.generationMode === "long_text";
  const longTextAvailable = provider?.longText?.available === true;
  const apiConfigured = provider?.longText?.apiConfigured === true;
  const analysisProvider = options.analysisProvider ?? "local";
  const settingsDisabled = busy || loading || referenceImportBusy || catalog === null;
  const actionsDisabled = busy || loading || referenceImportBusy;
  const sourceFingerprint = getVoiceCandidateSourceFingerprint(selectedClip);
  const windowedSourceFingerprint = getVoiceCandidateSourceFingerprint(selectedClip, voiceContext);
  const paragraphSourceFingerprint = paragraphContext ? getVoiceCandidateSourceFingerprint(selectedClip, undefined, paragraphContext) : undefined;
  const currentAudio = resolveClipPlaybackUri(selectedClip, binaural);
  const visibleCandidates = candidates.filter((candidate) => candidate.clipId === selectedClip.id && candidate.status === "ready"
    && getAudioCandidateWorkspaceMode(candidate) === workspaceMode);

  function changeProvider(id: string) {
    const next = providers.find((item) => item.id === id);
    if (settingsDisabled || !next?.available || (isParagraph && next.id !== "voxcpm2")) return;
    const nextReference = next.references.find((item) => item.id === next.defaultReferenceId) ?? next.references[0];
    if (!nextReference) return;
    onOptionsChange({
      provider: next.id, voicePackId: nextReference.id,
      referenceMode: preferredMode(nextReference),
      generationMode: isParagraph ? "paragraph" : next.id === "voxcpm2" ? selectedClip.type === "voice" && selectedClip.semantic_unit ? "long_text"
        : options.generationMode === "paragraph" ? "clip" : options.generationMode : "clip",
      ...(next.id === "voxcpm2" && options.analysisProvider ? { analysisProvider: options.analysisProvider } : {}),
    });
  }

  function changeReference(id: string) {
    const next = provider?.references.find((item) => item.id === id);
    if (settingsDisabled || !provider?.available || !next) return;
    onOptionsChange({ ...options, voicePackId: next.id, referenceMode: preferredMode(next), ...(isParagraph ? { generationMode: "paragraph" } : {}) });
  }

  function changeGenerationMode(mode: string) {
    if (settingsDisabled || !provider?.available || !isVox || isParagraph) return;
    if (mode === "clip") onOptionsChange({ ...options, generationMode: "clip" });
    if (mode === "long_text" && longTextAvailable) {
      onOptionsChange({ ...options, generationMode: "long_text", analysisProvider });
    }
  }

  function changeAnalysisProvider(next: string) {
    if (settingsDisabled || !provider?.available || !isLongText || !longTextAvailable) return;
    if (next === "local" || (next === "api" && apiConfigured)) {
      onOptionsChange({ ...options, analysisProvider: next });
    }
  }

  const referenceControls = <>
    <label className="flex min-w-0 items-center gap-2 text-xs text-studio-muted">
      <span className="flex-none">参考声音</span>
      <select aria-label="参考声音" className="h-8 w-36 min-w-0 max-w-full rounded-lg border border-studio-line bg-black/20 px-2 py-1 text-xs text-studio-text outline-none focus:border-sky-300/50 disabled:opacity-50" value={options.voicePackId} disabled={settingsDisabled || !provider?.available} onChange={(event) => changeReference(event.target.value)}>
        {!reference ? <option value={options.voicePackId} disabled>参考不可用</option> : null}
        {provider?.references.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    {reference?.audioUrl ? <div className="order-3 min-w-0 max-w-full @[35rem]/reference:order-none" title={`参考片段${reference.durationSeconds !== undefined ? ` · ${reference.durationSeconds.toFixed(1)} 秒` : ""}`}>
      <p className="sr-only">参考片段{reference.durationSeconds !== undefined ? ` · ${reference.durationSeconds.toFixed(1)} 秒` : ""}</p>
      <VoicePreview key={reference.audioUrl} src={reference.audioUrl} label="参考声音试听" compact />
    </div> : null}
  </>;

  return <section aria-label="人声生成设置" className="@container/reference min-w-0 space-y-3">
    {isVox && onReferenceImported && onReferenceCatalogRefresh && onReferenceImportBusyChange ? <VoiceReferenceImport
      toolbarContent={referenceControls} compactToolbar
      disabled={busy || loading || catalog === null || !provider?.available}
      onImported={onReferenceImported} onCatalogRefresh={onReferenceCatalogRefresh}
      onBusyChange={onReferenceImportBusyChange}
    /> : <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{referenceControls}</div>
      {!isVox ? <p className="break-words text-xs leading-5 text-studio-muted">添加参考音频请在“更多生成设置”中选择 VoxCPM2。</p> : null}
    </div>}

    {generationControl}

    {isParagraph && paragraphContext ? <details key={paragraphContext.groupId} aria-label="整段生成文案" className="min-w-0 rounded-lg border border-sky-300/15 bg-sky-300/[0.04] px-3 py-2.5">
      <summary className="cursor-pointer text-xs font-medium text-sky-100">生成范围（{paragraphContext.text.match(/\p{Script=Han}/gu)?.length ?? Array.from(paragraphContext.text).length} 字 / {paragraphContext.clips.length} 句）</summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-studio-text">{paragraphContext.text}</p>
    </details> : null}

    {catalogError ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{catalogError}</p>
      : provider && !provider.available ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{provider.unavailableReason || "当前引擎暂不可用。"}</p>
      : provider?.available && isVox && !isParagraph && !longTextAvailable ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{provider.longText?.reason || "长文连续生成暂不可用。"}</p>
      : isLongText && !voiceContext && analysisProvider === "api" && !apiConfigured ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">请先配置外部文本 API。</p>
      : loading ? <p role="status" className="text-xs text-studio-muted">正在读取声音…</p> : null}
    {error ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{error}</p> : null}

    {visibleCandidates.length > 0 ? <div aria-label="生成候选" className="min-w-0 space-y-3">
      {visibleCandidates.map((candidate, index) => {
        const adopted = candidate.asset.assetId === selectedClip.asset.asset_id;
        const stale = candidate.sourceFingerprint !== (candidate.provenance.generationMode === "paragraph" ? paragraphSourceFingerprint
          : candidate.provenance.generationMode === "long_text" ? windowedSourceFingerprint : sourceFingerprint);
        const paragraphReview = candidate.provenance.paragraph?.checkStatus === "review";
        const forced = Boolean(candidate.provenance.forcedSegmentation);
        const forceAvailable = !forced && (candidate.provenance.generationMode === "paragraph" ? paragraphReview
          : candidate.provenance.generationMode === "long_text" && candidate.provenance.longText?.groups.some((group) => group.checkStatus === "review"));
        const forcing = forceSplittingCandidateId === candidate.candidateId;
        const cuttingOnlyParagraph = isCuttingOnlyParagraph(candidate.provenance.paragraph);
        const manuallyConfirmed = Boolean(candidate.provenance.paragraph && isVoiceParagraphManuallyConfirmed(candidate.provenance.paragraph));
        const candidateAudio = resolveClipPlaybackUri(selectedClip, binaural, candidate.asset);
        const candidateReference = catalog?.providers.find((item) => item.id === candidate.provenance.provider)?.references.find((item) => item.id === candidate.provenance.voicePackId);
        return <article key={candidate.candidateId} aria-label={`候选 ${index + 1}`} className="min-w-0 space-y-2.5 rounded-lg border border-studio-line bg-black/10 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-studio-text">候选 {index + 1}</span>
            <span className="text-studio-muted">{candidate.asset.duration.toFixed(1)} 秒</span>
            {forced ? <span className="text-sky-100">已强制切分，待试听</span> : candidate.provenance.paragraph ? <span className={paragraphReview ? "text-amber-100" : "text-sky-100"}>{paragraphReview ? cuttingOnlyParagraph ? "切点未确定 · 完整原音" : "完整原音 · 未保存切片" : "切分完成，待试听"}</span> : null}
            {adopted ? <span className="text-studio-green">已采用</span> : null}
          </div>
          {candidateAudio ? <VoicePreview key={candidateAudio} src={candidateAudio} label={`候选 ${index + 1} 试听`} /> : null}
          {manuallyConfirmed ? <p className="text-xs leading-5 text-studio-muted">历史试听确认记录已保存。</p> : null}
          {stale && !adopted ? <p className="break-words text-xs leading-5 text-amber-100">{isParagraph ? "整段文案已修改，请重新生成。" : "文案或后续上下文已修改，请重新生成。"}</p> : null}
          {candidate.qualityWarnings.map((warning, warningIndex) => {
            const historicalTextWarning = warning === "短句音频已安全切分，部分文字待试听确认；请逐句确认后采用整段。"
              || warning === "短句音频已安全切分，但极短句识别漏了句尾语气词；请逐句试听确认后采用整段。";
            return <p key={warningIndex} role={historicalTextWarning ? "status" : "alert"} className={`break-words text-xs leading-5 ${historicalTextWarning ? "text-studio-muted" : "text-amber-100"}`}>
              {historicalTextWarning ? "历史识别文字存在字差，仅供参考；请试听并自行决定是否采用。" : getVoiceReviewWarningForDisplay(warning, candidate.provenance.longText?.groups)}
            </p>;
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label={`采用候选 ${index + 1}`} className={`${buttonClass} border-sky-300/30 bg-sky-300/10 text-sky-100`} disabled={actionsDisabled || adopted || stale || paragraphReview} onClick={() => onAdopt(candidate)}>采用</button>
            {!adopted ? <button type="button" aria-label={`放弃候选 ${index + 1}`} className={`${buttonClass} text-studio-muted`} disabled={actionsDisabled} onClick={() => onDiscard(candidate)}>放弃</button> : null}
            {onForceSplit && forceAvailable ? <button type="button" aria-label={`强制切分候选 ${index + 1}`} className={`${buttonClass} text-amber-100`}
              disabled={actionsDisabled || stale || forcing}
              title="按当前台词强制对齐并切分已保存原音，结果新增为候选；内容仍请试听判断。"
              onClick={() => onForceSplit(candidate)}>{forcing ? "强制切分中…" : "强制切分"}</button> : null}
            {forcing && onCancelForceSplit ? <button type="button" aria-label="取消强制切分" className={`${buttonClass} text-studio-muted`} onClick={onCancelForceSplit}>取消强制切分</button> : null}
          </div>
          {candidate.provenance.paragraph ? <VoiceParagraphRecognitionComparison paragraph={candidate.provenance.paragraph}
            expectedText={candidate.provenance.paragraph.text} /> : <VoiceRecognitionComparison groups={candidate.provenance.longText?.groups} />}
          <CandidateDetails candidate={candidate} candidateNumber={index + 1} referenceLabel={candidateReference?.label}
            regenerationDisabled={actionsDisabled || stale || candidate.status !== "ready" || !provider?.available || !longTextAvailable}
            onRegenerateGroup={isLongText ? onRegenerateGroup : undefined} />
        </article>;
      })}
    </div> : null}

    {hasUndo ? <div className="space-y-2">
      <button type="button" className={`${buttonClass} text-studio-muted`} disabled={actionsDisabled || !canUndo} onClick={onUndo}>撤回上次采用</button>
      {!canUndo ? <p className="break-words text-xs leading-5 text-studio-muted">片段已编辑，可从历史版本恢复。</p> : null}
    </div> : null}

    {currentAudio ? <div className="min-w-0 space-y-2">
      <p className={`text-xs ${selectedClip.audio_stale ? "text-amber-100" : "text-studio-muted"}`}>{selectedClip.audio_stale ? "当前人声 · 文案已更新" : "当前人声"}</p>
      <VoicePreview key={currentAudio} src={currentAudio} label="当前人声试听" />
    </div> : null}

    {isVox && projectId ? <OriginalVoiceRecordings key={`${projectId}:${workspaceMode}:${selectedClip.id}:${selectedClip.text}`} projectId={projectId}
      clipId={selectedClip.id} text={selectedClip.text} workspaceMode={workspaceMode} busy={busy} /> : null}

    <details className="border-t border-studio-line py-3">
      <summary className="cursor-pointer text-xs font-semibold text-studio-muted">更多生成设置</summary>
      <div className="mt-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
            <span>人声引擎</span>
            <select aria-label="人声引擎" className={fieldClass} value={options.provider} disabled={settingsDisabled} onChange={(event) => changeProvider(event.target.value)}>
              {providers.length > 0 ? providers.map((item) => <option key={item.id} value={item.id} disabled={!item.available || (isParagraph && item.id !== "voxcpm2")}>
                {item.label}{item.available ? "" : "（不可用）"}
              </option>) : <>
                <option value="gpt-sovits">GPT-SoVITS</option><option value="voxcpm2">VoxCPM2</option>
              </>}
            </select>
          </label>
          <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
            <span>参考模式</span>
            <select aria-label="参考模式" className={fieldClass} value={options.referenceMode} disabled={settingsDisabled || !provider?.available || !reference} onChange={(event) => {
              const mode = event.target.value as VoiceGenerationOptions["referenceMode"];
              if (!settingsDisabled && reference?.referenceModes.includes(mode)) onOptionsChange({ ...options, referenceMode: mode });
            }}>
              {reference ? reference.referenceModes.map((mode) => <option key={mode} value={mode}>{referenceModeLabels[mode]}</option>) : <option value={options.referenceMode}>参考不可用</option>}
            </select>
          </label>
          {isVox && !isParagraph ? <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
            <span>生成方式</span>
            <select aria-label="生成方式" className={fieldClass} value={options.generationMode} disabled={settingsDisabled || !provider?.available} onChange={(event) => changeGenerationMode(event.target.value)}>
              <option value="clip">{generationModeLabels.clip}</option>
              <option value="long_text" disabled={!longTextAvailable}>{generationModeLabels.long_text}</option>
            </select>
          </label> : null}
          {isLongText && !voiceContext ? <div className="min-w-0 space-y-2">
            <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
              <span>文本分析</span>
              <select aria-label="文本分析" className={fieldClass} value={analysisProvider} disabled={settingsDisabled || !provider?.available || !longTextAvailable} onChange={(event) => changeAnalysisProvider(event.target.value)}>
                <option value="local">本地</option>
                <option value="api" disabled={!apiConfigured}>外部 API{apiConfigured ? "" : "（未配置）"}</option>
              </select>
            </label>
            {analysisProvider === "api" ? <p className="break-words text-xs leading-5 text-studio-muted">文案将发送到已配置的外部 API。</p> : null}
          </div> : null}
        </div>
      </div>
    </details>
  </section>;
}
