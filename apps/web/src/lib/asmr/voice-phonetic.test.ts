import { describe, expect, it } from "vitest";
import { VoiceContentComparisonSchema, VoiceRecognitionSchema } from "./voice-recognition";
import { getVoiceContentDifferenceWarning } from "./voice-review-warning";

const comparison = {
  mode: "phonetic_substitutions", status: "different", similarity: .818182, threshold: .9,
  phoneticSimilarity: .954545, phoneticThreshold: .95, substitutionCount: 2,
  expected: "来面来啦汤也喝一点暖胃", recognized: "来面来了糖也喝一点暖胃", sourcePrefix: "来面来了汤也喝一点暖胃",
  differences: [
    { index: 3, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true },
    { index: 4, expected: "汤", recognized: "糖", expectedPinyin: "tang1", recognizedPinyin: "tang2", rule: "source_supported_tone", sourceCharacter: "汤" },
  ],
};
const recognition = { stage: "complete", expectedText: "来~~，面来啦！汤也喝一点，暖胃。", sourceTranscript: "来,面来了,汤也喝一点,暖胃。今天是不是又加班了?",
  sourceWords: [{ text: "来,面来了,汤也喝一点,暖胃。", start: .2, end: 4.56 }, { text: "今天是不是又加班了?", start: 5.14, end: 6.94 }],
  followingText: "今天是不是又加班了？", targetTranscript: "来,面来了,糖也喝一点,暖胃", contentComparison: comparison };

describe("bounded phonetic recognition evidence", () => {
  it("retains the actual literal score and separately recomputes the weighted pronunciation score", () => {
    expect(VoiceRecognitionSchema.parse(recognition).contentComparison).toEqual(comparison);
    const parsed = VoiceContentComparisonSchema.parse(comparison);
    expect(getVoiceContentDifferenceWarning(0, parsed)).toBe("第 1 段：已截取目标片段；拼音容错通过（文字 81.8%，拼音得分 95.5%），仍有识别字差，请试听确认。");
  });

  it.each([
    { ...comparison, similarity: 1 }, { ...comparison, phoneticSimilarity: 1 },
    { ...comparison, threshold: .8 }, { ...comparison, phoneticThreshold: .9 },
    { ...comparison, status: "matched" }, { ...comparison, substitutionCount: 1 },
    { ...comparison, recognized: comparison.recognized + "啊" },
    { ...comparison, recognized: comparison.recognized.slice(1) },
    { ...comparison, sourcePrefix: comparison.recognized },
    { ...comparison, differences: comparison.differences.slice(1) },
    { ...comparison, differences: [...comparison.differences].reverse() },
    { ...comparison, differences: [comparison.differences[0], { ...comparison.differences[1], sourceCharacter: "糖" }] },
    { ...comparison, differences: [comparison.differences[0], { ...comparison.differences[1], recognizedPinyin: "ta2" }] },
    { ...comparison, differences: [{ ...comparison.differences[0], clauseEnd: false }, comparison.differences[1]] },
    { ...comparison, differences: [{ ...comparison.differences[0], expectedPinyin: "la1" }, comparison.differences[1]] },
    { ...comparison, differences: [{ ...comparison.differences[0], rule: "same_tone" }, comparison.differences[1]] },
    { ...comparison, privateModelPath: "I:/private" },
  ])("rejects contradictory, incomplete or unsupported evidence %#", invalid => {
    expect(VoiceContentComparisonSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires a particle's actual clause-ending position, beyond its serialized flag", () => {
    expect(VoiceRecognitionSchema.safeParse({ ...recognition, expectedText: "来面来啦汤也喝一点暖胃。" }).success).toBe(false);
    expect(VoiceRecognitionSchema.safeParse({ ...recognition, expectedText: "来～～，面来啦!汤也喝一点，暖胃。" }).success).toBe(true);
  });

  it.each([
    { ...recognition, sourceWords: undefined }, { ...recognition, sourceWords: [{ text: "无关台词", start: .2, end: 4.5 }] },
    { ...recognition, sourceWords: [{ text: recognition.sourceTranscript, start: .2, end: 7 }] },
    { ...recognition, sourceTranscript: "无关内容" }, { ...recognition, targetTranscript: "汤也喝一点" },
    { ...recognition, targetTranscript: undefined }, { ...recognition, expectedText: "这是另一个目标句子。" },
  ])("binds all pronunciation evidence to this source and cropped transcript %#", invalid => {
    expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("does not reinterpret the existing ninety/ eighty-five-percent modes", () => {
    const ordinary = { status: "different", similarity: .9, threshold: .9, substitutionCount: 1,
      expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" };
    expect(VoiceContentComparisonSchema.parse(ordinary)).toEqual(ordinary);
    expect(VoiceContentComparisonSchema.safeParse({ ...ordinary, expected: comparison.expected, recognized: comparison.recognized, substitutionCount: 2, similarity: .818182 }).success).toBe(false);
  });

  it("rejects protected number and negation substitutions even with identical asserted pinyin", () => {
    for (const expectedCharacter of ["不", "没", "勿", "一", "十", "两", "壹", "贰", "叁", "廿", "卅"]) {
      const expected = expectedCharacter + "甲".repeat(19), recognized = "乙" + "甲".repeat(19);
      expect(VoiceContentComparisonSchema.safeParse({ ...comparison, expected, recognized, sourcePrefix: expected,
        substitutionCount: 1, similarity: .95, phoneticSimilarity: 1,
        differences: [{ index: 0, expected: expectedCharacter, recognized: "乙", expectedPinyin: "yi1", recognizedPinyin: "yi1", rule: "same_tone" }],
      }).success).toBe(false);
    }
  });
});

const particleComparison = {
  mode: "sentence_particle", status: "different", similarity: .666667, threshold: .9,
  substitutionCount: 1, acceptanceRule: "exact_prefix_final_particle",
  expected: "回来啦", recognized: "回来了", sourcePrefix: "回来了",
  differences: [{ index: 2, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true }],
};
const particleRecognition = { stage: "complete", expectedText: "回来啦。", followingText: "外面冷吗？",
  sourceTranscript: "回来了。外面冷吗？", sourceWords: [{ text: "回来了。", start: .2, end: .6 }, { text: "外面冷吗？", start: 1.1, end: 1.5 }],
  targetTranscript: "回来了。", contentComparison: particleComparison };

describe("short final neutral particle evidence", () => {
  it("records the actual short literal score and a separate explicit acceptance rule", () => {
    const result = VoiceRecognitionSchema.parse(particleRecognition);
    expect(result.contentComparison).toEqual(particleComparison);
    expect(result.contentComparison).not.toHaveProperty("phoneticSimilarity");
    expect(result.contentComparison).not.toHaveProperty("phoneticThreshold");
    const reverse = { ...particleComparison, expected: "回来了", recognized: "回来啦", sourcePrefix: "回来了",
      differences: [{ ...particleComparison.differences[0], expected: "了", recognized: "啦", expectedPinyin: "le5", recognizedPinyin: "la5" }] };
    expect(VoiceRecognitionSchema.safeParse({ ...particleRecognition, expectedText: "回来了！", targetTranscript: "回来啦。", contentComparison: reverse }).success).toBe(true);
  });

  it.each([
    { ...particleComparison, similarity: 1 }, { ...particleComparison, threshold: .6 },
    { ...particleComparison, status: "matched" }, { ...particleComparison, substitutionCount: 0 },
    { ...particleComparison, recognized: "会来了" }, { ...particleComparison, recognized: "来了" },
    { ...particleComparison, recognized: "快回来了" }, { ...particleComparison, sourcePrefix: "会来了" },
    { ...particleComparison, expected: "好啦", recognized: "好了", sourcePrefix: "好了", similarity: .5 },
    { ...particleComparison, acceptanceRule: "percentage_threshold" },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], index: 0 }] },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], recognizedPinyin: "liao3" }] },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], expectedPinyin: "la1" }] },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], sourceCharacter: "啦" }] },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], clauseEnd: false }] },
    { ...particleComparison, differences: [{ ...particleComparison.differences[0], rule: "same_tone" }] },
    { ...particleComparison, differences: [] }, { ...particleComparison, differences: [...particleComparison.differences, ...particleComparison.differences] },
    { ...particleComparison, phoneticSimilarity: 1 },
  ])("rejects forged scores or any broader short edit rule %#", invalid => {
    expect(VoiceContentComparisonSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    { ...particleRecognition, expectedText: "回来啦" }, { ...particleRecognition, expectedText: "回来啦，" },
    { ...particleRecognition, expectedText: "回来啦坐好。" }, { ...particleRecognition, targetTranscript: "回来啦。" },
    { ...particleRecognition, targetTranscript: undefined }, { ...particleRecognition, sourceTranscript: "回来啦。外面冷吗？" },
    { ...particleRecognition, sourceWords: undefined },
    { ...particleRecognition, sourceWords: [{ text: "回来了外面冷吗", start: .2, end: 1.5 }] },
    { ...particleRecognition, sourceWords: [{ text: "回来了", start: .2, end: .2 }] },
    { ...particleRecognition, sourceWords: [{ text: "回来", start: .2, end: .5 }, { text: "了", start: .3, end: .6 }] },
  ])("requires this actual sentence ending and a complete timed source-word prefix %#", invalid => {
    expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a final remainder only when its full source is accounted for", () => {
    const last = { ...particleRecognition, followingText: undefined, sourceTranscript: "回来了。", sourceWords: particleRecognition.sourceWords.slice(0, 1) };
    expect(VoiceRecognitionSchema.safeParse(last).success).toBe(true);
    expect(VoiceRecognitionSchema.safeParse({ ...particleRecognition, followingText: undefined }).success).toBe(false);
    expect(VoiceRecognitionSchema.safeParse({ ...last, sourceWords: particleRecognition.sourceWords }).success).toBe(false);
    expect(VoiceRecognitionSchema.safeParse({ ...last, expectedText: "「回来啦。」" }).success).toBe(true);
  });

  it("keeps ordinary and weighted phonetic thresholds and the ten-character floor unchanged", () => {
    expect(VoiceContentComparisonSchema.safeParse({ status: "different", similarity: .666667, threshold: .9, substitutionCount: 1,
      expected: "回来啦", recognized: "回来了" }).success).toBe(false);
    const { acceptanceRule: _acceptanceRule, ...fields } = particleComparison;
    void _acceptanceRule;
    expect(VoiceContentComparisonSchema.safeParse({ ...fields, mode: "phonetic_substitutions", phoneticSimilarity: .916667, phoneticThreshold: .95 }).success).toBe(false);
    expect(VoiceContentComparisonSchema.safeParse({ ...fields, mode: "phonetic_substitutions", phoneticSimilarity: 1, phoneticThreshold: .95 }).success).toBe(false);
  });

  it("keeps the special rule bounded to three through nine characters", () => {
    const expected = "今天终于慢慢回来啦", recognized = "今天终于慢慢回来了";
    expect(VoiceContentComparisonSchema.safeParse({ ...particleComparison, expected, recognized, sourcePrefix: recognized, similarity: .888889,
      differences: [{ ...particleComparison.differences[0], index: 8 }] }).success).toBe(true);
    expect(VoiceContentComparisonSchema.safeParse({ ...particleComparison, expected: "今天终于能慢慢回来啦", recognized: "今天终于能慢慢回来了",
      sourcePrefix: "今天终于能慢慢回来了", similarity: .9, differences: [{ ...particleComparison.differences[0], index: 9 }] }).success).toBe(false);
  });
});

const reviewedWindow = (transcript: string) => ({ transcript, words: [{ text: transcript, start: .05, end: .3 }], durationSeconds: .5 });
const shortReview = { status: "needs_confirmation", reason: "missing_final_particle", expected: "回来啦", sourcePrefix: "回来了",
  expectedPinyin: "la5", sourcePinyin: "le5", similarity: .666667,
  left: reviewedWindow("回来"), right: reviewedWindow("外面冷吗？"), final: reviewedWindow("回来") };
const reviewedRecognition = { ...particleRecognition, targetTranscript: "回来", contentComparison: undefined, shortSentenceReview: shortReview };

describe("safe boundaries with explicit tiny-sentence text confirmation", () => {
  it("preserves actual missing text instead of constructing a passing comparison", () => {
    const result = VoiceRecognitionSchema.parse(reviewedRecognition);
    expect(result.shortSentenceReview).toEqual(shortReview);
    expect(result.targetTranscript).toBe("回来");
    expect(result.contentComparison).toBeUndefined();
    expect(result.shortSentenceReview?.similarity).toBe(.666667);
  });

  it("keeps the review when only the left check was incomplete and final text is exact", () => {
    const complete = { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: "回来啦", recognized: "回来啦" };
    const result = VoiceRecognitionSchema.parse({ ...reviewedRecognition, targetTranscript: "回来啦。", contentComparison: complete,
      shortSentenceReview: { ...shortReview, similarity: 1, final: reviewedWindow("回来啦。") } });
    expect(result.shortSentenceReview?.status).toBe("needs_confirmation");
    expect(result.contentComparison?.status).toBe("matched");
  });

  it("requires the whole final source and omits artificial left/right evidence for the last sentence", () => {
    const { left: _left, right: _right, ...lastReview } = shortReview;
    void _left; void _right;
    const last = { ...reviewedRecognition, followingText: "", sourceTranscript: "回来了。", sourceWords: particleRecognition.sourceWords.slice(0, 1), shortSentenceReview: lastReview };
    expect(VoiceRecognitionSchema.safeParse(last).success).toBe(true);
    expect(VoiceRecognitionSchema.safeParse({ ...last, sourceTranscript: "回来了还有别的" }).success).toBe(false);
    expect(VoiceRecognitionSchema.safeParse({ ...last, shortSentenceReview: shortReview }).success).toBe(false);
  });

  it.each([
    { ...reviewedRecognition, contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: "回来", recognized: "回来" } },
    { ...reviewedRecognition, targetTranscript: "回来啦" }, { ...reviewedRecognition, stage: "target_validation" },
    { ...reviewedRecognition, sourceTranscript: "会来了外面冷吗" },
    { ...reviewedRecognition, sourceWords: [{ text: "回来了外面冷吗", start: .2, end: 1.5 }] },
    { ...reviewedRecognition, expectedText: "回来啦，" },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, status: "passed" } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, similarity: 1 } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, expectedPinyin: "la1" } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, sourcePrefix: "回来" } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, expected: "好啦", sourcePrefix: "好了" } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, left: undefined } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, right: undefined } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, right: reviewedWindow("面冷吗") } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, left: reviewedWindow("会来") } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, final: reviewedWindow("回") } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, left: reviewedWindow("回来啦"), final: reviewedWindow("回来啦"), similarity: 1 }, targetTranscript: "回来啦",
      contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: "回来啦", recognized: "回来啦" } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, final: { ...shortReview.final, words: [{ text: "回来", start: .3, end: .3 }] } } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, final: { ...shortReview.final, words: [{ text: "回来", start: .05, end: .8 }] } } },
    { ...reviewedRecognition, shortSentenceReview: { ...shortReview, final: { ...shortReview.final, words: [{ text: "会来", start: .05, end: .3 }] } } },
  ])("rejects unsafe, unrelated, dishonest or incomplete review evidence %#", invalid => {
    expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });
});

const toneExpected = "过来坐炉子边暖和", toneVariant = "过来做炉子边暖和";
const sameToneDifference = { index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" };
const sameToneReview = { status: "needs_confirmation", reason: "same_tone_substitution", expected: toneExpected, sourcePrefix: toneExpected,
  similarity: .875, differences: [sameToneDifference], final: reviewedWindow(toneVariant) };
const sameToneRecognition = { stage: "complete", expectedText: "过来坐，炉子边暖和。", sourceTranscript: toneExpected,
  sourceWords: [{ text: toneExpected, start: .05, end: .3 }], targetTranscript: toneVariant, shortSentenceReview: sameToneReview };

describe("one same-tone variant in tiny-sentence source or independent recognition", () => {
  it("keeps the actual full variant and score for manual confirmation without a passing content comparison", () => {
    const result = VoiceRecognitionSchema.parse(sameToneRecognition);
    expect(result.shortSentenceReview?.reason).toBe("same_tone_substitution");
    expect(result.shortSentenceReview?.sourcePrefix).toBe(toneExpected);
    expect(result.targetTranscript).toBe(toneVariant);
    expect(result.contentComparison).toBeUndefined();
    expect(result.shortSentenceReview?.similarity).toBe(.875);
  });
  it("retains source-only uncertainty even when final text is exact", () => {
    const result = VoiceRecognitionSchema.parse({ ...sameToneRecognition, sourceTranscript: toneVariant, sourceWords: [{ text: toneVariant, start: .05, end: .3 }],
      targetTranscript: toneExpected, contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: toneExpected, recognized: toneExpected },
      shortSentenceReview: { ...sameToneReview, sourcePrefix: toneVariant, final: reviewedWindow(toneExpected), similarity: 1 } });
    expect(result.shortSentenceReview?.status).toBe("needs_confirmation");
    expect(result.shortSentenceReview?.sourcePrefix).toBe(toneVariant);
    expect(result.contentComparison?.status).toBe("matched");
  });
  it.each([
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [sameToneDifference, sameToneDifference] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [{ ...sameToneDifference, recognizedPinyin: "zuo3" }] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [{ ...sameToneDifference, rule: "source_supported_tone" }] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [{ ...sameToneDifference, sourceCharacter: "坐" }] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, differences: [{ ...sameToneDifference, index: 1 }] } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, expectedPinyin: "la5" } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, final: reviewedWindow("过来做炉字边暖和") } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, final: reviewedWindow("过来做炉子边暖") } },
    { ...sameToneRecognition, shortSentenceReview: { ...sameToneReview, final: reviewedWindow("过来做炉子边暖和啊") } },
    { ...sameToneRecognition, sourceTranscript: "过来座炉子边暖和", sourceWords: [{ text: "过来座炉子边暖和", start: .05, end: .3 }],
      shortSentenceReview: { ...sameToneReview, sourcePrefix: "过来座炉子边暖和" } },
    { ...sameToneRecognition, sourceWords: [{ text: toneExpected + "慢慢休息", start: .05, end: .3 }] },
    { ...sameToneRecognition, contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: toneVariant, recognized: toneVariant } },
  ])("rejects broader edits, changed tones, invented fields or merged source endpoints %#", invalid => {
    expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });
  it("never reviews number or negation substitutions even with identical asserted pinyin", () => {
    for (const protectedCharacter of ["不", "没", "一", "两", "壹", "贰"]) {
      const expected = protectedCharacter + "来坐炉子边暖和", recognized = "乙来坐炉子边暖和";
      expect(VoiceRecognitionSchema.safeParse({ ...sameToneRecognition, expectedText: expected + "。", sourceTranscript: expected,
        sourceWords: [{ text: expected, start: .05, end: .3 }], targetTranscript: recognized,
        shortSentenceReview: { ...sameToneReview, expected, sourcePrefix: expected, final: reviewedWindow(recognized),
          differences: [{ index: 0, expected: protectedCharacter, recognized: "乙", expectedPinyin: "yi1", recognizedPinyin: "yi1", rule: "same_tone" }] } }).success).toBe(false);
    }
  });
});

const boundaryTarget = "鞋也换了吧，别把寒气带进来。";
const followingBoundary = { expected: toneExpected, recognized: toneVariant, sourceWordIndex: 1,
  difference: sameToneDifference, right: reviewedWindow(toneVariant) };
const followingRecognition = { stage: "complete", expectedText: boundaryTarget, followingText: "过来坐，炉子边暖和。",
  sourceTranscript: boundaryTarget + toneExpected, sourceWords: [{ text: boundaryTarget, start: .05, end: .3 }, { text: toneExpected, start: .7, end: .95 }],
  targetTranscript: boundaryTarget, contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0,
    expected: "鞋也换了吧别把寒气带进来", recognized: "鞋也换了吧别把寒气带进来" }, followingPhoneticBoundary: followingBoundary };

describe("complete same-tone right boundary with exact original following", () => {
  it("preserves the right ASR variant separately from this target's exact check", () => {
    const result = VoiceRecognitionSchema.parse(followingRecognition);
    expect(result.followingPhoneticBoundary).toEqual(followingBoundary);
    expect(result.contentComparison?.status).toBe("matched");
    expect(result.shortSentenceReview).toBeUndefined();
  });
  it.each([
    { ...followingRecognition, followingText: "过来坐炉子边暖和，" },
    { ...followingRecognition, sourceTranscript: boundaryTarget + toneVariant, sourceWords: [followingRecognition.sourceWords[0], { text: toneVariant, start: .7, end: .95 }] },
    { ...followingRecognition, sourceWords: [{ text: boundaryTarget + toneExpected, start: .05, end: .95 }] },
    { ...followingRecognition, sourceWords: [followingRecognition.sourceWords[0], { text: toneExpected + "啊", start: .7, end: .95 }] },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, sourceWordIndex: 0 } },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, sourceWordIndex: 2 } },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, difference: { ...sameToneDifference, recognizedPinyin: "zuo3" } } },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, recognized: "过来做炉字边暖和", right: reviewedWindow("过来做炉字边暖和") } },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, right: reviewedWindow("过来做炉子边暖") } },
    { ...followingRecognition, followingPhoneticBoundary: { ...followingBoundary, automaticTextPass: true } },
  ])("rejects nonexact source following, divided words or unsupported right differences %#", invalid => {
    expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });
});
