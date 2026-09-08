import { z } from "zod";

export const VoiceReferenceModeSchema = z.enum([
  "reference_only",
  "with_reference_text",
]);

export const VoiceGenerationOptionsSchema = z.object({
  provider: z.enum(["gpt-sovits", "voxcpm2"]),
  voicePackId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  referenceMode: VoiceReferenceModeSchema,
  generationMode: z.enum(["clip", "long_text"]),
  analysisProvider: z.enum(["local", "api"]).optional(),
}).strict();

export type VoiceGenerationOptions = z.infer<typeof VoiceGenerationOptionsSchema>;
export const LongTextRetrySchema = z.object({
  candidateId: z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/),
  groupIndex: z.number().int().min(0).max(11),
}).strict();
export type LongTextRetry = z.infer<typeof LongTextRetrySchema>;
