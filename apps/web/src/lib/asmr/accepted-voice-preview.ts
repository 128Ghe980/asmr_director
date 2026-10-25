import { sanitizeDownloadName } from "./batch-download";
import { getCurrentProcessedVoiceAsset } from "./audio-post-processing";
import type { AsmrProject, VoiceClip } from "./schema";

export type AcceptedVoicePreviewEntry = { clipId: string; gapAfterSeconds: number } & (
  { assetId: string } | { silenceDurationSeconds: number }
);
export type AcceptedVoicePreviewPlan = {
  entries: AcceptedVoicePreviewEntry[];
  clipCount: number;
  skippedCount: number;
  totalVoiceCount: number;
  silentCount: number;
  staleCount?: number;
  filename: string;
  fingerprint: string;
};

/** Only current adopted local voice assets; candidates and other tracks never enter. */
export function getAcceptedVoicePreviewPlan(project: AsmrProject, audioVersion: "original" | "processed" = "original"): AcceptedVoicePreviewPlan {
  if (audioVersion === "processed") {
    const voices = project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : []);
    const spoken = voices.filter(clip => clip.kind !== "silent");
    const prepared = new Map(spoken.flatMap(clip => {
      const asset = getCurrentProcessedVoiceAsset(project, clip.id);
      return asset ? [[clip.id, asset] as const] : [];
    }));
    const entries = voices.flatMap((clip): AcceptedVoicePreviewEntry[] => clip.kind === "silent"
      ? [{ clipId: clip.id, gapAfterSeconds: 0, silenceDurationSeconds: clip.duration }]
      : prepared.has(clip.id) ? [{ clipId: clip.id, gapAfterSeconds: 0, assetId: prepared.get(clip.id)!.assetId }] : []);
    return { entries, clipCount: prepared.size, skippedCount: spoken.length - prepared.size, totalVoiceCount: spoken.length,
      silentCount: voices.length - spoken.length,
      filename: `${sanitizeDownloadName(project.title, "ASMR 工程")}_后处理试听.wav`,
      fingerprint: JSON.stringify({ projectId: project.project_id, title: project.title, audioVersion, entries,
        processing: project.audioPostProcessing, mixing: project.timeline.mixing }) };
  }
  const voices = project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : [])
    .map((clip, index) => ({ clip, index })).sort((a, b) => a.clip.start - b.clip.start || a.index - b.index)
    .map(({ clip }) => clip);
  const spoken = voices.filter(clip => clip.kind !== "silent");
  const accepted = spoken.filter(clip => clip.generation.status === "asset_generated"
    && Boolean(clip.asset.asset_id?.trim()) && clip.asset.uri === `asset://clip/${clip.asset.asset_id}`);
  const playable = voices.filter(clip => clip.kind === "silent" || accepted.includes(clip));
  const entries = playable.map((clip, index): AcceptedVoicePreviewEntry => {
    const next = voices[voices.indexOf(clip) + 1];
    const duration = clip.kind === "silent" ? clip.duration : clip.asset.duration ?? clip.duration;
    const gap = clip.pause_after ?? (next ? Math.max(0, next.start - clip.start - duration) : 0);
    return { clipId: clip.id, ...(clip.kind === "silent" ? { silenceDurationSeconds: clip.duration } : { assetId: clip.asset.asset_id! }),
      gapAfterSeconds: index === playable.length - 1 ? 0 : gap };
  });
  return {
    entries, clipCount: accepted.length, skippedCount: spoken.length - accepted.length, totalVoiceCount: spoken.length,
    silentCount: playable.length - accepted.length,
    ...(accepted.some(clip => clip.audio_stale) ? { staleCount: accepted.filter(clip => clip.audio_stale).length } : {}),
    filename: `${sanitizeDownloadName(project.title, "ASMR 工程")}_已采用语音预览.wav`,
    fingerprint: JSON.stringify({ projectId: project.project_id, title: project.title,
      voices: voices.map(clip => ({ id: clip.id, text: clip.text, kind: clip.kind, audio_stale: clip.audio_stale, start: clip.start, duration: clip.duration,
        pause: clip.pause_after ?? null, status: clip.generation.status, asset: clip.asset })) }),
  };
}
