import { describe, expect, it } from "vitest";
import { applyIndependentShotCadence } from "./video-generation-policy";

describe("independent shot cadence", () => {
  it("limits a requested continuous chain across expanded jobs without changing their content or input", () => {
    const shots = Array.from({ length: 8 }, (_, index) => ({ id: `job-${index}`, referenceMode: "continuous" as const,
      prompt: `phase ${index}`, durationSeconds: 10, segmentId: index < 5 ? "long-operation" : "next-task", partIndex: index + 1 }));
    const before = structuredClone(shots);
    const result = applyIndependentShotCadence(shots);
    expect(result.map(shot => shot.referenceMode)).toEqual(["new", "continuous", "continuous", "new", "continuous", "continuous", "new", "continuous"]);
    result.forEach((shot, index) => expect({ ...shot, referenceMode: before[index].referenceMode }).toEqual(before[index]));
    expect(shots).toEqual(before);
  });

  it("keeps every requested independent shot and restarts the count from it", () => {
    const modes = ["new", "continuous", "new", "continuous", "continuous", "continuous", "new"] as const;
    expect(applyIndependentShotCadence(modes.map(referenceMode => ({ referenceMode }))).map(shot => shot.referenceMode))
      .toEqual(["new", "continuous", "new", "continuous", "continuous", "new", "new"]);
    expect(applyIndependentShotCadence([])).toEqual([]);
  });
});
