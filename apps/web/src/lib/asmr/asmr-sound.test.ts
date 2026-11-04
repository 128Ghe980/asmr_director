import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AsmrSoundSchema, renderAsmrSoundH3Prompt } from "./asmr-sound";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";

describe("independent ASMR sound plan", () => {
  it("keeps legacy prompt bytes stable unless the plan opts into a sound role", () => {
    const legacy = AsmrSoundSchema.parse(asmrSoundFixture);
    expect(legacy.role).toBeUndefined();
    expect(createHash("sha256").update(renderAsmrSoundH3Prompt(legacy)).digest("hex"))
      .toBe("1c4422a7602a3e661adcec37b3bfefccfb9651b7543c9302883879b6f1aca40f");
  });
  it("records an explicit trigger as visible material ASMR while preserving its unique sound instructions", () => {
    const source = "An adult hand slides two folded cotton jersey layers together; each slow pass makes a low muted shff, then stops as the layers relax.";
    const prompt = renderAsmrSoundH3Prompt({ ...asmrSoundFixture, role: "trigger", prompt: source });
    expect(prompt).toContain(source);
    expect(prompt).toContain("ASMR trigger recording for relaxation and sleep");
    expect(prompt).toContain("real physical contact");
    expect(prompt).toContain("material-specific attack");
    expect(prompt).toContain("clearly audible");
    expect(prompt).not.toMatch(/<Picture|<Audio|<Subject|empty-handed|without actual contact|barely audible|almost silent|seconds/);
    expect(prompt.split("\n\n").map(line => line.split(":")[0]))
      .toEqual(["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]);
  });
  it("does not instruct hand contacts or material performance for quiet ambience", () => {
    const prompt = renderAsmrSoundH3Prompt({ ...asmrSoundFixture, role: "ambience", prompt: "Steady quiet indoor room tone, no distinct events." });
    expect(prompt).toContain("Steady quiet indoor room tone");
    expect(prompt).toContain("without a hand performance");
    expect(prompt).toContain("no added foreground foley");
    expect(prompt).not.toContain("sound-producing material");
    expect(prompt).not.toContain("Match audible contacts");
    expect(prompt).not.toContain("Show real physical contact");
    expect(prompt).toContain("No speech, whispering, vocal sounds");
  });
  it("accepts the two explicit roles and rejects unsupported roles without silently coercing legacy data", () => {
    for (const role of ["trigger", "ambience"]) expect(AsmrSoundSchema.parse({ ...asmrSoundFixture, role }).role).toBe(role);
    for (const role of ["voice", "", null, false]) expect(AsmrSoundSchema.safeParse({ ...asmrSoundFixture, role }).success).toBe(false);
  });
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
