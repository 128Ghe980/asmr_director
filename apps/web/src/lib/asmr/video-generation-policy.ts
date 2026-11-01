/** Practical H3 job budget; existing longer performances can use multiple jobs. */
export const MAX_VIDEO_GENERATION_SECONDS = 15;
export const MAX_TAIL_LINKS = 2;

type ReferenceMode = "new" | "continuous";

/** Each fresh character-reference start permits at most two consecutive tail references.
 * Explicit independent shots reset the cadence early; inputs and their other fields stay intact. */
export function applyIndependentShotCadence<T extends { referenceMode: ReferenceMode }>(shots: readonly T[]): Array<Omit<T, "referenceMode"> & { referenceMode: ReferenceMode }> {
  let tailLinks = 0;
  return shots.map((shot, index) => {
    const independent = index === 0 || shot.referenceMode === "new" || tailLinks >= MAX_TAIL_LINKS;
    const referenceMode: ReferenceMode = independent ? "new" : "continuous";
    tailLinks = independent ? 0 : tailLinks + 1;
    return referenceMode === shot.referenceMode ? shot : { ...shot, referenceMode };
  });
}
