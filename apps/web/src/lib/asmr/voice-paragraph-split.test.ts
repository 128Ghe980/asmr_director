import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { paragraphPcmFrames, sliceParagraphPcmWav, splitVoiceParagraph } from "./voice-paragraph-split";

const config = getLocalRuntimeConfig();
const targets = [{ clipId: "a", text: "先坐下吧。" }, { clipId: "b", text: "我替你倒杯茶。" }];
function source() {
  const samples = new Float32Array(96_000);
  for (let i = 9600; i < 38_400; i++) samples[i] = Math.sin(i / 7) * .02;
  for (let i = 57_600; i < 86_400; i++) samples[i] = Math.sin(i / 13) * .015;
  return writePcm16Wav(samples, 48_000);
}
function analysis(input: { wav: Uint8Array; expectedText: string; followingText?: string }, transcript = input.expectedText, coverage = 1): VoiceGroupAnalysis {
  const following = Boolean(input.followingText);
  const frames = paragraphPcmFrames(input.wav).frames;
  const end = following ? 48_000 : frames;
  return {
    wav: sliceParagraphPcmWav(input.wav, 0, end), transcript, coverage,
    internalPausesMs: [], leadingQuietMs: 200, trailingQuietMs: 200,
    cutStartSeconds: 0, cutEndSeconds: end / 48_000, asrModel: "faster-whisper-large-v3/cpu/int8",
    recognition: {
      analysisMode: "cutting_only", stage: "complete", expectedText: input.expectedText,
      followingText: input.followingText ?? "", sourceTranscript: transcript + (input.followingText ?? ""),
      targetTranscript: transcript, sourceWords: [{ text: transcript, start: .2, end: .72 },
        ...(following ? [{ text: input.followingText!, start: 1.28, end: 1.7 }] : [])],
    },
    boundaryOnly: { method: following ? "ordered_word_boundary" : "whole_recording",
      alignmentSimilarity: coverage, targetEndWordIndex: 0, contentVerified: false, internalPausePositions: [],
      ...(following ? { followingStartWordIndex: 1 } : {}) },
    ...(following ? { cutValidation: { method: "two_sided" as const, thresholdDbfs: -68,
      quietStartSeconds: .8, quietEndSeconds: 1.2 } } : {}),
  };
}

describe("cutting-only paragraph PCM splitting", () => {
  it("partitions the original PCM and every natural pause without text certification or extra confirmation", async () => {
    const wav = source();
    const analyze = vi.fn(async input => analysis(input));
    const segments = await splitVoiceParagraph({ wav, targets, config }, { analyze });
    expect(segments.map(segment => [segment.cutStartSeconds, segment.cutEndSeconds])).toEqual([[0, 1], [1, 2]]);
    expect(Buffer.concat(segments.map(segment => Buffer.from(paragraphPcmFrames(segment.wav).pcm))))
      .toEqual(Buffer.from(paragraphPcmFrames(wav).pcm));
    expect(paragraphPcmFrames(analyze.mock.calls[1][0].wav).pcm)
      .toEqual(paragraphPcmFrames(sliceParagraphPcmWav(wav, 48_000, 96_000)).pcm);
    expect(segments.every(segment => !segment.textReview && !segment.recognition?.contentComparison)).toBe(true);
  });

  it.each([
    { expected: "回来啦。", actual: "回来", coverage: 2 / 3 },
    { expected: "坐在这边。", actual: "做在这别", coverage: .5 },
    { expected: "给你擦暖和。", actual: "给你擦暖合", coverage: .6 },
    { expected: "这里有完整的源文。", actual: "完全不同的识别词", coverage: 0 },
  ])("does not block a located quiet cut for $expected -> $actual at $coverage", async ({ expected, actual, coverage }) => {
    const changed = [{ ...targets[0], text: expected }, targets[1]];
    const analyze = vi.fn(async input => analysis(input, input.followingText ? actual : input.expectedText, coverage));
    const segments = await splitVoiceParagraph({ wav: source(), targets: changed, config }, { analyze });
    expect(segments).toHaveLength(2);
    expect(segments[0].recognition?.targetTranscript).toBe(actual);
    expect(segments[0].textReview).toBeUndefined();
    expect(segments[0].recognition?.shortSentenceReview).toBeUndefined();
  });

  it("accepts a real quiet boundary when ASR timestamps lie just below a decimal frame edge", async () => {
    const analyze = vi.fn(async input => {
      const result = analysis(input);
      if (input.followingText) result.recognition!.sourceWords![1].start = 1.2799999999999986;
      return result;
    });
    const segments = await splitVoiceParagraph({ wav: source(), targets, config }, { analyze });
    expect(segments[0].cutEndSeconds).toBe(1);
  });

  it("accepts a guarded real-quiet subinterval without selecting the Python region again", async () => {
    const analyze = vi.fn(async input => {
      const result = analysis(input);
      if (input.followingText) result.cutValidation = { method: "two_sided", thresholdDbfs: -68,
        quietStartSeconds: .84, quietEndSeconds: 1.16 };
      return result;
    });
    const segments = await splitVoiceParagraph({ wav: source(), targets, config }, { analyze });
    expect(segments[0].cutEndSeconds).toBe(1);
  });

  it.each(["left", "right"])("corrects quiet swallowed only by the %s single-character word", async side => {
    const analyze = vi.fn(async input => {
      const result = analysis(input);
      if (input.followingText) {
        if (side === "right") result.recognition!.sourceWords![1] = { text: "我", start: .72, end: 1.7 };
        else {
          result.transcript = result.recognition!.targetTranscript = "坐";
          result.recognition!.sourceWords![0] = { text: "坐", start: .2, end: 1.08 };
        }
      }
      return result;
    });
    const segments = await splitVoiceParagraph({ wav: source(), targets, config }, { analyze });
    expect(segments[0].cutEndSeconds).toBe(1);
  });

  it.each(["left", "right"])("never expands into the %s multi-character word to use its internal quiet", async side => {
    const analyze = vi.fn(async input => {
      const result = analysis(input);
      if (side === "left") {
        result.recognition!.sourceWords![0].end = 1.08;
        result.recognition!.sourceWords![1] = { text: "我", start: 1.08, end: 1.7 };
      } else {
        result.transcript = result.recognition!.targetTranscript = "坐";
        result.recognition!.sourceWords![0] = { text: "坐", start: .2, end: .72 };
        result.recognition!.sourceWords![1].start = .72;
      }
      return result;
    });
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze })).rejects.toBeInstanceOf(VoiceGroupAnalysisError);
  });
  it("retains a complete final recording with empty ASR and valid silent PCM", async () => {
    const wav = writePcm16Wav(new Float32Array(48_000), 48_000);
    const analyze = vi.fn(async input => ({ ...analysis(input, "", 0), leadingQuietMs: 1000, trailingQuietMs: 0,
      recognition: { analysisMode: "cutting_only" as const, stage: "complete" as const,
        expectedText: input.expectedText, sourceTranscript: "", sourceWords: [], targetTranscript: "" },
      boundaryOnly: { method: "whole_recording" as const, alignmentSimilarity: 0,
        targetEndWordIndex: -1, contentVerified: false as const, internalPausePositions: [] } }));
    const segments = await splitVoiceParagraph({ wav, targets: [targets[0]], config }, { analyze });
    expect(paragraphPcmFrames(segments[0].wav).pcm).toEqual(paragraphPcmFrames(wav).pcm);
  });

  it.each([
    "missing_protocol", "missing_boundary", "bad_index", "nonadjacent", "wrong_request", "bad_quiet", "changed_pcm",
  ])("rejects unsafe or unbound evidence: %s", async kind => {
    const analyze = vi.fn(async input => {
      const result = analysis(input);
      if (kind === "missing_protocol") delete result.recognition!.analysisMode;
      if (kind === "missing_boundary") delete result.boundaryOnly;
      if (kind === "bad_index") result.boundaryOnly!.targetEndWordIndex = 4;
      if (kind === "nonadjacent") result.boundaryOnly!.followingStartWordIndex = 3;
      if (kind === "wrong_request") result.recognition!.expectedText = "另一条台词。";
      if (kind === "bad_quiet") result.cutValidation!.quietStartSeconds = .95;
      if (kind === "changed_pcm") result.wav = writePcm16Wav(new Float32Array(48_000).fill(.01), 48_000);
      return result;
    });
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze })).rejects.toBeInstanceOf(VoiceGroupAnalysisError);
  });

  it("independently refuses reported silence that contains original speech", async () => {
    const wav = writePcm16Wav(new Float32Array(96_000).fill(.02), 48_000);
    await expect(splitVoiceParagraph({ wav, targets, config }, { analyze: async input => analysis(input) }))
      .rejects.toBeInstanceOf(VoiceGroupAnalysisError);
  });
  it("does not publish partial slices when a later boundary cannot be located", async () => {
    const analyze = vi.fn().mockImplementationOnce(async input => analysis(input))
      .mockRejectedValueOnce(new VoiceGroupAnalysisError("切点无法定位", 422, "boundary_unlocatable"));
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze }))
      .rejects.toMatchObject({ diagnosticCode: "boundary_unlocatable" });
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it("stops after cancellation without starting a later sentence", async () => {
    const controller = new AbortController();
    const analyze = vi.fn(async input => { controller.abort(); return analysis(input); });
    await expect(splitVoiceParagraph({ wav: source(), targets, config, signal: controller.signal }, { analyze })).rejects.toThrow();
    expect(analyze).toHaveBeenCalledOnce();
  });
});
