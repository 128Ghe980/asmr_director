import { getMissingProjectMixClipIds } from "./project-mix-state";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

export type DecodedPcmAudio = {
  sampleRate: number;
  channels: 1 | 2;
  samples: Float32Array;
};

export type RenderProjectMixWavInput = {
  project: AsmrProject;
  loadClipAsset: (clip: TimelineClip) => Promise<Uint8Array | Buffer>;
  sampleRate?: number;
};

const DEFAULT_SAMPLE_RATE = 32000;
const MAX_NORMALIZATION_GAIN = Math.pow(10, 18 / 20);

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }

  return value;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function makeDataView(bytes: Uint8Array | Buffer): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertAvailable(
  view: DataView,
  offset: number,
  byteLength: number,
  message: string,
) {
  if (offset + byteLength > view.byteLength) {
    throw new Error(message);
  }
}

export function writePcm16StereoWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  if (samples.length % 2 !== 0) {
    throw new Error("Stereo samples must be interleaved pairs");
  }

  const channels = 2;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = clampSample(samples[index]);
    const scale = sample < 0 ? 32768 : 32767;

    view.setInt16(44 + index * bytesPerSample, Math.round(sample * scale), true);
  }

  return new Uint8Array(buffer);
}

export function decodePcmWav(bytes: Uint8Array | Buffer): DecodedPcmAudio {
  const view = makeDataView(bytes);

  if (
    view.byteLength < 44 ||
    readAscii(view, 0, 4) !== "RIFF" ||
    readAscii(view, 8, 4) !== "WAVE"
  ) {
    throw new Error("Invalid WAV");
  }

  let audioFormat: number | null = null;
  let channels: 1 | 2 | null = null;
  let sampleRate: number | null = null;
  let bitsPerSample: number | null = null;
  let dataOffset: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    assertAvailable(view, chunkDataOffset, chunkSize, "Invalid WAV");

    if (chunkId === "fmt ") {
      assertAvailable(view, chunkDataOffset, 16, "Invalid WAV fmt chunk");
      audioFormat = view.getUint16(chunkDataOffset, true);
      const channelCount = view.getUint16(chunkDataOffset + 2, true);

      if (channelCount !== 1 && channelCount !== 2) {
        throw new Error("Unsupported WAV channel count");
      }

      channels = channelCount;
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat !== 1 ||
    bitsPerSample !== 16 ||
    channels === null ||
    sampleRate === null ||
    dataOffset === null ||
    dataSize === null
  ) {
    throw new Error("Unsupported WAV format");
  }

  if (dataSize % 2 !== 0) {
    throw new Error("Invalid WAV data chunk");
  }

  const samples = new Float32Array(dataSize / 2);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = view.getInt16(dataOffset + index * 2, true);
    const scale = sample < 0 ? 32768 : 32767;

    samples[index] = sample / scale;
  }

  return {
    sampleRate,
    channels,
    samples,
  };
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
  const source = decodePcmWav(bytes);

  if (source.sampleRate !== sampleRate) {
    throw new Error("Project mix source sample rate mismatch");
  }

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
    const mono = (left + right) / 2;
    const gain =
      gainFromDb(clip.volume_db) *
      getFadeGain(frame, clipFrameCount, clip, sampleRate) *
      getMovementDistanceGain(clip, progress);
    const panGains = getPanGains(getMovementPan(clip, progress));

    output[outputIndex] += mono * gain * panGains.left;
    output[outputIndex + 1] += mono * gain * panGains.right;
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
