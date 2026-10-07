import { describe, expect, it } from "vitest";
import { getVoiceContentDifferences, VoiceContentComparisonSchema, VoiceRecognitionSchema } from "./voice-recognition";

const different = { status: "different", similarity: .9, threshold: .9, substitutionCount: 1,
  expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" };

describe("bounded recognition content comparison", () => {
  it("keeps old recognition records valid without inferring a content match", () => {
    const legacy = { stage: "complete", sourceTranscript: "旧识别内容", expectedText: "旧目标。" };
    expect(VoiceRecognitionSchema.parse(legacy)).toEqual(legacy);
  });

  it("accepts exactly matched or genuinely different equal-length comparisons", () => {
    expect(VoiceContentComparisonSchema.parse(different)).toEqual(different);
    const matched = { ...different, status: "matched", similarity: 1, substitutionCount: 0, recognized: different.expected };
    expect(VoiceContentComparisonSchema.parse(matched)).toEqual(matched);
    expect(VoiceContentComparisonSchema.safeParse({ ...different, expected: "甲".repeat(20), recognized: "乙丙" + "甲".repeat(18), substitutionCount: 2 }).success).toBe(true);
  });

  it("counts Unicode characters and permits only numerical rounding tolerance", () => {
    const comparison = { ...different, expected: "𠮷".repeat(11), recognized: "𠮷".repeat(10) + "甲", similarity: .909091 };
    expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(true);
    expect(VoiceContentComparisonSchema.safeParse({ ...comparison, similarity: .91 }).success).toBe(false);
  });

  it("rejects contradictory status, counts, scores, thresholds, and inserted or missing text", () => {
    for (const invalid of [
      { ...different, status: "matched" },
      { ...different, recognized: different.expected },
      { ...different, substitutionCount: 0 },
      { ...different, substitutionCount: 2 },
      { ...different, similarity: 1 },
      { ...different, threshold: .8 },
      { ...different, recognized: different.recognized + "啊" },
      { ...different, recognized: different.recognized.slice(1) },
      { ...different, expected: "回来啦", recognized: "回来了", similarity: .9 },
      { ...different, expected: "甲".repeat(30), recognized: "乙丙丁" + "甲".repeat(27), substitutionCount: 3 },
      { ...different, expected: different.expected + "？", recognized: different.recognized + "？" },
      { ...different, privatePath: "D:/private" },
    ]) expect(VoiceContentComparisonSchema.safeParse(invalid).success).toBe(false);
  });
});

function bounded(expected: string, recognized: string) {
  const edits = getVoiceContentDifferences(expected, recognized);
  return {
    mode: "bounded_edits", status: "different", threshold: .85,
    similarity: 1 - edits.length / Math.max(Array.from(expected).length, Array.from(recognized).length),
    substitutionCount: edits.filter((edit) => edit.kind === "substitution").length,
    deletionCount: edits.filter((edit) => edit.kind === "deletion").length,
    insertionCount: edits.filter((edit) => edit.kind === "insertion").length,
    editCount: edits.length, expected, recognized,
  };
}

describe("bounded edit comparison", () => {
  it("keeps missing 儿 and substituted 啦 separate without shifting later text", () => {
    const expected = "来面来啦慢点儿吃小心烫汤也喝一点暖胃";
    const recognized = "来面来了慢点吃小心烫汤也喝一点暖胃";
    const comparison = bounded(expected, recognized);
    expect(VoiceContentComparisonSchema.parse(comparison)).toEqual(comparison);
    expect(getVoiceContentDifferences(expected, recognized)).toEqual([
      { kind: "substitution", expectedIndex: 3, recognizedIndex: 3, expected: "啦", recognized: "了" },
      { kind: "deletion", expectedIndex: 6, recognizedIndex: 6, expected: "儿", recognized: "" },
    ]);
  });

  it("uses Unicode character indices and deterministic exact/substitution/deletion/insertion ties", () => {
    expect(getVoiceContentDifferences("𠮷甲乙丙", "𠮷乙丙")).toEqual([
      { kind: "deletion", expectedIndex: 1, recognizedIndex: 1, expected: "甲", recognized: "" },
    ]);
    expect(getVoiceContentDifferences("abc", "bac").map((edit) => edit.kind)).toEqual(["substitution", "substitution"]);
    expect(getVoiceContentDifferences("aa", "a")).toEqual([
      { kind: "deletion", expectedIndex: 1, recognizedIndex: 1, expected: "a", recognized: "" },
    ]);
  });

  it("accepts up to two missing or additional characters only within the edit budget", () => {
    for (const [expected, recognized] of [
      ["abcdefghijklmn", "abcdlmn"],
      ["abcdefghij", "abcdefghij甲"],
      ["abcdefghijklmn", "abcdefghijklmn甲乙"],
      ["abcdefghijklmn", "abcdefghijklm"],
      ["abcdefghijklmn", "abcdefghijkl"],
    ]) {
      const comparison = bounded(expected, recognized);
      expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(comparison.editCount <= 2 && comparison.similarity >= .85);
    }
  });

  it("rejects short targets, zero edits, excessive edits, low similarity and a false threshold", () => {
    for (const comparison of [
      bounded("abcdefghi", "abcdefgh甲"),
      bounded("abcdefghij", "abcdefghij"),
      bounded("abcdefghijklmnopqrstuvwxy", "abcdefghijklmnopqrstuv甲乙丙"),
      bounded("abcdefghij", "abcdefgh甲乙"),
      { ...bounded("abcdefghij", "abcdefghi甲"), threshold: .8 },
    ]) expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(false);
  });

  it("recomputes each count and similarity instead of trusting serialized evidence", () => {
    const comparison = bounded("abcdefghijklmn", "abcdef甲hijklm");
    expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(true);
    for (const invalid of [
      { ...comparison, substitutionCount: 0, deletionCount: 2 },
      { ...comparison, insertionCount: 1 },
      { ...comparison, editCount: 1 },
      { ...comparison, status: "matched" },
      { ...comparison, similarity: 1 },
      { ...comparison, recognized: comparison.recognized + "。" },
      { ...comparison, expected: comparison.expected.toUpperCase() },
    ]) expect(VoiceContentComparisonSchema.safeParse(invalid).success).toBe(false);
    expect(VoiceContentComparisonSchema.safeParse({ ...comparison, similarity: Number(comparison.similarity.toFixed(6)) }).success).toBe(true);
  });

  it("rejects adjacent swaps and newly repeated six-character phrases", () => {
    expect(VoiceContentComparisonSchema.safeParse(bounded("abcdefghijklmn", "bacdefghijklmn")).success).toBe(false);
    expect(VoiceContentComparisonSchema.safeParse(bounded("abcdefabcdegxyz", "abcdefabcdefxyz")).success).toBe(false);
  });

  it("rejects mutually swapped substitutions even when they are far apart", () => {
    for (const recognized of ["abedcfghijklmn", "abjdefghicklmn"]) {
      const comparison = bounded("abcdefghijklmn", recognized);
      expect(comparison.substitutionCount).toBe(2);
      expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(false);
    }
  });

  it("rejects a moved character represented as one deletion and one insertion", () => {
    const comparison = bounded("abcdefghijklmn", "acdefgbhijklmn");
    expect(comparison.deletionCount).toBe(1);
    expect(comparison.insertionCount).toBe(1);
    expect(VoiceContentComparisonSchema.safeParse(comparison).success).toBe(false);
  });
});

describe("bounded ending-location evidence", () => {
  const endpoint = { terminalWordIndex: 12, recognizedPrefix: "来面来了慢点吃小心烫汤也喝一点暖胃", similarity: .888889 };
  const recognition = { stage: "complete", sourceTranscript: "来，面来了。", expectedText: "来~~，面来啦！",
    endpointCandidates: [endpoint], boundaryMatch: { method: "ending_anchor", ...endpoint, anchorText: "暖胃" } };

  it("keeps punctuation in source/target while storing normalized bounded endpoint evidence", () => {
    const boundaryMatch = { method: recognition.boundaryMatch.method, terminalWordIndex: endpoint.terminalWordIndex,
      recognizedPrefix: endpoint.recognizedPrefix, anchorText: recognition.boundaryMatch.anchorText };
    const valid = { ...recognition, boundaryMatch };
    expect(VoiceRecognitionSchema.parse(valid)).toEqual(valid);
    expect(VoiceRecognitionSchema.safeParse({ ...valid, boundaryMatch: { ...boundaryMatch, method: "api" }, apiFallback: { status: "selected", model: "existing-model" } }).success).toBe(true);
  });

  it("rejects unbounded, punctuated and unexpected endpoint fields", () => {
    const base = { stage: "source_alignment", sourceTranscript: "", expectedText: "暖胃" };
    for (const invalid of [
      { ...base, endpointCandidates: Array(9).fill(endpoint) },
      { ...base, endpointCandidates: [{ ...endpoint, terminalWordIndex: 2000 }] },
      { ...base, endpointCandidates: [{ ...endpoint, recognizedPrefix: "暖胃。" }] },
      { ...base, endpointCandidates: [{ ...endpoint, similarity: .84 }] },
      { ...base, boundaryMatch: { method: "api", terminalWordIndex: 12, recognizedPrefix: "暖胃", anchorText: "胃".repeat(41) } },
      { ...base, apiFallback: { status: "selected", model: "x".repeat(161) } },
    ]) expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("verified continuation interjection evidence", () => {
  const bridge = { kind: "leading_hmm", text: "嗯", sourceWordIndex: 1,
    sourceStartSeconds: 1.5, sourceEndSeconds: 1.7, rightTranscript: "嗯，面快好了。" };
  const evidence = { stage: "complete", expectedText: "今天是不是又加班了？眼睛都红红的。",
    sourceTranscript: "今天是不是又加班了眼睛都红红的嗯面快好了", followingText: "面快好了，",
    sourceWords: [{ text: "今天是不是又加班了眼睛都红红的", start: 0, end: 1 },
      { text: "嗯", start: 1.5, end: 1.7 }, { text: "面快好了", start: 2, end: 2.5 }],
    contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0,
      expected: "今天是不是又加班了眼睛都红红的", recognized: "今天是不是又加班了眼睛都红红的" },
    continuationBridge: bridge };

  it("accepts a separately timed interjection only in a completed exact-content check", () => {
    expect(VoiceRecognitionSchema.parse(evidence)).toEqual(evidence);
  });

  it("rejects incomplete, approximate, missing, merged or contradictory interjection evidence", () => {
    for (const invalid of [
      { ...evidence, stage: "boundary_check" },
      { ...evidence, contentComparison: undefined },
      { ...evidence, contentComparison: different },
      { ...evidence, followingText: "" },
      { ...evidence, sourceWords: undefined },
      { ...evidence, sourceWords: [{ text: "目标", start: 0, end: 1 }, { text: "嗯面", start: 1.5, end: 1.7 }] },
      { ...evidence, continuationBridge: { ...bridge, sourceWordIndex: 0 } },
      { ...evidence, continuationBridge: { ...bridge, sourceWordIndex: 2000 } },
      { ...evidence, continuationBridge: { ...bridge, sourceStartSeconds: 1.4 } },
      { ...evidence, continuationBridge: { ...bridge, sourceEndSeconds: 1.5 } },
      { ...evidence, continuationBridge: { ...bridge, text: "啊" } },
      { ...evidence, continuationBridge: { ...bridge, rightTranscript: "x".repeat(1501) } },
      { ...evidence, continuationBridge: { ...bridge, privatePath: "D:/private" } },
    ]) expect(VoiceRecognitionSchema.safeParse(invalid).success).toBe(false);
  });
});
