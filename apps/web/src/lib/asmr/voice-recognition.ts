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

export const VoiceContentComparisonSchema = z.union([SubstitutionComparisonSchema, BoundedEditComparisonSchema]);

const TerminalWordIndex = z.number().int().min(0).max(1999);

/** Public recognition evidence contains text/timestamps only, never process details or paths. */
export const VoiceRecognitionSchema = z.object({
  stage: z.enum(["input_validation", "source_transcription", "source_alignment", "continuation_alignment", "boundary_check", "target_transcription", "target_validation", "complete", "unavailable"]),
  sourceTranscript: z.string().max(8000),
  sourceWords: z.array(z.object({
    text: z.string().max(200),
    start: z.number().finite().min(0).max(120.1),
    end: z.number().finite().min(0).max(120.1),
  }).strict().refine((word) => word.end >= word.start, "Invalid recognized word timing")).max(2000).optional(),
  targetTranscript: z.string().max(8000).optional(),
  contentComparison: VoiceContentComparisonSchema.optional(),
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
}).strict();

export type VoiceRecognition = z.infer<typeof VoiceRecognitionSchema>;
export type VoiceContentComparison = z.infer<typeof VoiceContentComparisonSchema>;
