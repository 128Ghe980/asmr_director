import { describe, expect, it } from "vitest";
import { makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { VoiceLongTextResultSchema, type VoiceLongTextResult } from "./voice-longtext-result";

describe("persisted long-text result integrity", () => {
  it("stores only measured internal pauses for cutting-only results at zero literal coverage", () => {
    const result = makeVoiceLongTextResultFixture(), group = result.groups[0];
    group.checkStatus = "passed";
    group.coverage = 0;
    group.transcript = "不同的定位词";
    group.recognition = { analysisMode: "cutting_only", stage: "complete", sourceTranscript: "不同的定位词后文",
      expectedText: group.text, targetTranscript: group.transcript };
    group.internalPausesMs = [];
    group.internalPauseClasses = [];
    group.internalPausePositions = [];
    expect(VoiceLongTextResultSchema.parse(result)).toEqual(result);
    group.internalPausesMs = [120];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
    group.internalPausePositions = [0];
    group.internalPauseClasses = ["short"];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(true);
    group.internalPausePositions = [1];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
  });

  it("accepts a complete plan/result and the earlier result format without an optional plan", () => {
    const result = makeVoiceLongTextResultFixture();
    expect(VoiceLongTextResultSchema.parse(result)).toEqual(result);
    delete result.plan;
    expect(VoiceLongTextResultSchema.parse(result)).toEqual(result);
  });

  it("accepts a valid single-group result with no joins or reroll metadata", () => {
    const result = makeVoiceLongTextResultFixture();
    delete result.plan;
    result.groups = [result.groups[1]];
    result.groups[0].index = 0;
    result.joins = [];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(true);
  });

  it("preserves an unverified full recording without inventing pause measurements or losing planned classes", () => {
    const result = makeVoiceLongTextResultFixture();
    const group = result.groups[0];
    group.checkStatus = "review";
    group.diagnosticCode = "cut_text_mismatch";
    group.internalPausesMs = [];
    group.transcript = "";
    group.coverage = 0;
    expect(group.internalPauseClasses).not.toHaveLength(0);
    expect(VoiceLongTextResultSchema.parse(result)).toEqual(result);
  });

  it("retains strict measurement and plan integrity for review groups", () => {
    const result = makeVoiceLongTextResultFixture();
    result.groups[0].checkStatus = "review";
    result.groups[0].internalPausesMs = [100, 200];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
    result.groups[0].internalPausesMs = [];
    result.groups[0].internalPauseClasses = [];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
  });

  it("does not let passed groups omit measurements or store raw diagnostic output", () => {
    const result = makeVoiceLongTextResultFixture();
    result.groups[0].checkStatus = "passed";
    result.groups[0].internalPausesMs = [];
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
    result.groups[0].checkStatus = "review";
    result.groups[0].diagnosticCode = "Error: C:/private/file.wav";
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
  });

  const corruptions: [string, (value: VoiceLongTextResult) => void][] = [
    ["duplicate group indices", (value) => { value.groups[1].index = 0; }],
    ["non-zero first group index", (value) => { value.groups[0].index = 1; }],
    ["early final group", (value) => { value.groups[0].isFinal = true; }],
    ["missing final group", (value) => { value.groups[1].isFinal = false; }],
    ["missing join", (value) => { value.joins = []; }],
    ["extra join", (value) => { value.joins.push({ ...value.joins[0] }); }],
    ["mismatched join category", (value) => { value.joins[0].category = "short"; }],
    ["mismatched stable group asset URI", (value) => { value.groups[0].asset.uri = "asset://clip/another_group"; }],
    ["unclassified internal pause", (value) => { value.groups[0].internalPauseClasses = []; }],
    ["unmeasured internal boundary", (value) => { value.groups[0].internalPausesMs = []; }],
    ["reversed audio cut", (value) => { value.groups[0].cutStartSeconds = value.groups[0].cutEndSeconds; }],
    ["different plan group count", (value) => { value.plan!.groups.pop(); }],
    ["overlapping planned clauses", (value) => { value.plan!.groups[1].start = 1; }],
    ["out-of-bounds planned clause", (value) => { value.plan!.groups[1].end = 99; }],
    ["missing source tail", (value) => { value.plan!.clauses.push("被遗漏的最后一句。"); value.plan!.clausePauseClasses.push("medium"); }],
    ["rewritten generated text", (value) => { value.groups[0].text = "不是原文。"; }],
    ["rewritten plan and generated text", (value) => { value.plan!.groups[0].text = "不是原文。"; value.groups[0].text = "不是原文。"; }],
    ["different generated boundary class", (value) => { value.groups[0].pauseAfter = "short"; value.joins[0].category = "short"; }],
    ["different stored boundary class", (value) => { value.plan!.clausePauseClasses[1] = "long"; }],
    ["missing plan boundary class", (value) => { value.plan!.clausePauseClasses.pop(); }],
    ["different generated internal class", (value) => { value.groups[0].internalPauseClasses[0] = "medium"; }],
    ["fewer internal boundaries than plan clauses", (value) => { value.groups[0].internalPausesMs = []; value.groups[0].internalPauseClasses = []; }],
    ["missing rerolled group", (value) => { value.baseCandidateId = "original_candidate"; }],
    ["missing reroll source candidate", (value) => { value.rerolledGroup = 0; }],
    ["invalid source candidate id", (value) => { value.baseCandidateId = "../candidate"; value.rerolledGroup = 0; }],
    ["nonexistent rerolled group", (value) => { value.baseCandidateId = "original_candidate"; value.rerolledGroup = 2; }],
  ];
  it.each(corruptions)("rejects %s before persisting or reusing a group", (_name, corrupt) => {
    const result = makeVoiceLongTextResultFixture();
    corrupt(result);
    expect(VoiceLongTextResultSchema.safeParse(result).success).toBe(false);
  });

  it("accepts a rerolled group zero as a present index and preserves natural pause measurements", () => {
    const result = makeVoiceLongTextResultFixture();
    result.baseCandidateId = "original_candidate";
    result.rerolledGroup = 0;
    result.groups[0].internalPausesMs = [0];
    // Out-of-class natural pauses remain evidence. The pause chooser handles
    // their validity; persistence must not discard or reinterpret measurements.
    result.groups[1].internalPausesMs = [1250];
    result.joins[0].actualDurationMs = 420;
    expect(VoiceLongTextResultSchema.parse(result)).toEqual(result);
  });
});
