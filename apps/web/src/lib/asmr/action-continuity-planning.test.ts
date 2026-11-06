import { describe, expect, it } from "vitest";
import { AsmrSoundSchema, getAsmrContinuationProblem, ASMR_ACTION_CONTINUITY_GUIDANCE } from "./asmr-sound";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { renderConciseH3Prompt } from "./h3-prompt";
import { PerformanceStoryboardPartSchema } from "./video-plan";

const sound = { ...asmrSoundFixture, role: "trigger" as const, mixMode: "overlay" as const,
  continuation: "previous-silent" as const };
const directions = { visual: "S1 holds a wooden tray below the visible mouth.",
  action: "S1 continues gentle fingertip taps while speaking, keeping the tray steady.",
  camera: "Fixed frontal medium shot.", dialogue: "这个声音听起来很轻，我们慢慢来。", durationSeconds: 8 };

describe("ASMR action continuity contract", () => {
  it("persists an explicit continuation without guessing or upgrading old plans", () => {
    expect(AsmrSoundSchema.parse(sound).continuation).toBe("previous-silent");
    expect(AsmrSoundSchema.parse(asmrSoundFixture).continuation).toBeUndefined();
    for (const continuation of [true, null, "previous", "other-shot"]) {
      expect(AsmrSoundSchema.safeParse({ ...sound, continuation }).success).toBe(false);
    }
  });

  it("requires a speaking trigger and the immediately preceding silent trigger", () => {
    const previous = { kind: "silent", asmrSound: { ...asmrSoundFixture, role: "trigger" as const } };
    expect(getAsmrContinuationProblem(sound, "speech", previous)).toBeUndefined();
    expect(getAsmrContinuationProblem(sound, undefined, previous)).toBeUndefined();
    expect(getAsmrContinuationProblem(asmrSoundFixture, "silent")).toBeUndefined();
    for (const invalid of [undefined, { ...previous, kind: "speech" }, { kind: "silent" },
      { ...previous, asmrSound: { ...asmrSoundFixture, role: "ambience" as const } }]) {
      expect(getAsmrContinuationProblem(sound, "speech", invalid)).toBeTruthy();
    }
    expect(getAsmrContinuationProblem(sound, "silent", previous)).toBeTruthy();
    expect(getAsmrContinuationProblem({ ...sound, role: "ambience" }, "speech", previous)).toBeTruthy();
    expect(getAsmrContinuationProblem({ ...sound, mixMode: "replace" }, "speech", previous)).toBeTruthy();
    expect(getAsmrContinuationProblem(sound, "speech", { ...previous,
      parts: [{ asmrSound: previous.asmrSound }, { asmrSound: { ...asmrSoundFixture, role: "ambience" } }] })).toBeTruthy();
    expect(getAsmrContinuationProblem(sound, "speech", { ...previous,
      asmrSound: { ...asmrSoundFixture, role: "ambience" }, parts: [{ asmrSound: previous.asmrSound }] })).toBeUndefined();
  });

  it("rejects a speech continuation marker inside silent generated parts", () => {
    expect(PerformanceStoryboardPartSchema.safeParse({ visual: directions.visual, action: directions.action,
      camera: directions.camera, durationSeconds: 8, ambientSound: "Soft wood taps.", asmrSound: sound }).success).toBe(false);
  });

  it("emphasizes synchronous native ASMR while keeping quiet moments and empty-handed staging intact", () => {
    const prompt = renderConciseH3Prompt({ ...directions, silent: true, dialogue: "", nativeAsmrFocus: true,
      pantomime: true, ambientSound: "Soft cotton friction foley matching the empty fingertip sweeps." });
    expect(prompt).toContain("ASMR performance for relaxation and sleep");
    expect(prompt).toContain("each sound onset, texture change and release");
    expect(prompt).toContain("hands hold nothing");
    expect(prompt).toContain("Sound-producing materials are not visible scene objects");
    expect(prompt).toContain("Quiet gaze and waiting keep only the specified quiet ambience");
    expect(prompt).not.toContain("<Audio 1>");
    expect(prompt).not.toContain("<d>");
  });

  it("assigns lip sync and hand timing to separate audio references", () => {
    const prompt = renderConciseH3Prompt({ ...directions, separateSpeechAndAsmr: true });
    expect(prompt).toContain("<Audio 1>: partially_copy - Adopted narration");
    expect(prompt).toContain("Mouth movements follow only the spoken words in <Audio 1>");
    expect(prompt).toContain("Time each indicated hand contact, release and still pause to <Audio 2>");
    expect(prompt).toContain(`<d>[Chinese]${directions.dialogue}</d>`);
    expect(prompt).toContain(`Action: ${directions.action}`);
    expect(renderConciseH3Prompt({ ...directions, separateSpeechAndAsmr: false, nativeAsmrFocus: false }))
      .toBe(renderConciseH3Prompt(directions));
  });

  it("distinguishes continuing a sustained action from replaying a completed one", () => {
    expect(ASMR_ACTION_CONTINUITY_GUIDANCE).toContain('continuation="previous-silent"');
    expect(ASMR_ACTION_CONTINUITY_GUIDANCE).toContain("上一段动作已经结束");
    expect(ASMR_ACTION_CONTINUITY_GUIDANCE).toContain("不能仅凭手位、材质或机位相同");
  });
});
