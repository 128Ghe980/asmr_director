import { describe, expect, it } from "vitest";

import {
  buildLongTextInputs,
  chooseGroupPauses,
  createRuleVoiceLongTextPlan,
  splitVoiceClauses,
  validateVoiceLongTextAnalysis,
  VOICE_CONTINUATION_CLAUSES,
  type VoiceLongTextPlan,
  type VoicePauseClass,
} from "./voice-longtext-plan";

const originalClauses = [
  "夜已经很深了", "窗外只剩下很轻的雨声", "房间里的灯也慢慢暗了下来", "把手机放到一旁",
  "让肩膀安稳地靠在柔软的枕头上", "今天没有处理完的事情", "都可以先留到明天", "不需要现在给出答案",
  "那些还没有平静下来的念头", "也可以暂时放在门外", "接下来只要安静地听着我的声音", "让身体一点一点变得轻松",
  "我会一直陪在这里", "不催促你", "也不会突然离开", "直到困意自然地靠近",
];

function acceptedPlan(): VoiceLongTextPlan {
  const clauses = originalClauses.map((clause) => clause + "……");
  const clausePauseClasses = clauses.slice(0, -1).map((): VoicePauseClass => "short");
  const ends = [2, 4, 7, 9, 11, 15];
  for (const end of ends.slice(0, -1)) clausePauseClasses[end] = "medium";
  const groups = ends.map((end, index) => ({ start: index ? ends[index - 1] + 1 : 0, end, pauseAfter: clausePauseClasses[end] ?? "long" }));
  return { clauses, ...validateVoiceLongTextAnalysis(clauses, { groups, clausePauseClasses }), provider: "fixture", warnings: [] };
}

describe("long-text source planning", () => {
  it("preserves exact text coverage, whitespace and closing quotes while respecting numeric separators", () => {
    const text = "现在是12:30，温度是3.14，数字1,000。\n她说：“你好。”  慢慢休息……晚安！";
    const clauses = splitVoiceClauses(text);
    expect(clauses.join("")).toBe(text);
    expect(clauses.slice(0, 3)).toEqual(["现在是12:30，", "温度是3.14，", "数字1,000。\n"]);
    expect(clauses).toContain("“你好。”  ");
    expect(clauses).toContain("慢慢休息……");
  });

  it("rejects blank, unreadable and oversized scripts", () => {
    for (const text of ["  ", "……？！", "字".repeat(501)]) expect(() => splitVoiceClauses(text)).toThrow();
  });

  it("accepts one short group and bounds fallback groups without losing any source", () => {
    expect(createRuleVoiceLongTextPlan(splitVoiceClauses("晚安。慢慢休息。"))).toMatchObject({ groups: [{ start: 0, end: 1 }], provider: "rules" });
    const clauses = splitVoiceClauses(Array.from({ length: 100 }, (_, index) => `第${index}句，`).join(""));
    const plan = createRuleVoiceLongTextPlan(clauses);
    expect(plan.groups.length).toBeLessThanOrEqual(12);
    expect(plan.groups.map((group) => group.text).join("")).toBe(clauses.join(""));
    expect(() => buildLongTextInputs(plan)).toThrow("500"); // Added ellipses cannot truncate source to fit.
    const longer = createRuleVoiceLongTextPlan(splitVoiceClauses(("字".repeat(30) + "，").repeat(4)));
    expect(longer.groups.map(({ start, end }) => [start, end])).toEqual([[0, 1], [2, 3]]);
  });

  it("rejects omitted, overlapping, reordered, rewritten and inconsistent model groups", () => {
    const clauses = ["一，", "二，", "三。"];
    const base = { groups: [{ start: 0, end: 1, pauseAfter: "medium" }, { start: 2, end: 2, pauseAfter: "long" }], clausePauseClasses: ["short", "medium"] };
    expect(validateVoiceLongTextAnalysis(clauses, base).groups.map((group) => group.text)).toEqual(["一，二，", "三。"]);
    const invalid = [
      { ...base, groups: [{ start: 1, end: 2, pauseAfter: "long" }] },
      { ...base, groups: [{ start: 0, end: 1, pauseAfter: "medium" }] },
      { ...base, groups: [{ start: 0, end: 1, pauseAfter: "medium" }, { start: 1, end: 2, pauseAfter: "long" }] },
      { ...base, groups: [{ start: 0, end: 3, pauseAfter: "long" }] },
      { ...base, groups: [{ start: 0, end: 2, pauseAfter: "long", text: "改写" }] },
      { ...base, clausePauseClasses: ["short", "short"] },
      { ...base, clausePauseClasses: ["short"] },
    ];
    for (const value of invalid) expect(() => validateVoiceLongTextAnalysis(clauses, value)).toThrow();
  });
});

describe("accepted long-input construction", () => {
  it("matches the retained 16-clause recipe and generates the true final group independently", () => {
    const plan = acceptedPlan();
    const inputs = buildLongTextInputs(plan);
    expect(inputs[0].text).toBe(originalClauses.map((clause) => clause + "……").join(""));
    expect(inputs[0].paddingClauses).toEqual([]);
    expect(inputs[1].text).toBe([...originalClauses.slice(3), ...VOICE_CONTINUATION_CLAUSES.slice(0, 3)].map((clause) => clause + "……").join(""));
    expect(inputs[1]).toMatchObject({ expectedText: plan.groups[1].text, clauses: plan.clauses.slice(3, 5), followingText: plan.clauses[5], isFinal: false });
    expect(inputs[4].paddingClauses).toEqual(VOICE_CONTINUATION_CLAUSES.slice(0, 10));
    expect(inputs[5]).toEqual({
      text: "我会一直陪在这里……不催促你……也不会突然离开……直到困意自然地靠近。",
      expectedText: plan.groups[5].text,
      clauses: plan.clauses.slice(12),
      isFinal: true,
      paddingClauses: [],
    });
  });

  it("keeps all body clauses beyond the historical sample's 16-clause baseline", () => {
    const clauses = splitVoiceClauses(Array.from({ length: 20 }, (_, index) => `内容${index}。`).join(""));
    const plan = createRuleVoiceLongTextPlan(clauses);
    const first = buildLongTextInputs(plan)[0];
    expect(first.paddingClauses).toEqual([]);
    for (let index = 0; index < 20; index += 1) expect(first.text).toContain(`内容${index}……`);
  });

  it("reduces padding within 500 characters without discarding original body", () => {
    const clauses = ["甲".repeat(242) + "。", "乙".repeat(240) + "。", "丙。"];
    const plan: VoiceLongTextPlan = { clauses, clausePauseClasses: ["medium", "medium"], groups: [
      { start: 0, end: 0, text: clauses[0], pauseAfter: "medium" },
      { start: 1, end: 2, text: clauses.slice(1).join(""), pauseAfter: "long" },
    ], provider: "fixture", warnings: [] };
    const first = buildLongTextInputs(plan)[0];
    expect(first.text.length).toBeLessThanOrEqual(500);
    expect(first.text).toContain("甲".repeat(242) + "……" + "乙".repeat(240) + "……丙……");
    expect(first.paddingClauses.length).toBeLessThan(13);
    plan.groups[0].text = "改写";
    expect(() => buildLongTextInputs(plan)).toThrow("原文不一致");
  });
});

describe("class-local group pauses", () => {
  it("reproduces the recorded 350 / 350 / 350 / 440 / 290 ms decisions", () => {
    const groups = [520, 0, 0, 400, 480, 100].map((value) => ({ internalPausesMs: [value], internalPauseClasses: ["short" as const], pauseAfter: "medium" as const }));
    const result = chooseGroupPauses(groups);
    expect(result.map((item) => item.durationMs)).toEqual([350, 350, 350, 440, 290]);
    expect(result.map((item) => item.source)).toEqual(["default", "default", "default", "adjacent", "adjacent"]);
    expect(groups.map((group) => group.internalPausesMs)).toEqual([[520], [0], [0], [400], [480], [100]]);
  });

  it("weighs both group means equally and counts measured zeros", () => {
    expect(chooseGroupPauses([
      { internalPausesMs: [0, 400, 800], pauseAfter: "medium" },
      { internalPausesMs: [200], pauseAfter: "long" },
    ])[0]).toMatchObject({ durationMs: 300, source: "adjacent" });
  });

  it("only falls back to valid natural internal samples with an explicit matching class", () => {
    expect(chooseGroupPauses([
      { internalPausesMs: [], pauseAfter: "medium" },
      { internalPausesMs: [0, 300, 440, 600, -10, 1400, Number.NaN], internalPauseClasses: ["medium", "medium", "short", "medium", "medium", "medium", "medium"], pauseAfter: "long" },
    ])[0]).toEqual({ durationMs: 300, source: "same_class", category: "medium" });
    expect(chooseGroupPauses([{ internalPausesMs: [], pauseAfter: "medium" }, { internalPausesMs: [300], pauseAfter: "long" }])[0].source).toBe("default");
  });

  it("uses 1 ms interval checks before the recipe's 10 ms final rounding", () => {
    const decide = (value: number) => chooseGroupPauses([{ internalPausesMs: [value], pauseAfter: "medium" }, { internalPausesMs: [value], pauseAfter: "long" }])[0];
    expect(decide(260.49)).toMatchObject({ durationMs: 350, source: "default" });
    expect(decide(260.51)).toMatchObject({ durationMs: 260, source: "adjacent" });
    expect(decide(480.49)).toMatchObject({ durationMs: 480, source: "adjacent" });
    expect(decide(480.51)).toMatchObject({ durationMs: 350, source: "default" });
  });

  it("uses accepted class defaults when measurements are missing and emits only group joins", () => {
    const groups = (["short", "medium", "long", "long"] as const).map((pauseAfter) => ({ internalPausesMs: [], pauseAfter }));
    expect(chooseGroupPauses(groups).map((item) => item.durationMs)).toEqual([180, 350, 600]);
    expect(chooseGroupPauses(groups.slice(0, 1))).toEqual([]);
  });
});
