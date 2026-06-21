const mockAssetPrefix = "mock://asset/";
const cachedDataUrls = new Map<string, string>();

export function isMockAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith(mockAssetPrefix));
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeBase64(binary: string): string {
  const globalBuffer = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(
          value: string,
          encoding: "binary",
        ): { toString(encoding: "base64"): string };
      };
    }
  ).Buffer;

  if (globalBuffer) {
    return globalBuffer.from(binary, "binary").toString("base64");
  }

  return btoa(binary);
}

function makeMockWavDataUrl(uri: string): string {
  const sampleRate = 8000;
  const seconds = 0.45;
  const sampleCount = Math.floor(sampleRate * seconds);
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(buffer);
  const seed = [...uri].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  const frequency = 220 + (seed % 220);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, sampleCount * bytesPerSample, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    const sample =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) *
      envelope *
      0.18;
    view.setInt16(44 + index * bytesPerSample, sample * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:audio/wav;base64,${encodeBase64(binary)}`;
}

export function resolveMockAssetUri(
  uri: string | null | undefined,
): string | undefined {
  if (!uri) {
    return undefined;
  }

  if (!isMockAssetUri(uri)) {
    return uri;
  }

  const cached = cachedDataUrls.get(uri);

  if (cached) {
    return cached;
  }

  const dataUrl = makeMockWavDataUrl(uri);
  cachedDataUrls.set(uri, dataUrl);

  return dataUrl;
}
