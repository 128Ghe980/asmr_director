import type { TimelineClip } from "./schema";

export type ProceduralClip = Extract<
  TimelineClip,
  { type: "breath" | "sfx" | "ambience" }
>;

export type RenderProceduralClipInput = {
  clip: TimelineClip;
  sampleRate?: number;
};

const DEFAULT_SAMPLE_RATE = 32000;
const MIN_FADE_SECONDS = 0.01;

export function canRenderProceduralClip(
  clip: TimelineClip,
): clip is ProceduralClip {
  return (
    clip.type === "breath" ||
    clip.type === "sfx" ||
    clip.type === "ambience"
  );
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function writePcm16MonoWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = clampSample(samples[index]);
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }

  return new Uint8Array(buffer);
}

function hashString(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function makeRandom(seedInput: string): () => number {
  let state = hashString(seedInput) || 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return (state >>> 0) / 4294967296;
  };
}

function gainFromDb(volumeDb: number): number {
  return Math.min(1, Math.pow(10, volumeDb / 20));
}

function getFadeEnvelope(
  index: number,
  totalSamples: number,
  clip: ProceduralClip,
  sampleRate: number,
): number {
  const fadeInSamples = Math.max(
    1,
    Math.ceil(Math.max(clip.fade_in, MIN_FADE_SECONDS) * sampleRate),
  );
  const fadeOutSamples = Math.max(
    1,
    Math.ceil(Math.max(clip.fade_out, MIN_FADE_SECONDS) * sampleRate),
  );
  const fadeIn = Math.min(1, index / fadeInSamples);
  const fadeOut = Math.min(1, (totalSamples - index - 1) / fadeOutSamples);

  return Math.max(0, Math.min(1, fadeIn, fadeOut));
}

function makeSamples(
  clip: ProceduralClip,
  sampleRate: number,
  render: (time: number, random: () => number) => number,
): Float32Array {
  const totalSamples = Math.max(1, Math.ceil(clip.duration * sampleRate));
  const samples = new Float32Array(totalSamples);
  const random = makeRandom(`${clip.id}:${clip.type}:${clip.generation.seed}`);
  const gain = gainFromDb(clip.volume_db);

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / sampleRate;
    const envelope = getFadeEnvelope(index, totalSamples, clip, sampleRate);

    samples[index] = clampSample(render(time, random) * gain * envelope);
  }

  return samples;
}

function renderBreath(clip: ProceduralClip, sampleRate: number): Float32Array {
  let low = 0;
  const cycleSeconds = clip.type === "breath" && clip.breath === "tiny_laugh"
    ? 0.28
    : 1.4;

  return makeSamples(clip, sampleRate, (time, random) => {
    const white = random() * 2 - 1;
    low = low * 0.94 + white * 0.06;
    const phase = (time % cycleSeconds) / cycleSeconds;
    const swell = Math.sin(Math.PI * phase);
    const texture = low * 0.72 + white * 0.08;

    return texture * Math.pow(Math.max(0, swell), 1.6) * 2.4;
  });
}

function isTapLike(label: string): boolean {
  return /tap|knock|hit|click/i.test(label);
}

function renderSfx(clip: ProceduralClip, sampleRate: number): Float32Array {
  if (clip.type !== "sfx") {
    throw new Error("Unsupported procedural clip type");
  }

  if (isTapLike(clip.sfx)) {
    let impulse = 0;

    return makeSamples(clip, sampleRate, (time, random) => {
      const tick = Math.floor(time / 0.22);
      const phase = time - tick * 0.22;

      if (phase < 1 / sampleRate && random() > 0.28) {
        impulse = 1;
      }

      impulse *= 0.82;

      return (random() * 2 - 1) * impulse * 2.8;
    });
  }

  let low = 0;
  let scratch = 0;

  return makeSamples(clip, sampleRate, (time, random) => {
    const white = random() * 2 - 1;
    low = low * 0.82 + white * 0.18;
    scratch = scratch * 0.6 + (white - low) * 0.4;
    const rub = 0.45 + 0.55 * Math.sin(time * Math.PI * 2.1) ** 2;
    const grain = random() > 0.72 ? scratch * 2.2 : scratch * 0.8;

    return (low * 0.45 + grain * 0.55) * rub * 1.8;
  });
}

function renderAmbience(
  clip: ProceduralClip,
  sampleRate: number,
): Float32Array {
  let bed = 0;
  let droplet = 0;

  return makeSamples(clip, sampleRate, (_time, random) => {
    const white = random() * 2 - 1;
    bed = bed * 0.97 + white * 0.03;

    if (random() < 0.0018) {
      droplet += 0.7 + random() * 0.3;
    }

    const tick = (random() * 2 - 1) * droplet;
    droplet *= 0.9;

    return bed * 1.8 + white * 0.09 + tick * 1.1;
  });
}

export function renderProceduralClipWav({
  clip,
  sampleRate = DEFAULT_SAMPLE_RATE,
}: RenderProceduralClipInput): Uint8Array {
  if (!canRenderProceduralClip(clip)) {
    throw new Error("Unsupported procedural clip type");
  }

  const samples =
    clip.type === "breath"
      ? renderBreath(clip, sampleRate)
      : clip.type === "sfx"
        ? renderSfx(clip, sampleRate)
        : renderAmbience(clip, sampleRate);

  return writePcm16MonoWav(samples, sampleRate);
}
