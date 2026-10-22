import { z } from "zod";
import { VoiceRecognitionSchema } from "./voice-recognition";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const SafeId = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const source = {
  groupIndex: z.number().int().min(0).max(11),
  sourceAssetId: SafeId,
  sourceSha256: Sha256,
  inputTextSha256: Sha256,
  sampleRate: z.literal(48_000),
  sourceFrames: z.number().int().positive().max(48_000 * 120),
  contentVerified: z.literal(false),
  previousRecognition: VoiceRecognitionSchema.optional(),
  failedClipId: SafeId.optional(),
};
const ctc = z.object({ ...source, method: z.literal("ctc_forced"), mode: z.enum(["paragraph", "prefix"]),
  modelId: z.string().min(1).max(240), modelRevision: z.string().min(1).max(240),
  cutFrames: z.array(z.number().int().positive()).max(31),
  characters: z.array(z.object({ char: z.string().min(1).max(8), startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(), score: z.number().finite(), wildcard: z.literal(true).optional() }).strict()).min(1).max(2000),
}).strict();
const whole = z.object({ ...source, method: z.literal("whole_recording"), cutFrames: z.tuple([]) }).strict();

/** Given text is an alignment hypothesis, never a new ASR transcript or content approval. */
export const ForcedSegmentationSchema = z.object({ version: z.literal(1), method: z.literal("ctc_forced"),
  sourceCandidateId: SafeId, createdAt: z.string().datetime(), contentVerified: z.literal(false),
  alignments: z.array(z.discriminatedUnion("method", [ctc, whole])).min(1).max(12),
}).strict().superRefine((value, context) => {
  let previousGroup = -1;
  for (const [index, alignment] of value.alignments.entries()) {
    const issue = (field: string, message: string) => context.addIssue({ code: "custom", path: ["alignments", index, field], message });
    if (alignment.groupIndex <= previousGroup) issue("groupIndex", "Forced groups must be unique and ordered");
    previousGroup = alignment.groupIndex;
    if (alignment.cutFrames.some((frame, offset) => frame >= alignment.sourceFrames || (offset > 0 && frame <= alignment.cutFrames[offset - 1]))) {
      issue("cutFrames", "Forced boundaries must be strictly inside the original PCM and ordered");
    }
    if (alignment.method === "ctc_forced") {
      if (alignment.mode === "prefix" && alignment.cutFrames.length !== 1) issue("cutFrames", "A prefix has exactly one retained endpoint");
      let previousEnd = 0;
      for (const character of alignment.characters) {
        if (character.endSeconds <= character.startSeconds || character.startSeconds < previousEnd - 1 / 48_000
          || character.endSeconds > alignment.sourceFrames / 48_000 + 1 / 48_000) issue("characters", "CTC character spans must be finite ordered source times");
        previousEnd = character.endSeconds;
      }
    }
  }
});

export type ForcedSegmentation = z.infer<typeof ForcedSegmentationSchema>;
export type ForcedSegmentationAlignment = ForcedSegmentation["alignments"][number];
