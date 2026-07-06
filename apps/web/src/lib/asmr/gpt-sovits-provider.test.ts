import { describe, expect, it, vi } from "vitest";

import {
  buildGptSovitsRequest,
  requestGptSovitsWav,
  type GptSovitsRequest,
} from "./gpt-sovits-provider";
import { demoProject } from "./mock-project";
import type { TimelineClip } from "./schema";
import { flattenClips } from "./view-model";
import type { VoicePack } from "./voice-pack";

const voicePack: VoicePack = {
  id: "default",
  displayName: "Default Voice",
  provider: "gpt-sovits",
  endpoint: "http://127.0.0.1:9880",
  referenceAudio: "D:\\runtime\\voice-packs\\default\\reference.wav",
  promptTextPath: "D:\\runtime\\voice-packs\\default\\prompt.txt",
  promptText: "助けてくれたのかな",
  promptLanguage: "ja",
  textLanguage: "zh",
  licenseStatus: "user_confirmed",
  consentConfirmedAt: "2026-07-01T00:00:00.000Z",
};

function findClip(clipId: string): TimelineClip {
  const clip = flattenClips(demoProject).find(
    (candidate) => candidate.id === clipId,
  );

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

describe("GPT-SoVITS provider", () => {
  it("builds a conservative GPT-SoVITS request from a voice clip", () => {
    expect(buildGptSovitsRequest(findClip("voice_001"), voicePack)).toEqual({
      text: "你还没睡吗？没关系，我陪你一会儿。",
      text_lang: "all_zh",
      ref_audio_path: "D:\\runtime\\voice-packs\\default\\reference.wav",
      prompt_text: "助けてくれたのかな",
      prompt_lang: "ja",
      top_k: 15,
      top_p: 1,
      temperature: 1,
      text_split_method: "cut5",
      batch_size: 1,
      batch_threshold: 0.75,
      split_bucket: false,
      speed_factor: 0.86,
      fragment_interval: 0.3,
      seed: -1,
      media_type: "wav",
      streaming_mode: false,
      parallel_infer: false,
      repetition_penalty: 1.35,
    });
  });

  it("rejects non-voice clips", () => {
    expect(() => buildGptSovitsRequest(findClip("sfx_blanket_001"), voicePack))
      .toThrow("Only voice clips can use GPT-SoVITS generation");
  });

  it("posts UTF-8 JSON to the GPT-SoVITS TTS endpoint", async () => {
    const wav = new Uint8Array([82, 73, 70, 70]);
    const fetchImpl = vi.fn(async () => new Response(wav));
    const request: GptSovitsRequest = buildGptSovitsRequest(
      findClip("voice_001"),
      voicePack,
    );

    await expect(
      requestGptSovitsWav({
        endpoint: "http://127.0.0.1:9880/",
        request,
        fetchImpl,
      }),
    ).resolves.toEqual(wav.buffer);

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:9880/tts", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
    });
  });

  it("throws a provider failure for non-2xx responses", async () => {
    const request: GptSovitsRequest = buildGptSovitsRequest(
      findClip("voice_001"),
      voicePack,
    );
    const fetchImpl = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    );

    await expect(
      requestGptSovitsWav({
        endpoint: "http://127.0.0.1:9880",
        request,
        fetchImpl,
      }),
    ).rejects.toThrow("GPT-SoVITS request failed: bad request");
  });
});
