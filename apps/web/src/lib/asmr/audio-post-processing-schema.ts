import { z } from "zod";

export const AUDIO_POST_PROCESSING_RENDERER_VERSION = "processed-voice-v1";
export const AudioPostProcessingAnchorSchema = z.object({
  pan: z.number().finite().min(-1).max(1),
  distance: z.enum(["far", "mid", "near", "close", "very_close"]),
}).strict();
export const AudioPostProcessingMovementSchema = z.enum(["static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"]);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const sha = z.string().regex(/^[a-fA-F0-9]{64}$/);
const fingerprint = z.string().regex(/^audio-post-v1:[a-f0-9]{32}$/);
export const AudioPostProcessingShotSchema = z.object({
  clipId: z.string().min(1).max(200), sourceAssetId: id, sourceSha256: sha,
  durationSeconds: z.number().finite().positive().max(600), reason: z.string().trim().min(1).max(600),
  start: AudioPostProcessingAnchorSchema, end: AudioPostProcessingAnchorSchema,
  movement: AudioPostProcessingMovementSchema, reset: z.boolean(),
}).strict();
export const AudioPostProcessingAssetSchema = z.object({
  assetId: id, uri: z.string().max(240), duration: z.number().finite().positive().max(660),
}).strict().refine(asset => asset.uri === `asset://clip/${asset.assetId}`, { message: "后处理成品引用无效。" });
export const AudioPostProcessingReceiptSchema = z.object({
  clipId: z.string().min(1).max(200), sourceAssetId: id, inputFingerprint: fingerprint,
  asset: AudioPostProcessingAssetSchema, sourceSha256: sha, outputSha256: sha,
  settingsFingerprint: z.string().min(1).max(8192), rendererVersion: z.string().min(1).max(100),
}).strict();
export const AudioPostProcessingSchema = z.object({
  version: z.literal(1), inputFingerprint: fingerprint, provider: z.literal("api"), model: z.string().min(1).max(160),
  shots: z.array(AudioPostProcessingShotSchema).min(1).max(400),
  results: z.record(z.string().min(1).max(200), AudioPostProcessingReceiptSchema),
}).strict().superRefine((state, context) => {
  if (new Set(state.shots.map(shot => shot.clipId)).size !== state.shots.length) context.addIssue({ code: "custom", message: "后处理分镜编号重复。", path: ["shots"] });
  for (const [clipId, receipt] of Object.entries(state.results)) if (clipId !== receipt.clipId) context.addIssue({ code: "custom", message: "后处理回执编号不一致。", path: ["results", clipId] });
});
export type AudioPostProcessingAnchor = z.infer<typeof AudioPostProcessingAnchorSchema>;
export type AudioPostProcessingMovement = z.infer<typeof AudioPostProcessingMovementSchema>;
export type AudioPostProcessingShot = z.infer<typeof AudioPostProcessingShotSchema>;
export type AudioPostProcessingReceipt = z.infer<typeof AudioPostProcessingReceiptSchema>;
export type AudioPostProcessing = z.infer<typeof AudioPostProcessingSchema>;
