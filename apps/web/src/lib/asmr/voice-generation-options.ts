import { z } from "zod";

export const VoiceReferenceModeSchema = z.enum([
  "reference_only",
  "with_reference_text",
]);

export const VoiceGenerationOptionsSchema = z.object({
  provider: z.enum(["gpt-sovits", "voxcpm2"]),
  voicePackId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  referenceMode: VoiceReferenceModeSchema,
  generationMode: z.literal("clip"),
}).strict();

export type VoiceGenerationOptions = z.infer<typeof VoiceGenerationOptionsSchema>;
