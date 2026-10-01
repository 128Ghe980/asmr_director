import { z } from "zod";
import { VoiceRecognitionSchema } from "./voice-recognition";

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
  historicalMatch: z.boolean(),
});

export const VoiceGenerationRecordingsSchema = z.object({
  recordings: z.array(VoiceGenerationRecordingSchema).max(500),
  truncated: z.boolean(),
  nextCursor: z.string().max(512).nullable().default(null),
});
export type VoiceGenerationRecording = z.infer<typeof VoiceGenerationRecordingSchema>;
