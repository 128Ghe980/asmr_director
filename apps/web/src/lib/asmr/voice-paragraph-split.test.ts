import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { paragraphPcmFrames, sliceParagraphPcmWav, splitVoiceParagraph } from "./voice-paragraph-split";

const config = getLocalRuntimeConfig();
const targets = [{ clipId: "a", text: "先坐下吧。" }, { clipId: "b", text: "我替你倒杯茶。" }];
function source() {
  const samples = new Float32Array(96_000);
  for (let i = 9600; i < 33_600; i++) samples[i] = Math.sin(i / 7) * .071;
  for (let i = 57_600; i < 81_600; i++) samples[i] = Math.sin(i / 13) * .039;
  return writePcm16Wav(samples, 48_000);
}
function analysis(expectedText: string, followingText = ""): VoiceGroupAnalysis {
  return { wav: source(), internalPausesMs: [], leadingQuietMs: 0, trailingQuietMs: 0,
    transcript: expectedText, coverage: 1, cutStartSeconds: .02, cutEndSeconds: 1, asrModel: "faster-whisper-large-v3/cpu/int8",
    recognition: { stage: "complete", expectedText, followingText, sourceTranscript: expectedText + followingText, targetTranscript: expectedText },
    ...(followingText ? { cutValidation: { method: "two_sided" as const, thresholdDbfs: -60, quietStartSeconds: .9, quietEndSeconds: 1.1 } } : {}) };
}

describe("whole paragraph PCM splitting", () => {
  it("checks every target against all remaining text and partitions exact native bytes including quiet edges", async () => {
    const wav = source();
    const analyze = vi.fn(async (input) => analysis(input.expectedText, input.followingText));
    const segments = await splitVoiceParagraph({ wav, targets, config }, { analyze });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0][0]).toMatchObject({ expectedText: targets[0].text, followingText: targets[1].text, clauses: [targets[0].text] });
    expect(analyze.mock.calls[1][0].followingText).toBeUndefined();
    expect(segments.map((segment) => [segment.cutStartSeconds, segment.cutEndSeconds])).toEqual([[0, 1], [1, 2]]);
    expect(Buffer.concat(segments.map((segment) => Buffer.from(paragraphPcmFrames(segment.wav).pcm))))
      .toEqual(Buffer.from(paragraphPcmFrames(wav).pcm));
    expect(paragraphPcmFrames(analyze.mock.calls[1][0].wav).pcm).toEqual(paragraphPcmFrames(sliceParagraphPcmWav(wav, 48_000, 96_000)).pcm);
  });
  it("refuses ASR timestamp suggestions that do not have a verified quiet interval", async () => {
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze: async (input) => ({ ...analysis(input.expectedText, input.followingText), cutValidation: undefined }) })).rejects.toMatchObject({ diagnosticCode: "unsafe_paragraph_boundary" });
  });
  it("accepts only validated final-particle evidence while retaining the real short-sentence literal score", async () => {
    const shortTargets = [{ clipId: "a", text: "回来啦。" }, targets[1]];
    const comparison = { mode: "sentence_particle" as const, status: "different" as const, similarity: .666667, threshold: .9 as const,
      substitutionCount: 1 as const, expected: "回来啦", recognized: "回来了", sourcePrefix: "回来了", acceptanceRule: "exact_prefix_final_particle" as const,
      differences: [{ index: 2, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle" as const, clauseEnd: true as const }] };
    const make = (input: { expectedText: string; followingText?: string }) => input.expectedText === "回来啦。" ? {
      ...analysis(input.expectedText, input.followingText), transcript: "回来了", coverage: .666667,
      recognition: { stage: "complete" as const, expectedText: input.expectedText, followingText: input.followingText ?? "",
        sourceTranscript: "回来了" + input.followingText, sourceWords: [{ text: "回来", start: .2, end: .5 }, { text: "了", start: .5, end: .7 },
          { text: input.followingText!, start: 1.2, end: 1.7 }], targetTranscript: "回来了", contentComparison: comparison },
    } : analysis(input.expectedText, input.followingText);
    const analyze = vi.fn(async (input) => make(input));
    const segments = await splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze });
    expect(analyze.mock.calls[0][0]).toMatchObject({ requireTwoSided: true, allowShortSentenceParticle: true });
    expect(segments[0].recognition?.contentComparison?.similarity).toBe(.666667);
    expect(Buffer.concat(segments.map((segment) => Buffer.from(paragraphPcmFrames(segment.wav).pcm)))).toEqual(Buffer.from(paragraphPcmFrames(source()).pcm));
    await expect(splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze: async (input) => {
      const result = make(input); if (result.recognition?.contentComparison?.mode === "sentence_particle") result.recognition.contentComparison.sourcePrefix = "回来吧"; return result;
    } })).rejects.toMatchObject({ diagnosticCode: "paragraph_content_below_threshold" });
  });
  it("partitions safe native PCM but explicitly marks an incomplete tiny sentence for manual text confirmation", async () => {
    const shortTargets = [{ clipId: "a", text: "回来啦。" }, targets[1]];
    const window = (transcript: string) => ({ transcript, words: [{ text: transcript, start: .2, end: .6 }], durationSeconds: 1 });
    const review = { status: "needs_confirmation" as const, reason: "missing_final_particle" as const,
      expected: "回来啦", sourcePrefix: "回来了", expectedPinyin: "la5" as const, sourcePinyin: "le5" as const,
      similarity: .666667, left: window("回来"), right: window(targets[1].text), final: window("回来") };
    const measured = { ...analysis(shortTargets[0].text, targets[1].text), transcript: "回来", coverage: .666667,
      recognition: { stage: "complete" as const, expectedText: shortTargets[0].text, followingText: targets[1].text,
        sourceTranscript: "回来了" + targets[1].text, sourceWords: [{ text: "回来了", start: .2, end: .6 }, { text: targets[1].text, start: 1.2, end: 1.7 }],
        targetTranscript: "回来", shortSentenceReview: review } };
    const analyze = vi.fn(async input => input.expectedText === "回来啦。" ? measured : analysis(input.expectedText, input.followingText));
    const segments = await splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0][0]).toMatchObject({ requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true });
    expect(segments[0].textReview).toEqual(review);
    expect(segments[0].textReview).toBe(segments[0].recognition?.shortSentenceReview);
    expect(segments[0].recognition?.targetTranscript).toBe("回来");
    expect(segments[0].recognition?.contentComparison).toBeUndefined();
    expect(segments[1].textReview).toBeUndefined();
    expect(Buffer.concat(segments.map(segment => Buffer.from(paragraphPcmFrames(segment.wav).pcm)))).toEqual(Buffer.from(paragraphPcmFrames(source()).pcm));
    await expect(splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze: async input => input.expectedText === "回来啦。"
      ? { ...measured, coverage: 1 } : analysis(input.expectedText, input.followingText) })).rejects.toMatchObject({ diagnosticCode: "paragraph_content_below_threshold" });
    await expect(splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze: async input => input.expectedText === "回来啦。"
      ? { ...measured, recognition: { ...measured.recognition, shortSentenceReview: undefined } } : analysis(input.expectedText, input.followingText) }))
      .rejects.toMatchObject({ diagnosticCode: "paragraph_content_below_threshold" });
    const audible = writePcm16Wav(new Float32Array(96_000).fill(.05), 48_000);
    await expect(splitVoiceParagraph({ wav: audible, targets: shortTargets, config }, { analyze })).rejects.toMatchObject({ diagnosticCode: "unsafe_paragraph_boundary" });
    const laterFailure = vi.fn().mockResolvedValueOnce(measured).mockRejectedValueOnce(new VoiceGroupAnalysisError("后句失败", 422, "cut_text_mismatch"));
    await expect(splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze: laterFailure })).rejects.toMatchObject({ diagnosticCode: "cut_text_mismatch" });
  });
  it("keeps a reviewed final remainder without inventing a new final cut or left/right evidence", async () => {
    const shortTargets = [targets[0], { clipId: "b", text: "回来啦。" }];
    const final = { transcript: "回来", words: [{ text: "回来", start: .2, end: .6 }], durationSeconds: 1 };
    const review = { status: "needs_confirmation" as const, reason: "missing_final_particle" as const,
      expected: "回来啦", sourcePrefix: "回来了", expectedPinyin: "la5" as const, sourcePinyin: "le5" as const, similarity: .666667, final };
    const analyze = vi.fn(async input => input.expectedText === "回来啦。" ? { ...analysis(input.expectedText, input.followingText), transcript: "回来", coverage: .666667,
      recognition: { stage: "complete" as const, expectedText: input.expectedText, followingText: "", sourceTranscript: "回来了",
        sourceWords: [{ text: "回来了", start: .2, end: .6 }], targetTranscript: "回来", shortSentenceReview: review } } : analysis(input.expectedText, input.followingText));
    const segments = await splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze });
    expect(segments[1].textReview).toEqual(review);
    expect(segments.map(segment => [segment.cutStartSeconds, segment.cutEndSeconds])).toEqual([[0, 1], [1, 2]]);
    expect(Buffer.concat(segments.map(segment => Buffer.from(paragraphPcmFrames(segment.wav).pcm)))).toEqual(Buffer.from(paragraphPcmFrames(source()).pcm));
  });
  it("keeps exact native coverage with independently proven right homophone and a reviewed final short sentence", async () => {
    const current = "鞋也换了吧，别把寒气带进来。", expected = "过来坐炉子边暖和", variant = "过来做炉子边暖和";
    const shortTargets = [{ clipId: "a", text: current }, { clipId: "b", text: "过来坐，炉子边暖和。" }];
    const difference = { index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" as const };
    const window = { transcript: variant, words: [{ text: variant, start: .2, end: .6 }], durationSeconds: 1 };
    const boundary = { expected, recognized: variant, sourceWordIndex: 1, difference, right: window };
    const first = { ...analysis(current, shortTargets[1].text), recognition: { stage: "complete" as const, expectedText: current,
      followingText: shortTargets[1].text, sourceTranscript: current + expected,
      sourceWords: [{ text: current, start: .2, end: .6 }, { text: expected, start: 1.2, end: 1.7 }], targetTranscript: current,
      contentComparison: { status: "matched" as const, similarity: 1, threshold: .9 as const, substitutionCount: 0,
        expected: "鞋也换了吧别把寒气带进来", recognized: "鞋也换了吧别把寒气带进来" }, followingPhoneticBoundary: boundary } };
    const review = { status: "needs_confirmation" as const, reason: "same_tone_substitution" as const, expected, sourcePrefix: expected,
      similarity: .875, differences: [difference], final: window };
    const second = { ...analysis(shortTargets[1].text), coverage: .875, transcript: variant,
      recognition: { stage: "complete" as const, expectedText: shortTargets[1].text, followingText: "", sourceTranscript: expected,
        sourceWords: [{ text: expected, start: .2, end: .6 }], targetTranscript: variant, shortSentenceReview: review } };
    const analyze = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const segments = await splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze });
    expect(segments[0].recognition?.followingPhoneticBoundary).toEqual(boundary);
    expect(segments[0].textReview).toBeUndefined();
    expect(segments[1].textReview).toEqual(review);
    expect(segments[1].recognition?.targetTranscript).toBe(variant);
    expect(segments[1].recognition?.contentComparison).toBeUndefined();
    expect(Buffer.concat(segments.map(segment => Buffer.from(paragraphPcmFrames(segment.wav).pcm)))).toEqual(Buffer.from(paragraphPcmFrames(source()).pcm));
    const forged = { ...first, recognition: { ...first.recognition, followingPhoneticBoundary: { ...boundary, sourceWordIndex: 2 } } };
    await expect(splitVoiceParagraph({ wav: source(), targets: shortTargets, config }, { analyze: async () => forged }))
      .rejects.toMatchObject({ diagnosticCode: "paragraph_following_phonetic_evidence_invalid" });
  });
  it("independently rejects a claimed quiet boundary crossing audible original PCM", async () => {
    const wav = writePcm16Wav(new Float32Array(96_000).fill(.05), 48_000);
    await expect(splitVoiceParagraph({ wav, targets, config }, { analyze: async (input) => analysis(input.expectedText, input.followingText) })).rejects.toMatchObject({ diagnosticCode: "unsafe_paragraph_boundary" });
  });
  it("does not return partial cuts when a later sentence cannot be verified", async () => {
    const analyze = vi.fn().mockImplementationOnce(async (input) => analysis(input.expectedText, input.followingText))
      .mockRejectedValueOnce(new VoiceGroupAnalysisError("识别失败", 422, "cut_text_mismatch"));
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze })).rejects.toMatchObject({ diagnosticCode: "cut_text_mismatch" });
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it("stops immediately after cancellation during alignment", async () => {
    const controller = new AbortController();
    const analyze = vi.fn(async (input) => { controller.abort(); return analysis(input.expectedText, input.followingText); });
    await expect(splitVoiceParagraph({ wav: source(), targets, config, signal: controller.signal }, { analyze })).rejects.toThrow();
    expect(analyze).toHaveBeenCalledOnce();
  });
  it.each([
    { code: "paragraph_recognition_incomplete", stage: "target_validation" as const },
    { code: "paragraph_recognition_source_mismatch", expectedText: "另一条台词。" },
    { code: "paragraph_content_below_threshold", coverage: .85 },
  ])("retains recognition evidence when the $code guard refuses a cut", async (change) => {
    const result = analysis(targets[0].text, targets[1].text);
    if (change.stage !== undefined) result.recognition!.stage = change.stage;
    if (change.expectedText !== undefined) result.recognition!.expectedText = change.expectedText;
    if (change.coverage !== undefined) result.coverage = change.coverage;
    await expect(splitVoiceParagraph({ wav: source(), targets, config }, { analyze: async () => result })).rejects.toMatchObject({
      diagnosticCode: change.code, recognition: result.recognition,
    });
  });
});
