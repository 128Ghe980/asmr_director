import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import { analyzeVoiceGroup, VoiceGroupAnalysisError } from "./voice-group-analysis";
import { VoiceRecognitionSchema, normalizeVoiceSentenceParticleText, type ShortSentenceReview, type VoiceRecognition } from "./voice-recognition";
import type { VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

const unsafe = (recognition?: VoiceRecognition, code = "unsafe_paragraph_boundary") => new VoiceGroupAnalysisError(
  "未能确认整段中每句的安全切分位置；完整原音已保留，请试听。", 422, code, recognition);

/** Locate the PCM payload without decoding/re-encoding its sample values. */
export function paragraphPcmFrames(wav: Uint8Array): { pcm: Uint8Array; frames: number } {
  const decoded = decodePcmWav(wav);
  if (decoded.sampleRate !== 48_000 || decoded.channels !== 1 || !decoded.samples.length || decoded.samples.length > 48_000 * 120) throw unsafe();
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let pcm: Uint8Array | undefined;
  let bits = 0;
  for (let offset = 12; offset + 8 <= wav.byteLength;) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    if (offset + 8 + length > wav.byteLength) throw unsafe();
    if (id === "fmt ") bits = view.getUint16(offset + 8 + 14, true);
    if (id === "data") pcm = wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + length % 2;
  }
  if (bits !== 16 || !pcm?.length || pcm.length % 2) throw unsafe();
  return { pcm, frames: pcm.length / 2 };
}

export function sliceParagraphPcmWav(wav: Uint8Array, startFrame: number, endFrame: number): Uint8Array {
  const { pcm, frames } = paragraphPcmFrames(wav);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame > frames || endFrame <= startFrame) throw unsafe();
  const payload = pcm.subarray(startFrame * 2, endFrame * 2);
  const output = new Uint8Array(44 + payload.length);
  const view = new DataView(output.buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + payload.length, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true); view.setUint32(28, 96_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, payload.length, true); output.set(payload, 44);
  return output;
}

export type ParagraphAudioSegment = {
  clipId: string; text: string; wav: Uint8Array; cutStartSeconds: number; cutEndSeconds: number; recognition?: VoiceRecognition;
  textReview?: ShortSentenceReview;
};

/**
 * Verify each successive opening sentence against the complete remaining text.
 * The analysis WAV may trim/fade edges; only its evidence is used. The returned
 * slices partition the original PCM, including all natural pauses and edges.
 */
export async function splitVoiceParagraph(input: {
  wav: Uint8Array; targets: { clipId: string; text: string }[]; config: LocalRuntimeConfig; signal?: AbortSignal;
  onProgress?: (index: number, total: number) => void;
}, dependencies: { analyze?: typeof analyzeVoiceGroup; runtimeSession?: VoxCpm2RuntimeSession } = {}): Promise<ParagraphAudioSegment[]> {
  input.signal?.throwIfAborted();
  const { frames } = paragraphPcmFrames(input.wav);
  if (!input.targets.length || input.targets.length > 32 || new Set(input.targets.map((target) => target.clipId)).size !== input.targets.length
      || input.targets.some((target) => !target.text.trim() || target.text.length > 500)
      || input.targets.map((target) => target.text).join("").length > 500) throw unsafe();
  const segments: ParagraphAudioSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < input.targets.length; index++) {
    input.signal?.throwIfAborted();
    input.onProgress?.(index, input.targets.length);
    const target = input.targets[index];
    const followingText = input.targets.slice(index + 1).map((target) => target.text).join("");
    const remainder = sliceParagraphPcmWav(input.wav, cursor, frames);
    const analysis = await (dependencies.analyze ?? analyzeVoiceGroup)({ wav: remainder, expectedText: target.text,
      requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true,
      ...(followingText ? { followingText } : {}), clauses: [target.text], config: input.config, signal: input.signal },
    // Paragraph splitting is fully local; do not invoke the optional semantic
    // API fallback inherited from context-window generation.
    { runtimeSession: dependencies.runtimeSession, env: {} });
    input.signal?.throwIfAborted();
    if (analysis.recognition?.stage !== "complete") throw unsafe(analysis.recognition, "paragraph_recognition_incomplete");
    if (analysis.recognition.expectedText !== target.text || (analysis.recognition.followingText ?? "") !== followingText) {
      throw unsafe(analysis.recognition, "paragraph_recognition_source_mismatch");
    }
    const particleEvidence = analysis.recognition.contentComparison?.mode === "sentence_particle";
    const particleSafe = particleEvidence && VoiceRecognitionSchema.safeParse(analysis.recognition).success
      && analysis.recognition.contentComparison?.mode === "sentence_particle"
      && normalizeVoiceSentenceParticleText(analysis.transcript) === analysis.recognition.contentComparison.recognized
      && Math.abs(analysis.coverage - analysis.recognition.contentComparison.similarity) < .000001;
    const textReview = analysis.recognition.shortSentenceReview;
    const textReviewSafe = Boolean(textReview) && VoiceRecognitionSchema.safeParse(analysis.recognition).success
      && textReview?.final.transcript === analysis.transcript && Math.abs(analysis.coverage - textReview.similarity) < .000001;
    if ((analysis.coverage < .9 && !particleSafe && !textReviewSafe) || (particleEvidence && !particleSafe)
        || (textReview && !textReviewSafe)) throw unsafe(analysis.recognition, "paragraph_content_below_threshold");
    if (analysis.recognition.followingPhoneticBoundary && !VoiceRecognitionSchema.safeParse(analysis.recognition).success) {
      throw unsafe(analysis.recognition, "paragraph_following_phonetic_evidence_invalid");
    }
    let end = frames;
    if (followingText) {
      const quiet = analysis.cutValidation;
      if (!quiet || quiet.quietEndSeconds - quiet.quietStartSeconds < .16 - 1 / 48_000
          || analysis.cutEndSeconds < quiet.quietStartSeconds || analysis.cutEndSeconds > quiet.quietEndSeconds + 1 / 48_000) throw unsafe(analysis.recognition);
      const quietStart = Math.ceil(quiet.quietStartSeconds * 48_000);
      const quietEnd = Math.floor(quiet.quietEndSeconds * 48_000);
      const decoded = decodePcmWav(remainder);
      if (quietStart < 0 || quietEnd > decoded.samples.length || quietEnd <= quietStart) throw unsafe(analysis.recognition);
      // Independently confirm the reported quiet interval on the native PCM.
      // Keep the same frame RMS criterion used by the offline verifier.
      const threshold = 10 ** (quiet.thresholdDbfs / 20);
      for (let offset = quietStart; offset < quietEnd; offset += 480) {
        const stop = Math.min(offset + 480, quietEnd);
        let sum = 0;
        for (let frame = offset; frame < stop; frame++) sum += decoded.samples[frame] ** 2;
        if (Math.sqrt(sum / (stop - offset)) > threshold + 1e-7) throw unsafe(analysis.recognition);
      }
      // Retain the analyzer's verified cut, avoiding a different ASR boundary.
      end = cursor + Math.round(analysis.cutEndSeconds * 48_000);
      if (end <= cursor || end >= frames) throw unsafe(analysis.recognition);
    }
    segments.push({ clipId: target.clipId, text: target.text, wav: sliceParagraphPcmWav(input.wav, cursor, end),
      cutStartSeconds: cursor / 48_000, cutEndSeconds: end / 48_000, recognition: analysis.recognition,
      ...(textReview ? { textReview } : {}) });
    cursor = end;
  }
  if (cursor !== frames) throw unsafe();
  return segments;
}
