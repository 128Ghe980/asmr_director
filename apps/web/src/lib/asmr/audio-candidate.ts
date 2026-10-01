import { z } from "zod";
import type { TimelineClip } from "./schema";
import { VoiceGenerationOptionsSchema, VoiceReferenceModeSchema, type VoiceGenerationOptions, type LongTextRetry } from "./voice-generation-options";
import { VoiceLongTextResultSchema } from "./voice-longtext-result";
import type { VoiceGenerationContext } from "./voice-generation-context";

const SafeIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const ScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const AudioCandidateProvenanceSchema = z.object({
  provider: z.literal("voxcpm2"),
  model: z.string().min(1),
  seed: z.number().int().nonnegative(),
  temperature: z.number().min(0).max(2),
  voicePackId: VoiceGenerationOptionsSchema.shape.voicePackId,
  referenceMode: VoiceReferenceModeSchema,
  generationMode: z.enum(["clip", "long_text"]),
  parameters: z.record(z.string(), ScalarSchema),
  runtimeVersion: z.string().min(1).optional(),
  modelIdentity: z.string().min(1).optional(),
  referenceIdentity: z.string().min(1).optional(),
  longText: VoiceLongTextResultSchema.optional(),
}).strict().superRefine((provenance, context) => {
  if ((provenance.generationMode === "long_text") !== (provenance.longText !== undefined)) {
    context.addIssue({ code: "custom", path: ["longText"], message: "Long-text provenance is required only for long-text generation" });
  }
});

export const AudioCandidateSchema = z.object({
  version: z.literal(1),
  candidateId: SafeIdSchema,
  projectId: z.string().min(1).max(240),
  clipId: z.string().min(1).max(240),
  sourceFingerprint: z.string().min(1),
  requestFingerprint: z.string().min(1),
  asset: z.object({
    assetId: SafeIdSchema,
    uri: z.string().regex(/^asset:\/\/clip\/[A-Za-z0-9_-]+$/),
    duration: z.number().finite().positive(),
  }).strict().refine((asset) => asset.uri === `asset://clip/${asset.assetId}`, {
    message: "Candidate asset URI must match the stable clip asset id",
  }),
  wav: z.object({
    sampleRate: z.number().int().positive(),
    channels: z.union([z.literal(1), z.literal(2)]),
    bitsPerSample: z.union([z.literal(16), z.literal(24), z.literal(32)]),
  }).strict(),
  provenance: AudioCandidateProvenanceSchema,
  qualityWarnings: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
  status: z.enum(["ready", "discarded"]),
}).strict().superRefine((candidate, context) => {
  if (candidate.provenance.longText?.baseCandidateId === candidate.candidateId) {
    context.addIssue({ code: "custom", path: ["provenance", "longText", "baseCandidateId"], message: "A rerolled candidate must refer to a different source candidate" });
  }
});

// The format discriminator intentionally excludes the old prototype manifest.
export const AudioCandidateManifestSchema = z.object({
  format: z.literal("voxcpm2-product-candidates"),
  version: z.literal(1),
  candidates: z.array(AudioCandidateSchema),
}).strict().refine((manifest) => new Set(manifest.candidates.map((candidate) => candidate.candidateId)).size === manifest.candidates.length, {
  message: "Candidate IDs must be unique",
});

export type AudioCandidateProvenance = z.infer<typeof AudioCandidateProvenanceSchema>;
export type AudioCandidate = z.infer<typeof AudioCandidateSchema>;
export type AudioCandidateManifest = z.infer<typeof AudioCandidateManifestSchema>;

export function getVoiceCandidateSourceFingerprint(clip: TimelineClip, context?: VoiceGenerationContext): string {
  if (clip.type !== "voice") throw new Error("仅人声片段支持声音候选。");
  // Timing and the previous generated asset may change while comparing takes.
  return JSON.stringify({ text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace, ...(context ? { context } : {}) });
}

export function getVoiceCandidateRequestFingerprint(clip: TimelineClip, options: VoiceGenerationOptions, longTextRetry?: LongTextRetry, context?: VoiceGenerationContext): string {
  return JSON.stringify({
    source: getVoiceCandidateSourceFingerprint(clip, options.generationMode === "long_text" ? context : undefined),
    options: VoiceGenerationOptionsSchema.parse(options),
    requestedSeed: clip.generation.seed,
    requestedTemperature: clip.generation.temperature,
    ...(longTextRetry ? { longTextRetry } : {}),
  });
}
