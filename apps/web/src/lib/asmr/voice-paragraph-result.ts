import { z } from "zod";
import { ShortSentenceReviewSchema, VoiceRecognitionSchema, normalizeVoiceSentenceParticleText } from "./voice-recognition";

const SafeId = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const Asset = z.object({ assetId: SafeId, uri: z.string(), duration: z.number().finite().positive() }).strict()
  .refine((asset) => asset.uri === `asset://clip/${asset.assetId}`, "Paragraph asset URI must match its id");

export const VoiceParagraphResultSchema = z.object({
  version: z.literal(1), groupId: z.string().min(1).max(240), text: z.string().min(1).max(500),
  clipIds: z.array(z.string().min(1).max(240)).min(1).max(32), sourceAsset: Asset,
  checkStatus: z.enum(["passed", "review", "needs_confirmation"]),
  segments: z.array(z.object({
    clipId: z.string().min(1).max(240), text: z.string().min(1).max(500), asset: Asset,
    cutStartSeconds: z.number().finite().nonnegative(), cutEndSeconds: z.number().finite().positive(),
    recognition: VoiceRecognitionSchema.optional(),
    textReview: ShortSentenceReviewSchema.optional(),
  }).strict()).max(32),
  manualTextConfirmation: z.object({
    sourceCandidateId: SafeId, confirmedClipIds: z.array(z.string().min(1).max(240)).min(1).max(32), confirmedAt: z.string().datetime(),
  }).strict().optional(),
  diagnosticCode: z.string().regex(/^[a-z0-9_]{1,120}$/).optional(),
  failedClipId: z.string().min(1).max(240).optional(),
  failureRecognition: VoiceRecognitionSchema.optional(),
}).strict().superRefine((result, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (new Set(result.clipIds).size !== result.clipIds.length) issue(["clipIds"], "Paragraph clip IDs must be unique");
  if (result.failedClipId && !result.clipIds.includes(result.failedClipId)) issue(["failedClipId"], "Failed sentence must belong to this paragraph");
  if (result.failureRecognition && (!result.failedClipId || !result.text.endsWith(result.failureRecognition.expectedText + (result.failureRecognition.followingText ?? "")))) {
    issue(["failureRecognition"], "Failure evidence must describe a remaining suffix of this paragraph");
  }
  if (result.checkStatus === "review") {
    if (result.segments.length) issue(["segments"], "Unsafe paragraph cuts must not publish short segments");
    if (result.manualTextConfirmation) issue(["manualTextConfirmation"], "Unsafe paragraph cuts cannot be manually confirmed");
    return;
  }
  if (result.failedClipId || result.failureRecognition) issue(["failureRecognition"], "Passed paragraph cannot retain a failed sentence");
  if (result.segments.length !== result.clipIds.length) issue(["segments"], "Every paragraph clip requires one verified segment");
  if (result.segments.map((segment) => segment.text).join("") !== result.text) issue(["text"], "Paragraph segments must preserve all original text");
  result.segments.forEach((segment, index) => {
    if (segment.clipId !== result.clipIds[index]) issue(["segments", index, "clipId"], "Paragraph segments must follow clip order");
    const previousEnd = index ? result.segments[index - 1].cutEndSeconds : 0;
    if (Math.abs(segment.cutStartSeconds - previousEnd) > 1 / 48_000) issue(["segments", index, "cutStartSeconds"], "Paragraph cuts must preserve every original PCM frame");
    if (segment.cutEndSeconds <= segment.cutStartSeconds || segment.cutEndSeconds > result.sourceAsset.duration + 1 / 48_000) issue(["segments", index, "cutEndSeconds"], "Invalid paragraph cut range");
    if (Math.abs(segment.asset.duration - (segment.cutEndSeconds - segment.cutStartSeconds)) > 1 / 48_000) issue(["segments", index, "asset"], "Paragraph asset duration must match its original PCM range");
    if (segment.textReview && (segment.recognition?.stage !== "complete"
      || segment.recognition.expectedText !== segment.text
      || (segment.recognition.followingText ?? "") !== result.segments.slice(index + 1).map((later) => later.text).join("")
      || segment.textReview.expected !== normalizeVoiceSentenceParticleText(segment.text)
      || JSON.stringify(segment.textReview) !== JSON.stringify(segment.recognition.shortSentenceReview))) {
      issue(["segments", index, "textReview"], "Text review must retain its complete bound recognition evidence");
    }
    if (!segment.textReview && segment.recognition?.shortSentenceReview) issue(["segments", index, "textReview"], "Short sentence review cannot be omitted");
  });
  if (Math.abs((result.segments.at(-1)?.cutEndSeconds ?? 0) - result.sourceAsset.duration) > 1 / 48_000) issue(["segments"], "Paragraph slices must retain the complete original recording");
  const reviewIds = result.segments.filter((segment) => segment.textReview).map((segment) => segment.clipId);
  if ((result.checkStatus === "needs_confirmation") !== Boolean(reviewIds.length)) issue(["checkStatus"], "Safe text-review slices must remain needs_confirmation");
  if (result.manualTextConfirmation && (result.checkStatus !== "needs_confirmation"
    || JSON.stringify(result.manualTextConfirmation.confirmedClipIds) !== JSON.stringify(reviewIds))) {
    issue(["manualTextConfirmation"], "Manual confirmation must cover precisely the ordered text-review sentences");
  }
});
export type VoiceParagraphResult = z.infer<typeof VoiceParagraphResultSchema>;

export function getVoiceParagraphReviewClipIds(paragraph: VoiceParagraphResult): string[] {
  return paragraph.segments.filter((segment) => segment.textReview).map((segment) => segment.clipId);
}
export function isVoiceParagraphManuallyConfirmed(paragraph: VoiceParagraphResult): boolean {
  return paragraph.checkStatus === "needs_confirmation" && Boolean(paragraph.manualTextConfirmation)
    && JSON.stringify(paragraph.manualTextConfirmation?.confirmedClipIds) === JSON.stringify(getVoiceParagraphReviewClipIds(paragraph));
}
