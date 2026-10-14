import { z } from "zod";
import { ShortSentenceReviewSchema, VoiceRecognitionSchema, normalizeVoiceSentenceParticleText } from "./voice-recognition";

export const VoiceParagraphRecordingRecognitionSchema = z.object({
  checkStatus: z.enum(["passed", "review", "needs_confirmation"]),
  clipIds: z.array(z.string().min(1).max(240)).min(1).max(32),
  segments: z.array(z.object({
    clipId: z.string().min(1).max(240), text: z.string().min(1).max(500),
    cutStartSeconds: z.number().finite().nonnegative(), cutEndSeconds: z.number().finite().positive(),
    recognition: VoiceRecognitionSchema.optional(),
    textReview: ShortSentenceReviewSchema.optional(),
  }).strict()).max(32),
  diagnosticCode: z.string().regex(/^[a-z0-9_]{1,120}$/).optional(),
  failedClipId: z.string().min(1).max(240).optional(),
  failureRecognition: VoiceRecognitionSchema.optional(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(value.clipIds).size !== value.clipIds.length) issue("Paragraph clip IDs must be unique");
  if (value.failedClipId !== undefined && !value.clipIds.includes(value.failedClipId)) issue("Failure must belong to this paragraph");
  if ((value.failedClipId !== undefined) !== (value.failureRecognition !== undefined)) issue("Failure recognition must identify its short sentence");
  if (value.checkStatus === "review" && value.segments.length) issue("Unverified paragraph cuts must not be published");
  if (value.checkStatus !== "review" && (value.segments.length !== value.clipIds.length || value.failureRecognition)) issue("Every safe short sentence needs a segment");
  if ((value.checkStatus === "needs_confirmation") !== value.segments.some((segment) => segment.textReview)) issue("Text review must retain needs_confirmation");
  value.segments.forEach((segment, index) => {
    if (segment.clipId !== value.clipIds[index]) issue("Paragraph segment order must match source order");
    if (segment.cutEndSeconds <= segment.cutStartSeconds) issue("Invalid paragraph cut range");
    const previousEnd = index ? value.segments[index - 1].cutEndSeconds : 0;
    if (Math.abs(segment.cutStartSeconds - previousEnd) > 1 / 48_000) issue("Paragraph cuts must preserve the original PCM order");
    if (segment.textReview && (segment.recognition?.stage !== "complete"
      || segment.recognition.expectedText !== segment.text
      || segment.textReview.expected !== normalizeVoiceSentenceParticleText(segment.text)
      || JSON.stringify(segment.textReview) !== JSON.stringify(segment.recognition.shortSentenceReview))) issue("Text review must retain its bound recognition evidence");
    if (!segment.textReview && segment.recognition?.shortSentenceReview) issue("Short sentence review cannot be omitted");
  });
});
export type VoiceParagraphRecordingRecognition = z.infer<typeof VoiceParagraphRecordingRecognitionSchema>;

export const VoiceGenerationRecordingSchema = z.object({
  recordingId: z.string().min(1).max(100),
  runId: z.string().uuid(),
  group: z.number().int().min(1).max(500),
  take: z.number().int().min(1).max(20),
  createdAt: z.string(),
  expectedText: z.string().max(2000),
  inputText: z.string().max(2000),
  duration: z.number().nonnegative().nullable(),
  audioUrl: z.string().regex(/^\/api\/voice-generation-recordings\/[a-zA-Z0-9_-]+$/),
  status: z.enum(["recorded", "checked", "needs_review", "not_checked"]),
  warning: z.string().max(1000),
  recognition: VoiceRecognitionSchema.optional(),
  paragraphRecognition: VoiceParagraphRecordingRecognitionSchema.optional(),
  historicalMatch: z.boolean(),
});

export const VoiceGenerationRecordingsSchema = z.object({
  recordings: z.array(VoiceGenerationRecordingSchema).max(500),
  truncated: z.boolean(),
  nextCursor: z.string().max(512).nullable().default(null),
});
export type VoiceGenerationRecording = z.infer<typeof VoiceGenerationRecordingSchema>;
