import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";
import { SPATIAL_RENDER_VERSION } from "./spatial-settings";
import type { VoiceGenerationContext } from "./voice-generation-context";
import { getAudioPostProcessingClips, getCurrentAudioPostProcessingReceipts } from "./audio-post-processing";

type ClipGenerationFingerprintInput = {
  id: string;
  track: TimelineClip["track"];
  type: TimelineClip["type"];
  start: number | undefined;
  duration: number;
  volume_db: number;
  fade_in: number;
  fade_out: number;
  position: TimelineClip["position"];
  typed: Record<string, boolean | string>;
  voice_context?: VoiceGenerationContext;
};

type ProjectMixExportType = "wav";

type ProjectMixFingerprintInput = {
  spatial_renderer?: string;
  voice_delivery?: {
    version: "explicit-voice-v1";
    mode: "original" | "processed";
    processed?: Array<{
      clipId: string;
      asset: { uri: string; duration: number };
      sourceSha256: string;
      outputSha256: string;
      settingsFingerprint: string;
      rendererVersion: string;
    }>;
  };
  project_id: string;
  duration: number;
  exportType: ProjectMixExportType;
  mixing: AsmrProject["timeline"]["mixing"];
  clips: Array<{
    id: string;
    track: TimelineClip["track"];
    type: TimelineClip["type"];
    start: number;
    duration: number;
    volume_db: number;
    fade_in: number;
    fade_out: number;
    position: TimelineClip["position"];
    asset: {
      uri: string | null;
      duration: number | null;
    };
    stale_voice_source?: Record<string, boolean | string>;
    silent?: true;
  }>;
};

const projectMixClipTracks = new Set<TimelineClip["track"]>([
  "voice",
  "breath",
  "sfx",
  "ambience",
]);

function getTypedFingerprintInput(
  clip: TimelineClip,
): ClipGenerationFingerprintInput["typed"] {
  switch (clip.type) {
    case "voice":
      return {
        emotion: clip.emotion,
        pace: clip.pace,
        style: clip.style,
        text: clip.text,
      };
    case "breath":
      return { breath: clip.breath };
    case "sfx":
      return { sfx: clip.sfx };
    case "ambience":
      return {
        ambience: clip.ambience,
        loop: clip.loop,
      };
  }
}

type ClipGenerationFingerprintOptions = {
  ignoreVoiceStart?: boolean;
  voiceContext?: VoiceGenerationContext;
};

export function getClipGenerationFingerprint(
  clip: TimelineClip,
  options: ClipGenerationFingerprintOptions = {},
): string {
  const input: ClipGenerationFingerprintInput = {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    // Planner fitting can move a concurrently generating voice without changing
    // its audio. User timing edits still cancel the job in the workspace.
    start: options.ignoreVoiceStart && clip.type === "voice" ? undefined : clip.start,
    duration: clip.duration,
    volume_db: clip.volume_db,
    fade_in: clip.fade_in,
    fade_out: clip.fade_out,
    position: clip.position,
    typed: getTypedFingerprintInput(clip),
    ...(clip.type === "voice" && options.voiceContext ? { voice_context: options.voiceContext } : {}),
  };

  return JSON.stringify(input);
}

export function isCurrentClipGenerationFingerprint(
  project: AsmrProject,
  clipId: string,
  fingerprint: string,
  options: ClipGenerationFingerprintOptions = {},
): boolean {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  return clip ? getClipGenerationFingerprint(clip, options) === fingerprint : false;
}

function getProjectMixClipFingerprintInput(
  clip: TimelineClip,
): ProjectMixFingerprintInput["clips"][number] {
  return {
    id: clip.id,
    track: clip.track,
    type: clip.type,
    start: clip.start,
    duration: clip.duration,
    volume_db: clip.volume_db,
    fade_in: clip.fade_in,
    fade_out: clip.fade_out,
    position: {
      pan: clip.position.pan,
      distance: clip.position.distance,
      movement: clip.position.movement,
    },
    asset: {
      uri: clip.asset.uri,
      duration: clip.asset.duration,
    },
    ...(clip.type === "voice" && clip.audio_stale ? { stale_voice_source: getTypedFingerprintInput(clip) } : {}),
    ...(clip.type === "voice" && clip.kind === "silent" ? { silent: true as const } : {}),
  };
}

function voiceDeliveryFingerprint(project: AsmrProject): ProjectMixFingerprintInput["voice_delivery"] {
  const voices = getAudioPostProcessingClips(project).filter(clip => clip.kind !== "silent");
  if (!voices.length) return undefined;
  const current = getCurrentAudioPostProcessingReceipts(project);
  const receipts = voices.map(clip => current.get(clip.id)).filter(receipt => receipt !== undefined);
  // Match the mix loader: partial or stale processing always uses the whole raw set.
  if (receipts.length !== voices.length) return { version: "explicit-voice-v1", mode: "original" };
  return { version: "explicit-voice-v1", mode: "processed", processed: receipts.map(receipt => ({
    clipId: receipt.clipId, asset: { uri: receipt.asset.uri, duration: receipt.asset.duration },
    sourceSha256: receipt.sourceSha256, outputSha256: receipt.outputSha256,
    settingsFingerprint: receipt.settingsFingerprint, rendererVersion: receipt.rendererVersion,
  })) };
}

export function getProjectMixFingerprint(
  project: AsmrProject,
  exportType: ProjectMixExportType = "wav",
): string {
  const voiceDelivery = voiceDeliveryFingerprint(project);
  const input: ProjectMixFingerprintInput = {
    ...(project.timeline.mixing.binaural ? { spatial_renderer: SPATIAL_RENDER_VERSION } : {}),
    ...(voiceDelivery ? { voice_delivery: voiceDelivery } : {}),
    project_id: project.project_id,
    duration: project.duration,
    exportType,
    mixing: {
      target_lufs: project.timeline.mixing.target_lufs,
      binaural: project.timeline.mixing.binaural,
      master_limiter: project.timeline.mixing.master_limiter,
    },
    clips: flattenClips(project)
      .filter((clip) => projectMixClipTracks.has(clip.track))
      .map(getProjectMixClipFingerprintInput),
  };

  return JSON.stringify(input);
}

export function isCurrentProjectMixFingerprint(
  project: AsmrProject,
  fingerprint: string,
  exportType: ProjectMixExportType = "wav",
): boolean {
  return getProjectMixFingerprint(project, exportType) === fingerprint;
}
