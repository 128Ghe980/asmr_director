import { describe, expect, it } from "vitest";
import { AsmrSoundSchema, renderAsmrSoundH3Prompt } from "./asmr-sound";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";

describe("independent ASMR sound plan", () => {
  it("renders reference-free T2VA with deterministic silent sound rules and no invented duration", () => {
    const prompt = renderAsmrSoundH3Prompt(asmrSoundFixture);
    expect(prompt).toContain(asmrSoundFixture.prompt);
    expect(prompt.split("\n\n").map(line => line.split(":")[0])).toEqual([
      "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music",
    ]);
    expect(prompt).toContain("No speech, whispering, vocal sounds");
    expect(prompt).toContain("non_diegetic_music: N/A");
    expect(prompt).not.toMatch(/<Audio|<Picture|<Subject|<d>|seconds|fully_copy/);
  });
  it("rejects missing, nonfinite, out-of-range and model-invented duration inputs", () => {
    for (const patch of [{ prompt: "  " }, { durationSeconds: 10 }, { postProcessing: { ...asmrSoundFixture.postProcessing, gainDb: 7 } },
      { postProcessing: { ...asmrSoundFixture.postProcessing, gainDb: Number.NaN } },
      { postProcessing: { ...asmrSoundFixture.postProcessing, start: { pan: 2, distance: "near" } } }]) {
      expect(AsmrSoundSchema.safeParse({ ...asmrSoundFixture, ...patch }).success).toBe(false);
    }
  });
});
