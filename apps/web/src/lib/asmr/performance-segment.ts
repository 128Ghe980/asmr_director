import { z } from "zod";

/** Creative intent travels with a segment rather than being recovered from its text. */
export const PerformancePurposeSchema = z.enum(["dialogue", "asmr", "transition", "interaction"]);
export const PerformanceSegmentSchema = z.object({
  version: z.literal(1),
  segmentId: z.string().min(1).max(200),
  purpose: PerformancePurposeSchema,
  direction: z.string().max(1200),
  soundIntent: z.string().max(1200),
}).strict();
export type PerformanceSegment = z.infer<typeof PerformanceSegmentSchema>;

/** These are generation boundaries within one performance, not camera cuts. */
export function performancePartDurations(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 600) {
    throw new Error("无台词段时长须大于 0 且不超过 600 秒。");
  }
  const count = Math.ceil(durationSeconds / 5);
  // Spread the remainder so a 5.1 second segment does not end in a 0.1 second job.
  if (count === 1) return [durationSeconds];
  const boundary = (index: number) => Number((durationSeconds * index / count).toFixed(6));
  return Array.from({ length: count }, (_, index) => Number((boundary(index + 1) - boundary(index)).toFixed(6)));
}
