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

function preferredMode(reference: Reference): VoiceGenerationOptions["referenceMode"] {
  return reference.referenceModes.includes("with_reference_text")
    ? "with_reference_text"
    : "reference_only";
}

function CandidateDetails({ candidate, referenceLabel }: { candidate: AudioCandidate; referenceLabel?: string }) {
  const provenance = candidate.provenance;
  const rows: [string, string][] = [
    ["模型", provenance.model],
    ["参考", referenceLabel || provenance.voicePackId],
    ["模式", referenceModeLabels[provenance.referenceMode]],
    ["随机种子", String(provenance.seed)],
    ["音频", `${candidate.wav.sampleRate / 1000} kHz · ${candidate.wav.channels === 1 ? "单声道" : "双声道"} · ${candidate.wav.bitsPerSample} bit`],
    ...Object.entries(provenance.parameters).map(([key, value]): [string, string] => [key, String(value)]),
  ];
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
  </details>;
}

export function VoiceGenerationPanel({
  options, onOptionsChange, catalog, catalogError, busy, candidates, selectedClip,
  onAdopt, onDiscard, onUndo, canUndo, hasUndo, error, loading = false,
  generationControl,
}: VoiceGenerationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  if (selectedClip.type !== "voice") return null;

  const providers = catalog?.providers ?? [];
  const provider = providers.find((item) => item.id === options.provider);
  const reference = provider?.references.find((item) => item.id === options.voicePackId);
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
      referenceMode: preferredMode(nextReference), generationMode: "clip",
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
    </div>

    {catalogError ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{catalogError}</p>
      : provider && !provider.available ? <p role="alert" className="break-words text-xs leading-5 text-amber-100">{provider.unavailableReason || "当前引擎暂不可用。"}</p>
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
          <CandidateDetails candidate={candidate} referenceLabel={candidateReference?.label} />
        </article>;
      })}
    </div> : null}

    {hasUndo ? <div className="space-y-2">
      <button type="button" className={`${buttonClass} text-studio-muted`} disabled={actionsDisabled || !canUndo} onClick={onUndo}>撤回上次采用</button>
      {!canUndo ? <p className="break-words text-xs leading-5 text-studio-muted">片段已编辑，可从历史版本恢复。</p> : null}
    </div> : null}
  </section>;
}
