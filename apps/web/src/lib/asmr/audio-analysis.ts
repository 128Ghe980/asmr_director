import {
  decodePcmWav,
  type DecodedPcmAudio,
} from "./project-mix-renderer";

export type AudioAnalysis = {
  bars: number[];
  duration: number;
  sampleRate: number;
  channels: 1 | 2;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  clippedSampleCount: number;
};

function amplitudeToDbfs(amplitude: number): number | null {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : null;
}

export function analyzeDecodedPcm(
  audio: DecodedPcmAudio,
  barCount: number,
): AudioAnalysis {
  if (!Number.isInteger(barCount) || barCount <= 0) {
    throw new Error("Waveform bar count must be a positive integer");
  }

  const frameCount = Math.floor(audio.samples.length / audio.channels);
  let peak = 0;
  let sumSquares = 0;
  let clippedSampleCount = 0;

  for (const sample of audio.samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sumSquares += sample * sample;

    if (absolute === 1) {
      clippedSampleCount += 1;
    }
  }

  const rms =
    audio.samples.length > 0
      ? Math.sqrt(sumSquares / audio.samples.length)
      : 0;
  const rawBars = Array.from({ length: barCount }, (_, barIndex) => {
    const startFrame = Math.floor((barIndex * frameCount) / barCount);
    const endFrame = Math.min(
      frameCount,
      Math.max(startFrame + 1, Math.floor(((barIndex + 1) * frameCount) / barCount)),
    );
    let windowPeak = 0;

    for (let frame = startFrame; frame < endFrame; frame += 1) {
      for (let channel = 0; channel < audio.channels; channel += 1) {
        windowPeak = Math.max(
          windowPeak,
          Math.abs(audio.samples[frame * audio.channels + channel] ?? 0),
        );
      }
    }

    return windowPeak;
  });
  const bars = rawBars.map((value) =>
    peak > 0 ? Math.round((value / peak) * 1000) / 10 : 0,
  );

  return {
    bars,
    duration: audio.sampleRate > 0 ? frameCount / audio.sampleRate : 0,
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    peakDbfs: amplitudeToDbfs(peak),
    rmsDbfs: amplitudeToDbfs(rms),
    clippedSampleCount,
  };
}

export function analyzePcmWav(
  bytes: Uint8Array | Buffer,
  barCount = 64,
): AudioAnalysis {
  return analyzeDecodedPcm(decodePcmWav(bytes), barCount);
}
