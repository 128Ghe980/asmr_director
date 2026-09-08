"use client";

import { useRef, type ReactNode } from "react";

import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { resolvePlayableAssetUri } from "@/lib/asmr/playback-asset-resolver";
import type { TimelineClip } from "@/lib/asmr/schema";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";

export type VoiceGenerationPanelProps = {
  options: VoiceGenerationOptions;
  onOptionsChange: (options: VoiceGenerationOptions) => void;
  catalog: VoiceProviderCatalog | null;
  catalogError?: string;
  busy: boolean;
  candidates: AudioCandidate[];
  selectedClip: TimelineClip;
  onAdopt: (candidate: AudioCandidate) => void;
  onDiscard: (candidate: AudioCandidate) => void;
  onRegenerateGroup?: (candidate: AudioCandidate, groupIndex: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  hasUndo: boolean;
  error?: string;
  loading?: boolean;
  generationControl?: ReactNode;
};

type Reference = VoiceProviderCatalog["providers"][number]["references"][number];

const fieldClass = "w-full min-w-0 rounded-lg border border-studio-line bg-black/20 px-2.5 py-2 text-sm text-studio-text outline-none focus:border-sky-300/50 disabled:opacity-50";
const buttonClass = "min-h-9 rounded-lg border border-studio-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const referenceModeLabels = {
  reference_only: "仅参考音频",
  with_reference_text: "参考音频＋文本",
} as const;
const generationModeLabels = {
  clip: "当前片段",
  long_text: "长文分组",
} as const;

function preferredMode(reference: Reference): VoiceGenerationOptions["referenceMode"] {
  return reference.referenceModes.includes("with_reference_text")
    ? "with_reference_text"
    : "reference_only";
}

function CandidateDetails({ candidate, candidateNumber, referenceLabel, regenerationDisabled, onRegenerateGroup, onPreviewPlay }: {
  candidate: AudioCandidate;
  candidateNumber: number;
  referenceLabel?: string;
  regenerationDisabled: boolean;
  onRegenerateGroup?: VoiceGenerationPanelProps["onRegenerateGroup"];
  onPreviewPlay: (audio: HTMLAudioElement) => void;
}) {
  const provenance = candidate.provenance;
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
    rows.push(["文本分析", providerLabel], ["分组", `${groups.length} 组`]);
    if (analysisModel) rows.push(["分析模型", analysisModel]);
    if (joins.length > 0) rows.push(["组间停顿", `${joins.map((join) => Number(join.actualDurationMs.toFixed(1))).join(" / ")} ms`]);
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
    {provenance.generationMode === "long_text" && provenance.longText ? <ol className="mt-3 min-w-0 space-y-3 border-t border-studio-line pt-3">
      {provenance.longText.groups.map((group) => {
        const groupNumber = group.index + 1;
        const audio = resolvePlayableAssetUri(group.asset.uri);
        return <li key={group.index} className="min-w-0 space-y-2">
          <p className="font-semibold text-studio-text">第 {groupNumber} 组</p>
          <p title={group.text} className="truncate leading-5">{group.text}</p>
          {audio ? <details className="min-w-0">
            <summary className="cursor-pointer py-1">试听本组</summary>
            <audio aria-label={`候选 ${candidateNumber} 第 ${groupNumber} 组试听`} controls preload="none" src={audio} onPlay={(event) => onPreviewPlay(event.currentTarget)} className="mt-1 h-9 w-full min-w-0 max-w-full" />
          </details> : null}
          {onRegenerateGroup ? <button type="button" aria-label={`重生成候选 ${candidateNumber} 第 ${groupNumber} 组`} className={`${buttonClass} text-studio-muted`} disabled={regenerationDisabled} onClick={() => onRegenerateGroup(candidate, group.index)}>重生成本组</button> : null}
        </li>;
      })}
    </ol> : null}
  </details>;
}

export function VoiceGenerationPanel({
  options, onOptionsChange, catalog, catalogError, busy, candidates, selectedClip,
  onAdopt, onDiscard, onUndo, canUndo, hasUndo, error, loading = false,
  generationControl, onRegenerateGroup,
}: VoiceGenerationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  if (selectedClip.type !== "voice") return null;

  const providers = catalog?.providers ?? [];
  const provider = providers.find((item) => item.id === options.provider);
  const reference = provider?.references.find((item) => item.id === options.voicePackId);
  const isVox = options.provider === "voxcpm2";
  const isLongText = isVox && options.generationMode === "long_text";
  const longTextAvailable = provider?.longText?.available === true;
  const apiConfigured = provider?.longText?.apiConfigured === true;
  const analysisProvider = options.analysisProvider ?? "local";
  const settingsDisabled = busy || loading || catalog === null;
  const actionsDisabled = busy || loading;
  const sourceFingerprint = getVoiceCandidateSourceFingerprint(selectedClip);
  const currentAudio = resolvePlayableAssetUri(selectedClip.asset.uri);
  const visibleCandidates = candidates.filter((candidate) => candidate.clipId === selectedClip.id && candidate.status === "ready");

  function changeProvider(id: string) {
    const next = providers.find((item) => item.id === id);
    if (settingsDisabled || !next?.available) return;
    const nextReference = next.references.find((item) => item.id === next.defaultReferenceId) ?? next.references[0];
    if (!nextReference) return;
    onOptionsChange({
      provider: next.id, voicePackId: nextReference.id,
      referenceMode: preferredMode(nextReference),
      generationMode: next.id === "voxcpm2" ? options.generationMode : "clip",
      ...(next.id === "voxcpm2" && options.analysisProvider ? { analysisProvider: options.analysisProvider } : {}),
    });
  }

  function changeReference(id: string) {
    const next = provider?.references.find((item) => item.id === id);
    if (settingsDisabled || !provider?.available || !next) return;
    onOptionsChange({ ...options, voicePackId: next.id, referenceMode: preferredMode(next) });
  }

  function pauseOtherPreviews(current: HTMLAudioElement) {
    panelRef.current?.querySelectorAll("audio").forEach((audio) => {
      if (audio !== current) audio.pause();
    });
  }

  function changeGenerationMode(mode: string) {
    if (settingsDisabled || !provider?.available || !isVox) return;
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

  return <section ref={panelRef} aria-label="人声生成设置" className="min-w-0 space-y-3">
    <div className="grid min-w-0 gap-3">
      <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
        <span>人声引擎</span>
        <select aria-label="人声引擎" className={fieldClass} value={options.provider} disabled={settingsDisabled} onChange={(event) => changeProvider(event.target.value)}>
          {providers.length > 0 ? providers.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>
            {item.label}{item.available ? "" : "（不可用）"}
          </option>) : <>
            <option value="gpt-sovits">GPT-SoVITS</option><option value="voxcpm2">VoxCPM2</option>
          </>}
        </select>
      </label>
      <div className="grid min-w-0 gap-3">
        <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
          <span>参考声音</span>
          <select aria-label="参考声音" className={fieldClass} value={options.voicePackId} disabled={settingsDisabled || !provider?.available} onChange={(event) => changeReference(event.target.value)}>
            {!reference ? <option value={options.voicePackId} disabled>参考不可用</option> : null}
            {provider?.references.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
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
      </div>
      {isVox ? <label className="block min-w-0 space-y-1.5 text-xs text-studio-muted">
        <span>生成方式</span>
        <select aria-label="生成方式" className={fieldClass} value={options.generationMode} disabled={settingsDisabled || !provider?.available} onChange={(event) => changeGenerationMode(event.target.value)}>
          <option value="clip">{generationModeLabels.clip}</option>
          <option value="long_text" disabled={!longTextAvailable}>{generationModeLabels.long_text}</option>
        </select>
      </label> : null}
      {isLongText ? <div className="min-w-0 space-y-2">
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

    {catalogError ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{catalogError}</p>
      : provider && !provider.available ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{provider.unavailableReason || "当前引擎暂不可用。"}</p>
      : provider?.available && isVox && !longTextAvailable ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{provider.longText?.reason || "长文分组暂不可用。"}</p>
      : isLongText && analysisProvider === "api" && !apiConfigured ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">请先配置外部文本 API。</p>
      : loading ? <p role="status" className="text-xs text-studio-muted">正在读取声音…</p> : null}
    {error ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{error}</p> : null}

    {generationControl}

    {currentAudio ? <div className="min-w-0 space-y-2">
      <p className="text-xs text-studio-muted">当前人声</p>
      <audio aria-label="当前人声试听" controls preload="none" src={currentAudio} onPlay={(event) => pauseOtherPreviews(event.currentTarget)} className="h-9 w-full min-w-0 max-w-full" />
    </div> : null}

    {visibleCandidates.length > 0 ? <div className="max-h-96 min-w-0 space-y-3 overflow-y-auto">
      {visibleCandidates.map((candidate, index) => {
        const adopted = candidate.asset.assetId === selectedClip.asset.asset_id;
        const stale = candidate.sourceFingerprint !== sourceFingerprint;
        const candidateAudio = resolvePlayableAssetUri(candidate.asset.uri);
        const candidateReference = catalog?.providers.find((item) => item.id === candidate.provenance.provider)?.references.find((item) => item.id === candidate.provenance.voicePackId);
        return <article key={candidate.candidateId} aria-label={`候选 ${index + 1}`} className="min-w-0 space-y-2.5 rounded-lg border border-studio-line bg-black/10 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-studio-text">候选 {index + 1}</span>
            <span className="text-studio-muted">{candidate.asset.duration.toFixed(1)} 秒</span>
            {adopted ? <span className="text-studio-green">已采用</span> : null}
          </div>
          {candidateAudio ? <audio aria-label={`候选 ${index + 1} 试听`} controls preload="none" src={candidateAudio} onPlay={(event) => pauseOtherPreviews(event.currentTarget)} className="h-9 w-full min-w-0 max-w-full" /> : null}
          {stale && !adopted ? <p className="break-words text-xs leading-5 text-amber-100">文案已修改，请重新生成。</p> : null}
          {candidate.qualityWarnings.map((warning, warningIndex) => <p key={warningIndex} role="alert" className="break-words text-xs leading-5 text-amber-100">{warning}</p>)}
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label={`采用候选 ${index + 1}`} className={`${buttonClass} border-sky-300/30 bg-sky-300/10 text-sky-100`} disabled={actionsDisabled || adopted || stale} onClick={() => onAdopt(candidate)}>采用</button>
            {!adopted ? <button type="button" aria-label={`放弃候选 ${index + 1}`} className={`${buttonClass} text-studio-muted`} disabled={actionsDisabled} onClick={() => onDiscard(candidate)}>放弃</button> : null}
          </div>
          <CandidateDetails candidate={candidate} candidateNumber={index + 1} referenceLabel={candidateReference?.label}
            regenerationDisabled={actionsDisabled || stale || candidate.status !== "ready" || !provider?.available || !longTextAvailable}
            onRegenerateGroup={isLongText ? onRegenerateGroup : undefined} onPreviewPlay={pauseOtherPreviews} />
        </article>;
      })}
    </div> : null}

    {hasUndo ? <div className="space-y-2">
      <button type="button" className={`${buttonClass} text-studio-muted`} disabled={actionsDisabled || !canUndo} onClick={onUndo}>撤回上次采用</button>
      {!canUndo ? <p className="break-words text-xs leading-5 text-studio-muted">片段已编辑，可从历史版本恢复。</p> : null}
    </div> : null}
  </section>;
}
