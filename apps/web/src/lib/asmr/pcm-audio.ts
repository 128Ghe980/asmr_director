export type DecodedPcmAudio = {
  sampleRate: number;
  channels: 1 | 2;
  samples: Float32Array;
};

export const INTERNAL_SAMPLE_RATE = 48000;

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

function makeDataView(bytes: Uint8Array | Buffer | ArrayBuffer): DataView {
  if (bytes instanceof ArrayBuffer) return new DataView(bytes);
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
  return writePcm16Wav(samples, sampleRate, 2);
}

export function writePcm16Wav(samples: Float32Array, sampleRate: number, channels: 1 | 2 = 1): Uint8Array {
  assertSampleRate(sampleRate);

  if (samples.length % channels !== 0) {
    throw new Error("Stereo samples must be interleaved pairs");
  }

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

export function decodePcmWav(bytes: Uint8Array | Buffer | ArrayBuffer): DecodedPcmAudio {
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
    (bitsPerSample !== 16 && bitsPerSample !== 24) ||
    channels === null ||
    sampleRate === null ||
    dataOffset === null ||
    dataSize === null
  ) {
    throw new Error("Unsupported WAV format");
  }

  if (sampleRate <= 0) {
    throw new Error("Invalid WAV sample rate");
  }

  const bytesPerSample = bitsPerSample / 8;
  if (dataSize % (channels * bytesPerSample) !== 0) {
    throw new Error("WAV data must contain complete frames");
  }

  const samples = new Float32Array(dataSize / bytesPerSample);

  for (let index = 0; index < samples.length; index += 1) {
    const offset = dataOffset + index * bytesPerSample;
    const sample = bitsPerSample === 16 ? view.getInt16(offset, true)
      : (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16));
    const scale = bitsPerSample === 24 ? 8388608 : sample < 0 ? 32768 : 32767;

    samples[index] = sample / scale;
  }

  return {
    sampleRate,
    channels,
    samples,
  };
}

function assertSampleRate(sampleRate: number) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("PCM sample rate must be a positive integer");
  }
}

/** Convert rate without changing channel layout, gain, or native-rate samples. */
export function normalizePcmAudio(
  audio: DecodedPcmAudio,
  targetSampleRate = INTERNAL_SAMPLE_RATE,
): DecodedPcmAudio {
  assertSampleRate(audio.sampleRate);
  assertSampleRate(targetSampleRate);
  if (audio.channels !== 1 && audio.channels !== 2) {
    throw new Error("Unsupported PCM channel count");
  }
  if (audio.samples.length % audio.channels !== 0) {
    throw new Error("PCM samples must contain complete frames");
  }
  if (audio.samples.length === 0) {
    throw new Error("PCM audio is empty");
  }
  if (audio.sampleRate === targetSampleRate) return audio;

  const sourceFrames = audio.samples.length / audio.channels;
  const targetFrames = Math.max(1, Math.round(sourceFrames * targetSampleRate / audio.sampleRate));
  const samples = new Float32Array(targetFrames * audio.channels);
  for (let frame = 0; frame < targetFrames; frame++) {
    const sourcePosition = frame * audio.sampleRate / targetSampleRate;
    const before = Math.min(Math.floor(sourcePosition), sourceFrames - 1);
    const after = Math.min(before + 1, sourceFrames - 1);
    const fraction = sourcePosition - before;
    for (let channel = 0; channel < audio.channels; channel++) {
      const left = audio.samples[before * audio.channels + channel];
      const right = audio.samples[after * audio.channels + channel];
      samples[frame * audio.channels + channel] = left + (right - left) * fraction;
    }
  }
  return { sampleRate: targetSampleRate, channels: audio.channels, samples };
}
