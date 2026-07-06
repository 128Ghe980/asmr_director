import { describe, expect, it } from "vitest";

import { demoProject } from "./mock-project";
import {
  canRenderProceduralClip,
  renderProceduralClipWav,
} from "./procedural-audio";
import type { TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function findClip(clipId: string): TimelineClip {
  const clip = flattenClips(demoProject).find(
    (candidate) => candidate.id === clipId,
  );

  if (!clip) {
    throw new Error(`Missing fixture clip ${clipId}`);
  }

  return clip;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder("ascii").decode(bytes.slice(start, end));
}

describe("procedural audio renderer", () => {
  it("renders a breath clip as a 32 kHz mono PCM WAV", () => {
    const clip = findClip("breath_001");
    const wav = renderProceduralClipWav({ clip, sampleRate: 32000 });

    expect(canRenderProceduralClip(clip)).toBe(true);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 12)).toBe("WAVE");
    expect(ascii(wav, 12, 16)).toBe("fmt ");
    expect(ascii(wav, 36, 40)).toBe("data");
    expect(wav.byteLength).toBe(44 + Math.ceil(clip.duration * 32000) * 2);
  });

  it("renders deterministic output for the same clip seed", () => {
    const clip = findClip("sfx_blanket_001");

    const first = renderProceduralClipWav({ clip });
    const second = renderProceduralClipWav({ clip });

    expect(first).toEqual(second);
  });

  it("uses clip seeds and classes to vary generated audio", () => {
    const firstSfx = renderProceduralClipWav({
      clip: findClip("sfx_blanket_001"),
    });
    const secondSfx = renderProceduralClipWav({
      clip: findClip("sfx_cloth_001"),
    });
    const ambience = renderProceduralClipWav({
      clip: { ...findClip("ambience_rain_001"), duration: 1 },
    });

    expect(firstSfx).not.toEqual(secondSfx);
    expect(firstSfx).not.toEqual(ambience);
  });

  it("rejects voice clips", () => {
    const clip = findClip("voice_001");

    expect(canRenderProceduralClip(clip)).toBe(false);
    expect(() => renderProceduralClipWav({ clip })).toThrow(
      "Unsupported procedural clip type",
    );
  });
});
