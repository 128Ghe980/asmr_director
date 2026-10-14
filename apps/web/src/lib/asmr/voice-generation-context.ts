import { z } from "zod";
import type { AsmrProject } from "./schema";
import { continuationClause, splitVoiceClauses, VOICE_LONGTEXT_WINDOW_CLAUSES } from "./voice-longtext-plan";

export const VoiceGenerationContextSchema = z.object({
  version: z.literal(1),
  followingClauses: z.array(z.string().min(1).max(500)).max(500),
  isFinal: z.boolean(),
}).strict().refine((context) => !context.isFinal || context.followingClauses.length === 0, {
  message: "Final speech cannot have following context",
});

export type VoiceGenerationContext = z.infer<typeof VoiceGenerationContextSchema>;

function prefix(text: string, limit: number): string {
  let end = Math.max(0, Math.min(text.length, limit));
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}

/** Derive only the forward context within the 16-clause recipe and 500-character safety limit.
 * No earlier clip, sound effect or out-of-window text affects this snapshot.
 * A partial final context clause is allowed; target speech is never truncated.
 */
export function getVoiceGenerationContext(project: AsmrProject, clipId: string): VoiceGenerationContext | undefined {
  const voices = project.timeline.tracks.find((track) => track.track_type === "voice")?.clips;
  if (!voices) return undefined;
  const ordered = [...voices].sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  const target = ordered[index];
  if (!target?.semantic_unit || target.kind === "silent") return undefined;
  const suffix = ordered.slice(index + 1);
  const silentBoundary = suffix.findIndex((clip) => clip.kind === "silent");
  const following = (silentBoundary < 0 ? suffix : suffix.slice(0, silentBoundary))
    .filter((clip) => /[\p{L}\p{N}]/u.test(clip.text));
  if (!following.length) return { version: 1, followingClauses: [], isFinal: true };
  const readableTarget = prefix(target.text.trim(), 500);
  const targetClauses = /[\p{L}\p{N}]/u.test(readableTarget) ? splitVoiceClauses(readableTarget) : [readableTarget];
  const maximumFollowingClauses = Math.max(0, VOICE_LONGTEXT_WINDOW_CLAUSES - targetClauses.length);
  let available = 500 - targetClauses.map(continuationClause).join("").length;
  const followingClauses: string[] = [];
  for (const clip of following) {
    if (available <= 2 || followingClauses.length >= maximumFollowingClauses) break;
    const text = prefix(clip.text.trim(), 500);
    if (!/[\p{L}\p{N}]/u.test(text)) break;
    const clauses = splitVoiceClauses(text);
    for (const clause of clauses) {
      if (followingClauses.length >= maximumFollowingClauses) break;
      if (continuationClause(clause).length <= available) {
        followingClauses.push(clause);
        available -= continuationClause(clause).length;
      } else {
        const part = prefix(clause, available - 2);
        if (/[\p{L}\p{N}]/u.test(part)) followingClauses.push(part);
        return { version: 1, followingClauses, isFinal: false };
      }
    }
    // Do not skip over a truncated long clip to a later paragraph.
    if (text.length < clip.text.trim().length) break;
  }
  return { version: 1, followingClauses, isFinal: false };
}
