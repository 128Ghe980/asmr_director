import { z } from "zod";

const ComparedText = z.string().min(1).max(500).regex(/^[\p{L}\p{N}]+$/u)
  .refine((text) => text === text.toLowerCase(), "Compared text must be normalized");

export type VoiceContentDifference = {
  kind: "substitution" | "deletion" | "insertion";
  expectedIndex: number;
  recognizedIndex: number;
  expected: string;
  recognized: string;
};

/** Indices count Unicode characters. Missing text never shifts every subsequent difference. */
export function getVoiceContentDifferences(expectedText: string, recognizedText: string): VoiceContentDifference[] {
  const expected = Array.from(expectedText), recognized = Array.from(recognizedText);
  const costs = Array.from({ length: expected.length + 1 }, () => new Uint16Array(recognized.length + 1));
  for (let i = expected.length; i >= 0; i--) {
    for (let j = recognized.length; j >= 0; j--) {
      if (i === expected.length) costs[i][j] = recognized.length - j;
      else if (j === recognized.length) costs[i][j] = expected.length - i;
      else costs[i][j] = expected[i] === recognized[j] ? costs[i + 1][j + 1]
        : 1 + Math.min(costs[i + 1][j + 1], costs[i + 1][j], costs[i][j + 1]);
    }
  }
  const differences: VoiceContentDifference[] = [];
  let i = 0, j = 0;
  while (i < expected.length || j < recognized.length) {
    if (i < expected.length && j < recognized.length && expected[i] === recognized[j]) {
      i++; j++;
      continue;
    }
    // Keep this tie order identical to the local recognition worker.
    if (i < expected.length && j < recognized.length && costs[i][j] === costs[i + 1][j + 1] + 1) {
      differences.push({ kind: "substitution", expectedIndex: i, recognizedIndex: j, expected: expected[i++], recognized: recognized[j++] });
    } else if (i < expected.length && costs[i][j] === costs[i + 1][j] + 1) {
      differences.push({ kind: "deletion", expectedIndex: i, recognizedIndex: j, expected: expected[i++], recognized: "" });
    } else {
      differences.push({ kind: "insertion", expectedIndex: i, recognizedIndex: j, expected: "", recognized: recognized[j++] });
    }
  }
  return differences;
}

const SubstitutionComparisonSchema = z.object({
  mode: z.undefined().optional(),
  status: z.enum(["matched", "different"]),
  similarity: z.number().finite().min(0.9).max(1),
  threshold: z.literal(0.9),
  substitutionCount: z.number().int().min(0).max(2),
  expected: ComparedText,
  recognized: ComparedText,
}).strict().superRefine((comparison, context) => {
  const expected = Array.from(comparison.expected), recognized = Array.from(comparison.recognized);
  const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  if (expected.length !== recognized.length) {
    issue("recognized", "Content comparison cannot contain insertions or deletions");
    return;
  }
  const substitutions = expected.filter((character, index) => character !== recognized[index]).length;
  const similarity = (expected.length - substitutions) / expected.length;
  if (substitutions !== comparison.substitutionCount) issue("substitutionCount", "Substitution count must match the compared characters");
  if (Math.abs(similarity - comparison.similarity) > 0.000001) issue("similarity", "Similarity must match the compared characters");
  if (similarity < comparison.threshold) issue("similarity", "Content comparison is below its accepted threshold");
  if ((comparison.status === "matched") !== (substitutions === 0)) issue("status", "Content status must agree with the compared characters");
});

const BoundedEditComparisonSchema = z.object({
  mode: z.literal("bounded_edits"),
  status: z.literal("different"),
  similarity: z.number().finite().min(0.85).max(1),
  threshold: z.literal(0.85),
  substitutionCount: z.number().int().min(0).max(2),
  insertionCount: z.number().int().min(0).max(2),
  deletionCount: z.number().int().min(0).max(2),
  editCount: z.number().int().min(1).max(2),
  expected: ComparedText.refine((text) => Array.from(text).length >= 10, "Bounded edits require at least ten target characters"),
  recognized: ComparedText,
}).strict().superRefine((comparison, context) => {
  const expected = Array.from(comparison.expected), recognized = Array.from(comparison.recognized);
  const differences = getVoiceContentDifferences(comparison.expected, comparison.recognized);
  const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  const counts = {
    substitutionCount: differences.filter((difference) => difference.kind === "substitution").length,
    insertionCount: differences.filter((difference) => difference.kind === "insertion").length,
    deletionCount: differences.filter((difference) => difference.kind === "deletion").length,
    editCount: differences.length,
  };
  for (const field of ["substitutionCount", "insertionCount", "deletionCount", "editCount"] as const) {
    if (comparison[field] !== counts[field]) issue(field, "Edit counts must match the ordered character alignment");
  }
  const similarity = 1 - differences.length / Math.max(expected.length, recognized.length);
  if (Math.abs(similarity - comparison.similarity) > 0.000001) issue("similarity", "Similarity must match the compared characters");
  if (similarity < comparison.threshold) issue("similarity", "Content comparison is below its accepted threshold");

  const substitutions = differences.filter((difference) => difference.kind === "substitution");
  const removed = new Set(differences.filter((difference) => difference.kind === "deletion").map((difference) => difference.expected));
  const movedCharacter = differences.some((difference) => difference.kind === "insertion" && removed.has(difference.recognized));
  if (movedCharacter || (substitutions.length === 2
    && substitutions[0].expected === substitutions[1].recognized && substitutions[1].expected === substitutions[0].recognized)) {
    issue("recognized", "Moved or swapped characters cannot establish a content match");
  }
  const gramCounts = (characters: string[]) => {
    const counts = new Map<string, number>();
    for (let i = 0; i <= characters.length - 6; i++) {
      const gram = characters.slice(i, i + 6).join("");
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const expectedCounts = gramCounts(expected);
  if ([...gramCounts(recognized)].some(([gram, count]) => count > Math.max(1, expectedCounts.get(gram) ?? 0))) {
    issue("recognized", "New repeated speech cannot establish a content match");
  }
});

// Match the worker's Han numeric protection, including financial and historic numerals.
const ProtectedPhoneticCharacters = new Set(Array.from("不没无非别未莫勿否甭零〇一二三四五六七八九十百千万亿两㐅㒃㠪㭍亖什仟仨伍佰億兆兩卄卅卌叁参參叄壱壹幺廾廿弌弍弎弐拾捌柒漆玖肆萬貮貳贰阡陆陌陸"));
export function normalizeVoiceEvidenceText(text: string) {
  return text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().replace(/[地得]/gu, "的");
}
export function normalizeVoiceSentenceParticleText(text: string) {
  return text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}
const PhoneticDifferenceSchema = z.object({
  index: z.number().int().min(0).max(499),
  expected: z.string().regex(/^\p{Script=Han}$/u),
  recognized: z.string().regex(/^\p{Script=Han}$/u),
  expectedPinyin: z.string().regex(/^[a-zv]{1,12}[1-5]$/),
  recognizedPinyin: z.string().regex(/^[a-zv]{1,12}[1-5]$/),
  rule: z.enum(["same_tone", "source_supported_tone", "sentence_particle"]),
  sourceCharacter: z.string().regex(/^\p{Script=Han}$/u).optional(),
  clauseEnd: z.literal(true).optional(),
}).strict();

const PhoneticComparisonSchema = z.object({
  mode: z.literal("phonetic_substitutions"), status: z.literal("different"),
  similarity: z.number().finite().min(.8).max(1), threshold: z.literal(.9),
  phoneticSimilarity: z.number().finite().min(.95).max(1), phoneticThreshold: z.literal(.95),
  substitutionCount: z.number().int().min(1).max(2),
  expected: ComparedText, recognized: ComparedText, sourcePrefix: ComparedText,
  differences: z.array(PhoneticDifferenceSchema).min(1).max(2),
}).strict().superRefine((comparison, context) => {
  const expected = Array.from(comparison.expected), recognized = Array.from(comparison.recognized), source = Array.from(comparison.sourcePrefix);
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const edits = getVoiceContentDifferences(comparison.expected, comparison.recognized);
  if (expected.length < 10 || expected.length > 500 || expected.length !== recognized.length || source.length !== expected.length
      || edits.length !== comparison.substitutionCount || comparison.differences.length !== edits.length
      || edits.some(edit => edit.kind !== "substitution" || edit.expectedIndex !== edit.recognizedIndex)) {
    fail("Phonetic comparison requires one or two ordered substitutions in equal-length text"); return;
  }
  const sourceEdits = getVoiceContentDifferences(comparison.expected, comparison.sourcePrefix);
  if (sourceEdits.some(edit => edit.kind !== "substitution") || sourceEdits.length > 2 || sourceEdits.length * 10 > expected.length) fail("Source prefix must retain the existing ninety-percent content match");
  if (Math.abs(comparison.similarity - (1 - edits.length / expected.length)) > .000001) fail("Literal similarity must retain the actual character difference");
  let weightedCost = 0, toneChanges = 0;
  comparison.differences.forEach((difference, index) => {
    const edit = edits[index];
    if (difference.index !== edit.expectedIndex || difference.expected !== edit.expected || difference.recognized !== edit.recognized
        || ProtectedPhoneticCharacters.has(difference.expected) || ProtectedPhoneticCharacters.has(difference.recognized)) fail("Phonetic evidence must match each unprotected character substitution");
    if (difference.rule === "same_tone") {
      if (difference.expectedPinyin !== difference.recognizedPinyin || difference.sourceCharacter || difference.clauseEnd) fail("Same-tone evidence must have identical complete pinyin");
    } else if (difference.rule === "source_supported_tone") {
      toneChanges++; weightedCost += .25;
      if (difference.expectedPinyin.slice(0, -1) !== difference.recognizedPinyin.slice(0, -1)
          || difference.expectedPinyin === difference.recognizedPinyin || difference.sourceCharacter !== difference.expected
          || source[difference.index] !== difference.expected || difference.clauseEnd) fail("A tone difference requires the exact source character at the same position");
    } else {
      weightedCost += .25;
      if (!((difference.expected === "啦" && difference.recognized === "了" && difference.expectedPinyin === "la5" && difference.recognizedPinyin === "le5")
          || (difference.expected === "了" && difference.recognized === "啦" && difference.expectedPinyin === "le5" && difference.recognizedPinyin === "la5"))
          || !difference.clauseEnd || difference.sourceCharacter) fail("Only an evidenced clause-ending particle pair is permitted");
    }
  });
  if (toneChanges > 1 || Math.abs(comparison.phoneticSimilarity - (1 - weightedCost / expected.length)) > .000001) fail("Phonetic score must match the bounded rule costs");
  if (edits.length === 2 && edits[0].expected === edits[1].recognized && edits[1].expected === edits[0].recognized) fail("Swapped characters cannot establish a phonetic match");
  const grams = (text: string[]) => {
    const counts = new Map<string, number>();
    for (let i = 0; i <= text.length - 6; i++) { const gram = text.slice(i, i + 6).join(""); counts.set(gram, (counts.get(gram) ?? 0) + 1); }
    return counts;
  };
  const originalGrams = grams(expected);
  if ([...grams(recognized)].some(([gram, count]) => count > Math.max(1, originalGrams.get(gram) ?? 0))) fail("New repeated speech cannot establish a phonetic match");
});

const SentenceParticleComparisonSchema = z.object({
  mode: z.literal("sentence_particle"), status: z.literal("different"),
  similarity: z.number().finite().min(2 / 3 - .000001).max(8 / 9 + .000001), threshold: z.literal(.9),
  substitutionCount: z.literal(1), acceptanceRule: z.literal("exact_prefix_final_particle"),
  expected: ComparedText, recognized: ComparedText, sourcePrefix: ComparedText,
  differences: z.array(PhoneticDifferenceSchema).length(1),
}).strict().superRefine((comparison, context) => {
  const expected = Array.from(comparison.expected), recognized = Array.from(comparison.recognized), source = Array.from(comparison.sourcePrefix);
  const difference = comparison.differences[0];
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (!difference || comparison.differences.length !== 1) { fail("A short particle comparison requires exactly one evidenced substitution"); return; }
  const prefix = expected.slice(0, -1).join("");
  if (!/^\p{Script=Han}{3,9}$/u.test(comparison.expected) || recognized.length !== expected.length || source.length !== expected.length
      || recognized.slice(0, -1).join("") !== prefix || source.slice(0, -1).join("") !== prefix
      || !((expected.at(-1) === "啦" && recognized.at(-1) === "了") || (expected.at(-1) === "了" && recognized.at(-1) === "啦"))
      || ![expected.at(-1), recognized.at(-1)].includes(source.at(-1))) {
    fail("A short particle comparison requires at least two exact Han prefix characters and only one final particle substitution");
  }
  if (Math.abs(comparison.similarity - (1 - 1 / expected.length)) > .000001) fail("Literal similarity must retain the one actual particle difference");
  if (difference.index !== expected.length - 1 || difference.expected !== expected.at(-1) || difference.recognized !== recognized.at(-1)
      || difference.rule !== "sentence_particle" || difference.clauseEnd !== true || difference.sourceCharacter !== undefined
      || difference.expectedPinyin !== (expected.at(-1) === "啦" ? "la5" : "le5")
      || difference.recognizedPinyin !== (recognized.at(-1) === "啦" ? "la5" : "le5")) {
    fail("The only permitted short substitution is the evidenced final la5/le5 particle pair");
  }
});

export const VoiceContentComparisonSchema = z.union([SubstitutionComparisonSchema, BoundedEditComparisonSchema, PhoneticComparisonSchema, SentenceParticleComparisonSchema]);

const TerminalWordIndex = z.number().int().min(0).max(1999);

/** Locates complete ASR words; it never certifies that spoken text is correct. */
export const VoiceBoundaryOnlySchema = z.object({
  method: z.enum(["ordered_word_boundary", "whole_recording"]),
  alignmentSimilarity: z.number().finite().min(0).max(1),
  targetEndWordIndex: z.number().int().min(-1).max(1999),
  followingStartWordIndex: TerminalWordIndex.optional(),
  contentVerified: z.literal(false),
  internalPausePositions: z.array(z.number().int().min(0).max(30)).max(31),
}).strict().superRefine((boundary, context) => {
  if ((boundary.method === "ordered_word_boundary" && boundary.targetEndWordIndex < 0)
    || (boundary.method === "whole_recording" && boundary.followingStartWordIndex !== undefined)) {
    context.addIssue({ code: "custom", path: ["method"], message: "Only a complete recording can have no word endpoint" });
  }
  if (boundary.followingStartWordIndex !== undefined && boundary.followingStartWordIndex <= boundary.targetEndWordIndex) {
    context.addIssue({ code: "custom", path: ["followingStartWordIndex"], message: "The following words must come after the target prefix" });
  }
  if (boundary.internalPausePositions.some((position, index, positions) => index > 0 && position <= positions[index - 1])) {
    context.addIssue({ code: "custom", path: ["internalPausePositions"], message: "Measured pause positions must be ordered and unique" });
  }
});
export type VoiceBoundaryOnly = z.infer<typeof VoiceBoundaryOnlySchema>;

const ReviewWindowSchema = z.object({
  transcript: z.string().min(1).max(8000),
  words: z.array(z.object({ text: z.string().max(200), start: z.number().finite().min(0).max(120.1),
    end: z.number().finite().min(0).max(120.1) }).strict()).min(1).max(2000),
  durationSeconds: z.number().finite().positive().max(120.1),
}).strict().superRefine((window, context) => {
  let previous = 0;
  for (const word of window.words) {
    if (word.end <= word.start || word.start < previous - .02 || word.end > window.durationSeconds + .04) {
      context.addIssue({ code: "custom", path: ["words"], message: "Review words require positive ordered timestamps within their real audio window" });
    }
    previous = word.end;
  }
  if (normalizeVoiceSentenceParticleText(window.words.map(word => word.text).join("")) !== normalizeVoiceSentenceParticleText(window.transcript)) {
    context.addIssue({ code: "custom", path: ["words"], message: "Review transcript and complete words must agree" });
  }
});

/** Safe native boundaries with unresolved tiny-sentence text; never an ASR pass. */
const MissingParticleReviewSchema = z.object({
  status: z.literal("needs_confirmation"), reason: z.literal("missing_final_particle"),
  expected: ComparedText, sourcePrefix: ComparedText,
  expectedPinyin: z.enum(["la5", "le5"]), sourcePinyin: z.enum(["la5", "le5"]),
  similarity: z.number().finite().min(2 / 3 - .000001).max(1),
  left: ReviewWindowSchema.optional(), right: ReviewWindowSchema.optional(), final: ReviewWindowSchema,
}).strict().superRefine((review, context) => {
  const expected = Array.from(review.expected), source = Array.from(review.sourcePrefix);
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const prefix = expected.slice(0, -1).join("");
  if (!/^\p{Script=Han}{3,9}$/u.test(review.expected) || !["啦", "了"].includes(expected.at(-1) ?? "")
      || source.length !== expected.length || source.slice(0, -1).join("") !== prefix || !["啦", "了"].includes(source.at(-1) ?? "")
      || review.expectedPinyin !== (expected.at(-1) === "啦" ? "la5" : "le5")
      || review.sourcePinyin !== (source.at(-1) === "啦" ? "la5" : "le5")) fail("Review requires one complete exact Han prefix and neutral final particle in the original source");
  if (Boolean(review.left) !== Boolean(review.right)) fail("A reviewed opening requires both independent left and right evidence");
  let missing = false;
  for (const window of [review.left, review.final]) {
    if (!window) continue;
    const text = normalizeVoiceSentenceParticleText(window.transcript), characters = Array.from(text);
    if (text === prefix) missing = true;
    else if (characters.length !== expected.length || characters.slice(0, -1).join("") !== prefix || !["啦", "了"].includes(characters.at(-1) ?? "")) {
      fail("Only one missing final particle may require manual text confirmation");
    }
  }
  if (!missing) fail("Complete text must not be marked as a missing-particle review");
  const final = Array.from(normalizeVoiceSentenceParticleText(review.final.transcript));
  const score = final.join("") === review.expected ? 1 : 1 - 1 / expected.length;
  if (Math.abs(review.similarity - score) > .000001) fail("Review similarity must retain the actual final transcript difference");
});

const SameToneDifferenceSchema = PhoneticDifferenceSchema.refine(difference => difference.rule === "same_tone"
  && difference.sourceCharacter === undefined && difference.clauseEnd === undefined
  && difference.expected !== difference.recognized && difference.expectedPinyin === difference.recognizedPinyin
  && !ProtectedPhoneticCharacters.has(difference.expected) && !ProtectedPhoneticCharacters.has(difference.recognized),
"Short same-tone evidence must retain one unprotected equal-tone substitution");

function validShortSameTone(expected: string, recognized: string, difference: z.infer<typeof PhoneticDifferenceSchema>) {
  const original = Array.from(expected), actual = Array.from(recognized), edits = getVoiceContentDifferences(expected, recognized);
  return /^\p{Script=Han}{3,9}$/u.test(expected) && original.length === actual.length && edits.length === 1
    && edits[0].kind === "substitution" && edits[0].expectedIndex === edits[0].recognizedIndex
    && difference.index === edits[0].expectedIndex && difference.expected === edits[0].expected && difference.recognized === edits[0].recognized;
}

const SameToneReviewSchema = z.object({
  status: z.literal("needs_confirmation"), reason: z.literal("same_tone_substitution"),
  expected: ComparedText, sourcePrefix: ComparedText, similarity: z.number().finite().min(2 / 3 - .000001).max(1),
  differences: z.array(SameToneDifferenceSchema).length(1),
  left: ReviewWindowSchema.optional(), right: ReviewWindowSchema.optional(), final: ReviewWindowSchema,
}).strict().superRefine((review, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const difference = review.differences[0];
  if (!difference || review.differences.length !== 1) { fail("Only one same-tone short-sentence difference may require review"); return; }
  const expected = Array.from(review.expected);
  const variant = expected.map((character, index) => index === difference.index ? difference.recognized : character).join("");
  if (!validShortSameTone(review.expected, variant, difference)) fail("Same-tone review requires one full-length short variant");
  if (Boolean(review.left) !== Boolean(review.right)) fail("A reviewed opening requires independent left and right evidence");
  const texts = [review.sourcePrefix, ...[review.left, review.final].filter(Boolean).map(window => normalizeVoiceSentenceParticleText(window!.transcript))];
  if (texts.some(text => text !== review.expected && text !== variant) || !texts.includes(variant)) fail("All recognition phases must retain the original or the same single-character variant");
  const score = normalizeVoiceSentenceParticleText(review.final.transcript) === review.expected ? 1 : 1 - 1 / expected.length;
  if (Math.abs(review.similarity - score) > .000001) fail("Review similarity must retain the actual final character difference");
});

export const ShortSentenceReviewSchema = z.union([MissingParticleReviewSchema, SameToneReviewSchema]);

const FollowingPhoneticBoundarySchema = z.object({
  expected: ComparedText, recognized: ComparedText, sourceWordIndex: TerminalWordIndex,
  difference: SameToneDifferenceSchema, right: ReviewWindowSchema,
}).strict().superRefine((evidence, context) => {
  if (!validShortSameTone(evidence.expected, evidence.recognized, evidence.difference)
      || normalizeVoiceSentenceParticleText(evidence.right.transcript) !== evidence.recognized) {
    context.addIssue({ code: "custom", message: "Following phonetic boundary evidence requires a complete single same-tone short-sentence variant" });
  }
});

export type ShortSentenceReview = z.infer<typeof ShortSentenceReviewSchema>;

/** Public recognition evidence contains text/timestamps only, never process details or paths. */
export const VoiceRecognitionSchema = z.object({
  analysisMode: z.literal("cutting_only").optional(),
  stage: z.enum(["input_validation", "source_transcription", "source_alignment", "continuation_alignment", "boundary_check", "target_transcription", "target_validation", "complete", "unavailable"]),
  sourceTranscript: z.string().max(8000),
  sourceWords: z.array(z.object({
    text: z.string().max(200),
    start: z.number().finite().min(0).max(120.1),
    end: z.number().finite().min(0).max(120.1),
  }).strict().refine((word) => word.end >= word.start, "Invalid recognized word timing")).max(2000).optional(),
  targetTranscript: z.string().max(8000).optional(),
  contentComparison: VoiceContentComparisonSchema.optional(),
  shortSentenceReview: ShortSentenceReviewSchema.optional(),
  followingPhoneticBoundary: FollowingPhoneticBoundarySchema.optional(),
  endpointCandidates: z.array(z.object({
    terminalWordIndex: TerminalWordIndex,
    recognizedPrefix: ComparedText,
    similarity: z.number().finite().min(0.85).max(1),
  }).strict()).max(8).optional(),
  boundaryMatch: z.object({
    method: z.enum(["ending_anchor", "api"]),
    terminalWordIndex: TerminalWordIndex,
    anchorText: ComparedText.max(40),
    recognizedPrefix: ComparedText,
  }).strict().optional(),
  continuationBridge: z.object({
    kind: z.literal("leading_hmm"),
    text: z.literal("嗯"),
    sourceWordIndex: TerminalWordIndex,
    sourceStartSeconds: z.number().finite().min(0).max(120.1),
    sourceEndSeconds: z.number().finite().min(0).max(120.1),
    rightTranscript: z.string().min(1).max(1500),
  }).strict().optional(),
  apiFallback: z.object({
    status: z.enum(["selected", "declined", "unavailable"]),
    model: z.string().max(160).optional(),
  }).strict().optional(),
  expectedText: z.string().max(500),
  followingText: z.string().max(1500).optional(),
  alignment: z.object({
    expected: z.string().max(1500),
    recognizedPrefix: z.string().max(2000),
    reason: z.string().regex(/^[a-z_]{1,80}$/),
  }).strict().optional(),
}).strict().superRefine((recognition, context) => {
  if (recognition.analysisMode === "cutting_only") {
    const fail = (message: string) => context.addIssue({ code: "custom", path: ["analysisMode"], message });
    if (recognition.contentComparison || recognition.shortSentenceReview || recognition.followingPhoneticBoundary
      || recognition.boundaryMatch || recognition.continuationBridge || recognition.endpointCandidates || recognition.apiFallback) {
      fail("Cutting-only evidence cannot include legacy text acceptance or semantic selection");
    }
    if (recognition.stage === "complete" && recognition.followingText?.trim()) {
      let previousEnd = 0, prefix = "", targetIsWholePrefix = false;
      for (const word of recognition.sourceWords ?? []) {
        if (word.end <= word.start || word.start < previousEnd - .02) fail("Cutting-only words require positive ordered timestamps");
        previousEnd = word.end;
        prefix += word.text;
        if (prefix === recognition.targetTranscript) targetIsWholePrefix = true;
      }
      if (!recognition.targetTranscript?.trim() || !targetIsWholePrefix) fail("A completed cut must retain the exact whole-word source prefix");
    }
  }
  const comparison = recognition.contentComparison;
  const review = recognition.shortSentenceReview;
  if (review) {
    const fail = (message: string) => context.addIssue({ code: "custom", path: ["shortSentenceReview"], message });
    let prefix = "", endpoint = -1, previous = 0;
    for (const [index, word] of (recognition.sourceWords ?? []).entries()) {
      if (word.end <= word.start || word.start < previous - .02) fail("Review source words require real positive ordered timestamps");
      previous = word.end;
      prefix += normalizeVoiceSentenceParticleText(word.text);
      if (prefix === review.sourcePrefix) { endpoint = index; break; }
      if (Array.from(prefix).length >= Array.from(review.sourcePrefix).length) break;
    }
    if (recognition.stage !== "complete" || recognition.boundaryMatch || recognition.continuationBridge
        || normalizeVoiceSentenceParticleText(recognition.expectedText) !== review.expected
        || !/[。！？.!?][\s”’"'）)」』]*$/u.test(recognition.expectedText)
        || endpoint < 0 || !normalizeVoiceSentenceParticleText(recognition.sourceTranscript).startsWith(review.sourcePrefix)
        || recognition.targetTranscript !== review.final.transcript) fail("Review must belong to this completed source endpoint and actual final transcript");
    if (recognition.followingText?.trim()) {
      const following = normalizeVoiceEvidenceText(recognition.followingText), anchor = following.slice(0, Math.min(6, following.length));
      const continuation = (recognition.sourceWords ?? []).slice(endpoint + 1).map(word => normalizeVoiceEvidenceText(word.text)).join("");
      const rightPhonetic = recognition.followingPhoneticBoundary && review.right
        && JSON.stringify(recognition.followingPhoneticBoundary.right) === JSON.stringify(review.right);
      if (!review.left || !review.right || !anchor || !continuation.startsWith(anchor)
          || (!normalizeVoiceEvidenceText(review.right.transcript).startsWith(anchor) && !rightPhonetic)) fail("Reviewed cuts require exact immediate continuation and independent right recognition");
    } else if (review.left || review.right || normalizeVoiceSentenceParticleText(recognition.sourceTranscript) !== review.sourcePrefix
        || normalizeVoiceSentenceParticleText((recognition.sourceWords ?? []).map(word => word.text).join("")) !== review.sourcePrefix) {
      fail("A reviewed final sentence must account for the entire remaining source");
    }
    const final = normalizeVoiceSentenceParticleText(review.final.transcript);
    if ((review.reason === "missing_final_particle" && final === Array.from(review.expected).slice(0, -1).join(""))
        || (review.reason === "same_tone_substitution" && final !== review.expected)) {
      if (comparison) fail("An omitted final particle must not be serialized as a passing content comparison");
    } else if (!comparison || comparison.expected !== review.expected || comparison.recognized !== final
        || Math.abs(comparison.similarity - review.similarity) > .000001) fail("A complete final check must retain its own honest content comparison");
  }
  const followingBoundary = recognition.followingPhoneticBoundary;
  if (followingBoundary) {
    const fail = (message: string) => context.addIssue({ code: "custom", path: ["followingPhoneticBoundary"], message });
    const sourceWords = recognition.sourceWords ?? [], index = followingBoundary.sourceWordIndex;
    const preceding = normalizeVoiceEvidenceText(sourceWords.slice(0, index).map(word => word.text).join(""));
    const expected = normalizeVoiceEvidenceText(recognition.expectedText), edits = getVoiceContentDifferences(expected, preceding);
    const ordinarySource = Array.from(expected).length === Array.from(preceding).length && edits.length <= 2
      && edits.length * 10 <= Array.from(expected).length && edits.every(edit => edit.kind === "substitution")
      && !(edits.length === 2 && edits[0].expected === edits[1].recognized && edits[1].expected === edits[0].recognized);
    const evidencedSource = review?.sourcePrefix === normalizeVoiceSentenceParticleText(sourceWords.slice(0, index).map(word => word.text).join(""))
      || (comparison?.mode === "sentence_particle" && comparison.sourcePrefix === preceding);
    let following = "", end = index - 1, previous = index ? sourceWords[index - 1]?.end ?? 0 : 0;
    for (let cursor = index; cursor < sourceWords.length; cursor++) {
      const word = sourceWords[cursor];
      if (word.end <= word.start || word.start < previous - .02) fail("Following source words require complete positive ordered timings");
      previous = word.end;
      following += normalizeVoiceSentenceParticleText(word.text);
      if (Array.from(following).length >= Array.from(followingBoundary.expected).length) { end = cursor; break; }
    }
    if (recognition.stage !== "complete" || recognition.boundaryMatch || recognition.continuationBridge
        || index < 1 || end < index || (!ordinarySource && !evidencedSource)
        || normalizeVoiceSentenceParticleText(recognition.followingText ?? "") !== followingBoundary.expected
        || !/[。！？.!?][\s”’"'）)」』]*$/u.test(recognition.followingText ?? "")
        || following !== followingBoundary.expected
        || !normalizeVoiceSentenceParticleText(recognition.sourceTranscript).startsWith(normalizeVoiceSentenceParticleText(sourceWords.slice(0, end + 1).map(word => word.text).join("")))) {
      fail("Phonetic right-boundary evidence requires the exact complete immediate following in the original source");
    }
  }
  if (comparison?.mode === "sentence_particle") {
    let prefix = "", previous = 0, wordBoundary = false, validTiming = true;
    for (const word of recognition.sourceWords ?? []) {
      validTiming &&= word.end > word.start && word.start >= previous - .02;
      previous = word.end;
      prefix += normalizeVoiceSentenceParticleText(word.text);
      if (prefix === comparison.sourcePrefix) { wordBoundary = true; break; }
      if (Array.from(prefix).length >= Array.from(comparison.sourcePrefix).length) break;
    }
    if (normalizeVoiceSentenceParticleText(recognition.expectedText) !== comparison.expected
        || recognition.targetTranscript === undefined || normalizeVoiceSentenceParticleText(recognition.targetTranscript) !== comparison.recognized
        || !normalizeVoiceSentenceParticleText(recognition.sourceTranscript).startsWith(comparison.sourcePrefix) || !wordBoundary || !validTiming
        || !/[。！？.!?][\s”’"'）)」』]*$/u.test(recognition.expectedText)) {
      context.addIssue({ code: "custom", path: ["contentComparison"], message: "Short particle evidence requires an actual sentence ending, a complete source-word prefix and this cropped transcript" });
    }
    if (!recognition.followingText?.trim()
        && (normalizeVoiceSentenceParticleText(recognition.sourceTranscript) !== comparison.sourcePrefix
          || normalizeVoiceSentenceParticleText((recognition.sourceWords ?? []).map(word => word.text).join("")) !== comparison.sourcePrefix)) {
      context.addIssue({ code: "custom", path: ["contentComparison"], message: "A final short sentence must account for the complete remaining source" });
    }
  }
  if (comparison?.mode === "phonetic_substitutions") {
    let prefix = "", wordBoundary = false;
    for (const word of recognition.sourceWords ?? []) {
      prefix += normalizeVoiceEvidenceText(word.text);
      if (prefix === comparison.sourcePrefix) { wordBoundary = true; break; }
      if (Array.from(prefix).length >= Array.from(comparison.sourcePrefix).length) break;
    }
    if (normalizeVoiceEvidenceText(recognition.expectedText) !== comparison.expected
        || recognition.targetTranscript === undefined || normalizeVoiceEvidenceText(recognition.targetTranscript) !== comparison.recognized
        || !normalizeVoiceEvidenceText(recognition.sourceTranscript).startsWith(comparison.sourcePrefix) || !wordBoundary) {
      context.addIssue({ code: "custom", path: ["contentComparison"], message: "Phonetic evidence must match the target, cropped transcript and complete source-word prefix" });
    }
    let readable = 0;
    const clauseEnds = new Set<number>();
    for (const character of recognition.expectedText) {
      if (/[\p{L}\p{N}]/u.test(character)) readable++;
      else if (/[，。！？；：、,.!?;:\n\r…]/u.test(character) && readable > 0) clauseEnds.add(readable - 1);
    }
    if (readable) clauseEnds.add(readable - 1);
    if (comparison.differences.some(difference => difference.rule === "sentence_particle" && !clauseEnds.has(difference.index))) {
      context.addIssue({ code: "custom", path: ["contentComparison", "differences"], message: "Particle evidence must refer to an actual clause ending in the original target" });
    }
  }
  const bridge = recognition.continuationBridge;
  if (!bridge) return;
  const word = recognition.sourceWords?.[bridge.sourceWordIndex];
  // This is evidence from an independently verified cut, never a fuzzy text
  // prefix or permission to discard arbitrary intervening speech.
  if (recognition.stage !== "complete" || recognition.contentComparison?.status !== "matched"
      || !recognition.followingText?.trim() || recognition.boundaryMatch
      || bridge.sourceWordIndex < 1 || !word || word.text.replace(/[^\p{L}\p{N}]/gu, "") !== "嗯"
      || bridge.sourceStartSeconds !== word.start || bridge.sourceEndSeconds !== word.end
      || bridge.sourceEndSeconds <= bridge.sourceStartSeconds) {
    context.addIssue({ code: "custom", path: ["continuationBridge"], message: "Continuation bridge requires completed exact-content verification and a separately timed source word" });
  }
});

export type VoiceRecognition = z.infer<typeof VoiceRecognitionSchema>;
export type VoiceContentComparison = z.infer<typeof VoiceContentComparisonSchema>;

export function isCuttingOnlyRecognition(recognition?: Pick<VoiceRecognition, "analysisMode">): boolean {
  return recognition?.analysisMode === "cutting_only";
}
