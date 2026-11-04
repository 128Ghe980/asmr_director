/** Stabilize half-sample rounding (for example 0.35 s at 22050 Hz) across all delivery paths. */
export function getPcmSilenceFrameCount(seconds: number, sampleRate: number): number {
  const frames = seconds * sampleRate;
  return Math.round(frames + Number.EPSILON * Math.max(1, frames) * 2);
}

/** Append digital silence without changing a single source PCM sample or ancillary chunk. */
export function appendPcmWavSilence(wav: Uint8Array, seconds: number): {
  wav: Uint8Array; durationSeconds: number; sourceDurationSeconds: number;
  tailPauseSeconds: number; tailFrames: number;
} {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) throw new Error("Invalid WAV tail pause");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
  if (wav.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) !== wav.length - 8) {
    throw new Error("Invalid PCM WAV header");
  }
  let offset = 12, format = -1, data = -1, dataBytes = 0;
  while (offset + 8 <= wav.length) {
    const length = view.getUint32(offset + 4, true);
    if (offset + 8 + length + length % 2 > wav.length) throw new Error("Invalid PCM WAV chunk");
    if (tag(offset) === "fmt ") {
      if (format >= 0 || length < 16) throw new Error("Invalid PCM WAV format");
      format = offset + 8;
    }
    if (tag(offset) === "data") {
      if (data >= 0) throw new Error("Ambiguous PCM WAV data");
      data = offset + 8;
      dataBytes = length;
    }
    offset += 8 + length + length % 2;
  }
  if (offset !== wav.length || format < 0 || data < 0 || !dataBytes) throw new Error("Incomplete PCM WAV");
  const channels = view.getUint16(format + 2, true), sampleRate = view.getUint32(format + 4, true);
  const blockAlign = view.getUint16(format + 12, true), bits = view.getUint16(format + 14, true);
  if (view.getUint16(format, true) !== 1 || ![1, 2].includes(channels) || ![16, 24].includes(bits)
    || sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8
    || view.getUint32(format + 8, true) !== sampleRate * blockAlign || dataBytes % blockAlign) {
    throw new Error("Unsupported PCM WAV");
  }
  const tailFrames = getPcmSilenceFrameCount(seconds, sampleRate);
  const sourceDurationSeconds = dataBytes / blockAlign / sampleRate;
  const tailPauseSeconds = tailFrames / sampleRate;
  const durationSeconds = (dataBytes / blockAlign + tailFrames) / sampleRate;
  if (!tailFrames) return { wav, sourceDurationSeconds, durationSeconds, tailPauseSeconds, tailFrames };
  const newDataBytes = dataBytes + tailFrames * blockAlign;
  const oldDataEnd = data + dataBytes + dataBytes % 2;
  const newDataEnd = data + newDataBytes + newDataBytes % 2;
  const newLength = wav.length + newDataEnd - oldDataEnd;
  if (newLength > 512 * 1024 * 1024) throw new Error("Padded PCM WAV is too large");
  const padded = new Uint8Array(newLength);
  padded.set(wav.subarray(0, data + dataBytes));
  padded.set(wav.subarray(oldDataEnd), newDataEnd);
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(4, padded.length - 8, true);
  paddedView.setUint32(data - 4, newDataBytes, true);
  return { wav: padded, sourceDurationSeconds, durationSeconds, tailPauseSeconds, tailFrames };
}
