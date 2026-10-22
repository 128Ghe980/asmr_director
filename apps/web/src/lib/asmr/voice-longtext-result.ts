import { z } from "zod";
import { validateVoiceLongTextAnalysis } from "./voice-longtext-plan";
import { VoiceGenerationContextSchema } from "./voice-generation-context";
import { VoiceRecognitionSchema, isCuttingOnlyRecognition } from "./voice-recognition";

const PauseClass = z.enum(["short", "medium", "long"]);
const Scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const VoiceLongTextResultSchema = z.object({
  version: z.literal(1),
  analysisProvider: z.string().min(1),
  analysisModel: z.string().optional(),
  context: VoiceGenerationContextSchema.optional(),
  plan: z.object({
    clauses: z.array(z.string().min(1)).min(1).max(500),
    groups: z.array(z.object({ start: z.number().int().min(0), end: z.number().int().min(0), text: z.string().min(1), pauseAfter: PauseClass }).strict()).min(1).max(12),
    clausePauseClasses: z.array(PauseClass), provider: z.string(), model: z.string().optional(), warnings: z.array(z.string()),
  }).strict().optional(),
  baseCandidateId: z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/).optional(),
  rerolledGroup: z.number().int().min(0).max(11).optional(),
  groups: z.array(z.object({
    index: z.number().int().nonnegative(),
    text: z.string().min(1),
    inputText: z.string().min(1),
    paddingClauses: z.array(z.string()),
    isFinal: z.boolean(),
    pauseAfter: PauseClass,
    seed: z.number().int().positive(),
    parameters: z.record(z.string(), Scalar),
    asset: z.object({ assetId: z.string().regex(/^[A-Za-z0-9_-]+$/), uri: z.string().regex(/^asset:\/\/clip\/[A-Za-z0-9_-]+$/), duration: z.number().positive() }).strict(),
    internalPausesMs: z.array(z.number().finite().min(0)),
    internalPauseClasses: z.array(PauseClass),
    internalPausePositions: z.array(z.number().int().min(0).max(30)).max(31).optional(),
    leadingQuietMs: z.number().finite().min(0),
    trailingQuietMs: z.number().finite().min(0),
    transcript: z.string(),
    recognition: VoiceRecognitionSchema.optional(),
    coverage: z.number().min(0).max(1),
    cutStartSeconds: z.number().min(0),
    cutEndSeconds: z.number().positive(),
    attempts: z.number().int().positive(),
    checkStatus: z.enum(["passed", "review"]).optional(),
    segmentationMethod: z.enum(["ctc_forced", "whole_recording"]).optional(),
    diagnosticCode: z.string().min(1).max(120).regex(/^[a-z0-9_]+$/).optional(),
    runtimeVersion: z.string().optional(),
    referenceIdentity: z.string().optional(),
  }).strict()).min(1).max(12),
  joins: z.array(z.object({
    durationMs: z.number().finite().min(0),
    actualDurationMs: z.number().finite().min(0),
    source: z.enum(["adjacent", "same_class", "default"]),
    category: PauseClass,
  }).strict()).max(11),
  loudnessGainDb: z.number().finite(),
  asrModel: z.string(),
}).strict().superRefine((result, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (result.joins.length !== result.groups.length - 1) issue(["joins"], "Long-text joins must connect every adjacent group exactly once");
  result.groups.forEach((group, index) => {
    if (group.index !== index) issue(["groups", index, "index"], "Long-text group indices must be ordered and contiguous");
    if (group.isFinal !== (index === result.groups.length - 1 && (result.context?.isFinal ?? true))) issue(["groups", index, "isFinal"], "Final speech must agree with its project context");
    if (group.asset.uri !== `asset://clip/${group.asset.assetId}`) issue(["groups", index, "asset", "uri"], "Group asset URI must match its stable clip asset id");
    const unmeasuredReview = group.checkStatus === "review" && group.internalPausesMs.length === 0;
    if (!unmeasuredReview && group.internalPausesMs.length !== group.internalPauseClasses.length) issue(["groups", index, "internalPauseClasses"], "Every measured internal pause must have a corresponding class");
    if (group.segmentationMethod && group.checkStatus !== "passed") issue(["groups", index, "segmentationMethod"], "Forced segmentation must describe a completed cut");
    if ((isCuttingOnlyRecognition(group.recognition) || group.segmentationMethod) && group.checkStatus !== "review") {
      const positions = group.internalPausePositions;
      if (group.checkStatus !== "passed" || (!group.segmentationMethod && group.recognition?.stage !== "complete") || !positions
        || positions.length !== group.internalPausesMs.length
        || positions.some((position, offset) => offset > 0 && position <= positions[offset - 1])) {
        issue(["groups", index, "internalPausePositions"], "Cutting-only results require ordered real pause measurements");
      }
    }
    if (group.cutEndSeconds <= group.cutStartSeconds) issue(["groups", index, "cutEndSeconds"], "Group audio end must follow its start");
    if (result.joins[index] && result.joins[index].category !== group.pauseAfter) issue(["joins", index, "category"], "Join category must match its preceding group boundary");
  });
  const hasBase = result.baseCandidateId !== undefined;
  const hasReroll = result.rerolledGroup !== undefined;
  if (hasBase !== hasReroll) issue([hasBase ? "rerolledGroup" : "baseCandidateId"], "A group reroll must record both its source candidate and target group");
  if (result.rerolledGroup !== undefined && result.rerolledGroup >= result.groups.length) issue(["rerolledGroup"], "The rerolled group must exist in this result");
  if (result.plan) {
    const plan = result.plan;
    if (plan.groups.length !== result.groups.length) issue(["plan", "groups"], "Planned and generated group counts must agree");
    try {
      validateVoiceLongTextAnalysis(plan.clauses, {
        groups: plan.groups.map(({ start, end, pauseAfter }) => ({ start, end, pauseAfter })),
        clausePauseClasses: plan.clausePauseClasses,
      });
    } catch {
      issue(["plan"], "The stored plan must cover every original clause once and preserve boundary classes");
    }
    plan.groups.forEach((group, index) => {
      const text = plan.clauses.slice(group.start, group.end + 1).join("");
      if (group.text !== text) issue(["plan", "groups", index, "text"], "Planned group text must match its original clause range");
      const actual = result.groups[index];
      if (!actual) return;
      if (actual.text !== group.text) issue(["groups", index, "text"], "Generated group text must match its planned group");
      if (actual.pauseAfter !== group.pauseAfter) issue(["groups", index, "pauseAfter"], "Generated group boundary must match the plan");
      const classes = plan.clausePauseClasses.slice(group.start, group.end);
      const positions = (isCuttingOnlyRecognition(actual.recognition) || actual.segmentationMethod) && actual.checkStatus === "passed" ? actual.internalPausePositions : undefined;
      const measuredClasses = positions ? positions.map(position => classes[position]) : classes;
      if (positions?.some(position => position >= classes.length)
        || measuredClasses.length !== actual.internalPauseClasses.length || measuredClasses.some((value, position) => value !== actual.internalPauseClasses[position])) {
        issue(["groups", index, "internalPauseClasses"], "Generated internal boundaries must match the planned clause boundaries");
      }
    });
  }
});

export type VoiceLongTextResult = z.infer<typeof VoiceLongTextResultSchema>;
