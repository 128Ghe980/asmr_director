import type { TimelineClip } from "./schema";
import type { VoicePack } from "./voice-pack";

export type GptSovitsRequest = {
  text: string;
  text_lang: string;
  ref_audio_path: string;
  prompt_text: string;
  prompt_lang: string;
  top_k: number;
  top_p: number;
  temperature: number;
  text_split_method: string;
  batch_size: number;
  batch_threshold: number;
  split_bucket: boolean;
  speed_factor: number;
  fragment_interval: number;
  seed: number;
  media_type: "wav";
  streaming_mode: boolean;
  parallel_infer: boolean;
  repetition_penalty: number;
};

export type RequestGptSovitsWavInput = {
  endpoint: string;
  request: GptSovitsRequest;
  fetchImpl?: typeof fetch;
};

function getTextLanguage(voicePack: VoicePack): string {
  return voicePack.textLanguage === "zh" ? "all_zh" : voicePack.textLanguage;
}

export function buildGptSovitsRequest(
  clip: TimelineClip,
  voicePack: VoicePack,
): GptSovitsRequest {
  if (clip.type !== "voice" || clip.kind === "silent") {
    throw new Error("Only voice clips can use GPT-SoVITS generation");
  }

  return {
    text: clip.text,
    text_lang: getTextLanguage(voicePack),
    ref_audio_path: voicePack.referenceAudio,
    prompt_text: voicePack.promptText,
    prompt_lang: voicePack.promptLanguage,
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
  };
}

export async function requestGptSovitsWav({
  endpoint,
  request,
  fetchImpl = fetch,
}: RequestGptSovitsWavInput): Promise<ArrayBuffer> {
  const response = await fetchImpl(`${endpoint.replace(/\/$/, "")}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GPT-SoVITS request failed: ${message || response.status}`);
  }

  const wav = await response.arrayBuffer();

  if (wav.byteLength === 0) {
    throw new Error("GPT-SoVITS returned empty audio");
  }

  return wav;
}
