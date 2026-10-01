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

export type LoadedMixClip = Uint8Array | Buffer | { wav: Uint8Array; spatialized: boolean };

export type RenderProjectMixWavInput = {
  project: AsmrProject;
  loadClipAsset: (clip: TimelineClip) => Promise<LoadedMixClip>;
  sampleRate?: number;
  signal?: AbortSignal;
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
    case "orbit":
    case "orbit_approach":
      return -Math.cos(2 * Math.PI * progress);
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
    case "orbit_approach":
      return interpolate(0.35, 1.12, progress);
    case "approach":
      return interpolate(0.35, baseGain, progress);
    case "recede":
      return interpolate(baseGain, 0.35, progress);
    case "static":
    case "orbit":
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
  clip: TimelineClip,
  sampleRate: number,
  loadClipAsset: RenderProjectMixWavInput["loadClipAsset"],
) {
  const loaded = await loadClipAsset(clip);
  const spatialized = !(loaded instanceof Uint8Array) && loaded.spatialized;
  const bytes = loaded instanceof Uint8Array ? loaded : loaded.wav;
  const source = normalizePcmAudio(decodePcmWav(bytes), sampleRate);
  if (spatialized && source.channels !== 2) throw new Error("Spatial output must be stereo");

  const sourceFrameCount = Math.floor(source.samples.length / source.channels);
  const startFrame = Math.max(0, Math.round(clip.start * sampleRate));
  const clipFrameCount = Math.max(0, Math.round(clip.duration * sampleRate));
  if (spatialized && (startFrame + sourceFrameCount) * 2 > output.length) {
    const extended = new Float32Array((startFrame + sourceFrameCount) * 2);
    extended.set(output);
    output = extended;
  }
  const outputFrameCount = output.length / 2;
  const frameCount = Math.min(spatialized ? sourceFrameCount : clipFrameCount, outputFrameCount - startFrame);
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
      (spatialized ? 1 : getFadeGain(frame, clipFrameCount, clip, sampleRate));

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
  return { output, spatialized };
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

/** Export one positioned clip, preserving D's tail and the existing clip DSP.
 * Master loudness normalization belongs to the complete mix, never each stem.
 */
export async function renderProcessedClipWav(
  clip: TimelineClip,
  loaded: LoadedMixClip,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const localClip = { ...clip, start: 0 };
  const output = new Float32Array(Math.ceil(clip.duration * INTERNAL_SAMPLE_RATE) * 2);
  const result = await mixClipIntoOutput(output, localClip, INTERNAL_SAMPLE_RATE, async () => loaded);
  signal?.throwIfAborted();
  return writePcm16StereoWav(result.output, INTERNAL_SAMPLE_RATE);
}

export async function renderProjectMixWav({
  project,
  loadClipAsset,
  sampleRate = DEFAULT_SAMPLE_RATE,
  signal,
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

  let output: Float32Array = new Float32Array(Math.ceil(project.duration * sampleRate) * 2);
  let hasSpatialAudio = false;

  for (const clip of flattenClips(project)) {
    signal?.throwIfAborted();
    const result = await mixClipIntoOutput(output, clip, sampleRate, loadClipAsset);
    output = result.output;
    hasSpatialAudio ||= result.spatialized;
  }
  signal?.throwIfAborted();

  // D already prepares the shared dry source before applying distance. Raising
  // each rendered mix to its own target would erase (or reverse) near/far levels.
  if (!hasSpatialAudio) applyTargetNormalization(output, project.timeline.mixing.target_lufs);

  if (project.timeline.mixing.master_limiter) {
    if (hasSpatialAudio) {
      // One common attenuation preserves binaural cues and room decay when
      // clip volumes or overlapping clips would otherwise overload the mix.
      let peak = 0;
      for (const sample of output) peak = Math.max(peak, Math.abs(sample));
      const ceiling = Math.pow(10, -2.1 / 20);
      if (peak > ceiling) for (let i = 0; i < output.length; i++) output[i] *= ceiling / peak;
    } else applyLimiter(output);
  }

  return writePcm16StereoWav(output, sampleRate);
}
