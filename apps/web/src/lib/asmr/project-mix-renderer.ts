import { getMissingProjectMixClipIds } from "./project-mix-state";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

import {
  INTERNAL_SAMPLE_RATE,
  decodePcmWav,
  normalizePcmAudio,
  writePcm16StereoWav,
  type DecodedPcmAudio,
} from "./pcm-audio";

export { decodePcmWav, writePcm16StereoWav } from "./pcm-audio";
export type { DecodedPcmAudio } from "./pcm-audio";

export type RenderProjectMixWavInput = {
  project: AsmrProject;
  loadClipAsset: (clip: TimelineClip) => Promise<Uint8Array | Buffer>;
  sampleRate?: number;
};

const DEFAULT_SAMPLE_RATE = INTERNAL_SAMPLE_RATE;
const MAX_NORMALIZATION_GAIN = Math.pow(10, 18 / 20);

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function getDecodedFrameSample(
  audio: DecodedPcmAudio,
  frameIndex: number,
  channelIndex: 0 | 1,
): number {
  if (audio.channels === 1) {
    return audio.samples[frameIndex] ?? 0;
  }

  return audio.samples[frameIndex * 2 + channelIndex] ?? 0;
}

function gainFromDb(volumeDb: number): number {
  return Math.pow(10, volumeDb / 20);
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function getFadeGain(
  frameIndex: number,
  clipFrameCount: number,
  clip: TimelineClip,
  sampleRate: number,
): number {
  let gain = 1;
  const fadeInFrames = Math.round(clip.fade_in * sampleRate);
  const fadeOutFrames = Math.round(clip.fade_out * sampleRate);

  if (fadeInFrames > 0) {
    gain *= Math.min(1, frameIndex / fadeInFrames);
  }

  if (fadeOutFrames > 0) {
    gain *= Math.min(1, (clipFrameCount - frameIndex - 1) / fadeOutFrames);
  }

  return Math.max(0, gain);
}

function getDistanceGain(distance: TimelineClip["position"]["distance"]): number {
  switch (distance) {
    case "far":
      return 0.35;
    case "mid":
      return 0.62;
    case "near":
      return 0.82;
    case "close":
      return 1;
    case "very_close":
      return 1.12;
  }
}

function getMovementPan(clip: TimelineClip, progress: number): number {
  switch (clip.position.movement) {
    case "left_to_right":
      return interpolate(-1, 1, progress);
    case "right_to_left":
      return interpolate(1, -1, progress);
    case "static":
    case "approach":
    case "recede":
      return clip.position.pan;
  }
}

function getMovementDistanceGain(clip: TimelineClip, progress: number): number {
  const baseGain = getDistanceGain(clip.position.distance);

  switch (clip.position.movement) {
    case "approach":
      return interpolate(0.35, baseGain, progress);
    case "recede":
      return interpolate(baseGain, 0.35, progress);
    case "static":
    case "left_to_right":
    case "right_to_left":
      return baseGain;
  }
}

function getPanGains(pan: number): { left: number; right: number } {
  const normalizedPan = Math.max(-1, Math.min(1, pan));
  const angle = ((normalizedPan + 1) * Math.PI) / 4;

  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

async function mixClipIntoOutput(
  output: Float32Array,
  project: AsmrProject,
  clip: TimelineClip,
  sampleRate: number,
  loadClipAsset: RenderProjectMixWavInput["loadClipAsset"],
) {
  const bytes = await loadClipAsset(clip);
  const source = normalizePcmAudio(decodePcmWav(bytes), sampleRate);

  const outputFrameCount = Math.ceil(project.duration * sampleRate);
  const sourceFrameCount = Math.floor(source.samples.length / source.channels);
  const startFrame = Math.max(0, Math.round(clip.start * sampleRate));
  const clipFrameCount = Math.max(0, Math.round(clip.duration * sampleRate));
  const frameCount = Math.min(clipFrameCount, outputFrameCount - startFrame);
  const shouldLoop =
    clip.type === "ambience" && clip.loop && sourceFrameCount > 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const outputFrame = startFrame + frame;
    const outputIndex = outputFrame * 2;
    const sourceFrame = shouldLoop ? frame % sourceFrameCount : frame;
    const progress = frameCount <= 1 ? 1 : frame / (frameCount - 1);
    const left = getDecodedFrameSample(source, sourceFrame, 0);
    const right = getDecodedFrameSample(source, sourceFrame, 1);
    const gain =
      gainFromDb(clip.volume_db) *
      getFadeGain(frame, clipFrameCount, clip, sampleRate);

    if (source.channels === 2) {
      // Stereo may already carry binaural cues: preserve both channels and
      // apply only the clip envelope, without repeating pan or distance.
      output[outputIndex] += left * gain;
      output[outputIndex + 1] += right * gain;
    } else {
      const panGains = getPanGains(getMovementPan(clip, progress));
      const positionedGain = gain * getMovementDistanceGain(clip, progress);
      output[outputIndex] += left * positionedGain * panGains.left;
      output[outputIndex + 1] += left * positionedGain * panGains.right;
    }
  }
}

function getRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;

  for (const sample of samples) {
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples.length);
}

function applyTargetNormalization(
  samples: Float32Array,
  targetLufs: number,
) {
  const rms = getRms(samples);

  if (rms <= 0) {
    return;
  }

  const targetRms = Math.pow(10, targetLufs / 20);

  if (rms >= targetRms) {
    return;
  }

  const gain = Math.min(targetRms / rms, MAX_NORMALIZATION_GAIN);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
}

function applyLimiter(samples: Float32Array) {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = clampSample(samples[index]);
  }
}

export async function renderProjectMixWav({
  project,
  loadClipAsset,
  sampleRate = DEFAULT_SAMPLE_RATE,
}: RenderProjectMixWavInput): Promise<Uint8Array> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("PCM sample rate must be a positive integer");
  }

  const missingClipIds = getMissingProjectMixClipIds(project);

  if (missingClipIds.length > 0) {
    throw new Error(
      `Missing project mix clip assets: ${missingClipIds.join(", ")}`,
    );
  }

  const output = new Float32Array(Math.ceil(project.duration * sampleRate) * 2);

  for (const clip of flattenClips(project)) {
    await mixClipIntoOutput(output, project, clip, sampleRate, loadClipAsset);
  }

  applyTargetNormalization(output, project.timeline.mixing.target_lufs);

  if (project.timeline.mixing.master_limiter) {
    applyLimiter(output);
  }

  return writePcm16StereoWav(output, sampleRate);
}
