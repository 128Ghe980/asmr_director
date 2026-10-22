import { z } from "zod";
import type { TimelineClip } from "./schema";
import { VoiceGenerationOptionsSchema, VoiceReferenceModeSchema, type VoiceGenerationOptions, type LongTextRetry } from "./voice-generation-options";
import { VoiceLongTextResultSchema } from "./voice-longtext-result";
import type { VoiceGenerationContext } from "./voice-generation-context";
import type { VoiceParagraphContext } from "./voice-paragraph-context";
import { VoiceParagraphResultSchema } from "./voice-paragraph-result";
import { ForcedSegmentationSchema } from "./voice-forced-segmentation";

const SafeIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const ScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const AudioCandidateProvenanceSchema = z.object({
  provider: z.literal("voxcpm2"),
  model: z.string().min(1),
  seed: z.number().int().nonnegative(),
  temperature: z.number().min(0).max(2),
  voicePackId: VoiceGenerationOptionsSchema.shape.voicePackId,
  referenceMode: VoiceReferenceModeSchema,
  generationMode: z.enum(["clip", "long_text", "paragraph"]),
  parameters: z.record(z.string(), ScalarSchema),
  runtimeVersion: z.string().min(1).optional(),
  modelIdentity: z.string().min(1).optional(),
  referenceIdentity: z.string().min(1).optional(),
  longText: VoiceLongTextResultSchema.optional(),
  paragraph: VoiceParagraphResultSchema.optional(),
  forcedSegmentation: ForcedSegmentationSchema.optional(),
}).strict().superRefine((provenance, context) => {
  if ((provenance.generationMode === "long_text") !== (provenance.longText !== undefined)) {
    context.addIssue({ code: "custom", path: ["longText"], message: "Long-text provenance is required only for long-text generation" });
  }
  if ((provenance.generationMode === "paragraph") !== (provenance.paragraph !== undefined)) {
    context.addIssue({ code: "custom", path: ["paragraph"], message: "Paragraph provenance is required only for paragraph generation" });
  }
  const forced = provenance.forcedSegmentation;
  if (forced) {
    const issue = (message: string) => context.addIssue({ code: "custom", path: ["forcedSegmentation"], message });
    if (provenance.generationMode === "paragraph") {
      const paragraph = provenance.paragraph, alignment = forced.alignments[0];
      if (!paragraph || paragraph.checkStatus !== "passed" || forced.alignments.length !== 1
        || alignment.groupIndex !== 0 || alignment.sourceAssetId !== paragraph.sourceAsset.assetId
        || Math.abs(alignment.sourceFrames / 48_000 - paragraph.sourceAsset.duration) > 1 / 48_000
        || (alignment.method === "ctc_forced" && alignment.mode !== "paragraph")
        || alignment.cutFrames.length !== paragraph.segments.length - 1
        || paragraph.segments.some((segment, index) => Math.round(segment.cutEndSeconds * 48_000)
          !== (alignment.cutFrames[index] ?? alignment.sourceFrames))) issue("Forced paragraph evidence must bind its complete original PCM partition");
    } else if (provenance.generationMode === "long_text" && provenance.longText) {
      const groups = provenance.longText.groups;
      if (forced.alignments.some(alignment => {
        const group = groups[alignment.groupIndex];
        const endpoint = alignment.method === "whole_recording" ? alignment.sourceFrames : alignment.cutFrames[0];
        return !group || group.checkStatus !== "passed" || group.segmentationMethod !== alignment.method
          || (alignment.method === "ctc_forced" && alignment.mode !== "prefix")
          || group.cutStartSeconds !== 0 || Math.abs(group.cutEndSeconds * 48_000 - endpoint) > 1
          || Math.abs(group.asset.duration * 48_000 - endpoint) > 1;
      }) || groups.some(group => group.segmentationMethod && !forced.alignments.some(alignment => alignment.groupIndex === group.index))) {
        issue("Forced long-text evidence must bind each retained group endpoint");
      }
    } else issue("Forced segmentation requires a saved paragraph or long-text source");
  } else if (provenance.longText?.groups.some(group => group.segmentationMethod)) {
    context.addIssue({ code: "custom", path: ["forcedSegmentation"], message: "Forced group markers require their alignment receipt" });
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
  const paragraph = candidate.provenance.paragraph;
  if (paragraph) {
    const segment = paragraph.segments.find((segment) => segment.clipId === candidate.clipId);
    const asset = paragraph.checkStatus !== "review" ? segment?.asset : paragraph.sourceAsset;
    if (!paragraph.clipIds.includes(candidate.clipId) || !asset || JSON.stringify(asset) !== JSON.stringify(candidate.asset)) {
      context.addIssue({ code: "custom", path: ["asset"], message: "Paragraph candidate must bind its verified segment or retained full original" });
    }
  }
  if (candidate.provenance.longText?.baseCandidateId === candidate.candidateId) {
    context.addIssue({ code: "custom", path: ["provenance", "longText", "baseCandidateId"], message: "A rerolled candidate must refer to a different source candidate" });
  }
  if (candidate.provenance.forcedSegmentation?.sourceCandidateId === candidate.candidateId) {
    context.addIssue({ code: "custom", path: ["provenance", "forcedSegmentation"], message: "Forced output must refer to an earlier candidate" });
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

export type AudioCandidateWorkspaceMode = "short" | "paragraph";
export function getAudioCandidateWorkspaceMode(candidate: Pick<AudioCandidate, "provenance">): AudioCandidateWorkspaceMode {
  return candidate.provenance.generationMode === "paragraph" ? "paragraph" : "short";
}

export function getVoiceCandidateSourceFingerprint(clip: TimelineClip, context?: VoiceGenerationContext, paragraph?: VoiceParagraphContext): string {
  if (clip.type !== "voice") throw new Error("仅人声片段支持声音候选。");
  // Timing and the previous generated asset may change while comparing takes.
  return JSON.stringify({ text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace, ...(context ? { context } : {}), ...(paragraph ? { paragraph } : {}) });
}

export function getVoiceCandidateRequestFingerprint(clip: TimelineClip, options: VoiceGenerationOptions, longTextRetry?: LongTextRetry, context?: VoiceGenerationContext, paragraph?: VoiceParagraphContext): string {
  return JSON.stringify({
    source: getVoiceCandidateSourceFingerprint(clip, options.generationMode === "long_text" ? context : undefined, options.generationMode === "paragraph" ? paragraph : undefined),
    options: VoiceGenerationOptionsSchema.parse(options),
    requestedSeed: clip.generation.seed,
    requestedTemperature: clip.generation.temperature,
    ...(longTextRetry ? { longTextRetry } : {}),
  });
}
