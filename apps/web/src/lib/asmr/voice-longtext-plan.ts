import { z } from "zod";
import type { VoiceGenerationContext } from "./voice-generation-context";

export const VoicePauseClassSchema = z.enum(["short", "medium", "long"]);
export type VoicePauseClass = z.infer<typeof VoicePauseClassSchema>;

export type VoiceLongTextPlan = {
  clauses: string[];
  groups: { start: number; end: number; text: string; pauseAfter: VoicePauseClass }[];
  clausePauseClasses: VoicePauseClass[];
  provider: string;
  model?: string;
  warnings: string[];
};

export const VoiceLongTextAnalysisSchema = z.object({
  groups: z.array(z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    pauseAfter: VoicePauseClassSchema,
  }).strict()).min(1).max(12),
  clausePauseClasses: z.array(VoicePauseClassSchema).max(499),
}).strict();

// The accepted 2026-09-03 recipe's fixed continuation list. These words only
// maintain long input context; their generated audio must never be retained.
export const VOICE_LONGTEXT_WINDOW_CLAUSES = 16;

export const VOICE_CONTINUATION_CLAUSES = [
  "如果眼前还有一点微光", "就让它慢慢淡下去", "被角会安静地贴在身边",
  "窗外的雨声也会继续陪着你", "也不用再去留意时间", "等到周围的一切完全安静下来",
  "枕边只会剩下很轻的雨声", "陪着你慢慢走进一个温暖又安稳的梦里", "不用急",
  "慢慢睡着", "今晚只需要好好休息", "让每一次呼吸都比刚才更轻",
  "让眼皮慢慢放松下来", "其余的事情等醒来再说", "现在安心地留在这份安静里",
] as const;

export const VOICE_PAUSE_RULES = {
  short: { minimum: 120, maximum: 260, default: 180 },
  medium: { minimum: 261, maximum: 480, default: 350 },
  long: { minimum: 481, maximum: 900, default: 600 },
} as const;

export function splitVoiceClauses(input: string): string[] {
  const text = input.trim();
  if (!text || text.length > 500 || !/[\p{L}\p{N}]/u.test(text)) {
    throw new Error("长文人声需要 1 至 500 字的可朗读文案。");
  }
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const numericSeparator = /[.,，:：]/.test(char) && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "");
    const boundary = /[，。！？；：、!?;:\n\r…]/.test(char)
      || (char === "," && !numericSeparator)
      || (char === "." && (!/[\p{L}\p{N}]/u.test(text[index + 1] ?? "") || text[index + 1] === "."));
    if (!boundary || numericSeparator) continue;
    // Keep contiguous marks, closing quotation marks and whitespace with the
    // preceding clause. No readable character is removed or invented.
    let end = index + 1;
    while (end < text.length && /[，。！？；：、,.!?;:…\s”’」』）)]/.test(text[end])) end += 1;
    const clause = text.slice(start, end);
    if (/[\p{L}\p{N}]/u.test(clause)) {
      clauses.push(clause);
      start = end;
    }
    index = end - 1;
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (/[\p{L}\p{N}]/u.test(tail)) clauses.push(tail);
    else if (clauses.length) clauses[clauses.length - 1] += tail;
  }
  return clauses;
}

export function validateVoiceLongTextAnalysis(
  clauses: string[],
  value: unknown,
): Pick<VoiceLongTextPlan, "groups" | "clausePauseClasses"> {
  const result = VoiceLongTextAnalysisSchema.parse(value);
  if (result.clausePauseClasses.length !== clauses.length - 1) throw new Error("短句停顿类别不完整。");
  let next = 0;
  const groups = result.groups.map((group) => {
    if (group.start !== next || group.end < group.start || group.end >= clauses.length) {
      throw new Error("语义组没有按原文顺序完整覆盖。");
    }
    if (group.end < clauses.length - 1 && group.pauseAfter !== result.clausePauseClasses[group.end]) {
      throw new Error("语义组与短句停顿类别不一致。");
    }
    next = group.end + 1;
    return { ...group, text: clauses.slice(group.start, group.end + 1).join("") };
  });
  if (next !== clauses.length) throw new Error("语义组遗漏了原文。");
  return { groups, clausePauseClasses: result.clausePauseClasses };
}

function punctuationClass(clause: string): VoicePauseClass {
  if (/\n\s*\n/.test(clause)) return "long";
  if (/[。！？!?；;]/.test(clause) || /\.\s*$/.test(clause)) return "medium";
  return "short";
}

export function createRuleVoiceLongTextPlan(clauses: string[], warnings: string[] = []): VoiceLongTextPlan {
  const clausePauseClasses = clauses.slice(0, -1).map(punctuationClass);
  const groups: VoiceLongTextPlan["groups"] = [];
  const target = Math.max(3, Math.ceil(clauses.length / 12));
  let start = 0;
  while (start < clauses.length) {
    let end = Math.min(clauses.length - 1, start + target - 1);
    if (groups.length === 11) end = clauses.length - 1;
    else {
      for (let candidate = start + 1; candidate < end; candidate += 1) {
        if (punctuationClass(clauses[candidate]) !== "short") { end = candidate; break; }
      }
      while (end > start + 1 && clauses.slice(start, end + 1).join("").length > 80) end -= 1;
      // Do not leave a one-clause tail when a short final group can hold it.
      if (clauses.length - end === 2 && end - start + 1 < 4 && clauses.slice(start).join("").length <= 80) end += 1;
    }
    groups.push({ start, end, text: clauses.slice(start, end + 1).join(""), pauseAfter: clausePauseClasses[end] ?? "long" });
    start = end + 1;
  }
  return { clauses: [...clauses], groups, clausePauseClasses, provider: "rules", warnings: [...warnings] };
}

export function createSemanticVoiceLongTextPlan(text: string, context: VoiceGenerationContext): VoiceLongTextPlan {
  const clauses = splitVoiceClauses(text);
  const rules = createRuleVoiceLongTextPlan(clauses);
  return {
    ...rules,
    groups: [{ start: 0, end: clauses.length - 1, text: clauses.join(""), pauseAfter: context.isFinal ? "long" : "medium" }],
    provider: "project_segments",
  };
}

export function continuationClause(clause: string): string {
  return clause.trim().replace(/[，。！？；：、,.!?;:…\s]+$/u, "") + "……";
}

export function buildLongTextInputs(plan: VoiceLongTextPlan, context?: VoiceGenerationContext): {
  text: string;
  expectedText: string;
  followingText?: string;
  clauses: string[];
  isFinal: boolean;
  paddingClauses: string[];
}[] {
  // Validate index coverage at this boundary too: persisted or hand-built plans
  // must not be able to silently remove or duplicate part of the spoken script.
  validateVoiceLongTextAnalysis(plan.clauses, {
    groups: plan.groups.map(({ start, end, pauseAfter }) => ({ start, end, pauseAfter })),
    clausePauseClasses: plan.clausePauseClasses,
  });
  return plan.groups.map((group, index) => {
    const clauses = plan.clauses.slice(group.start, group.end + 1);
    const expectedText = clauses.join("");
    if (group.text !== expectedText) throw new Error("语义组内容与原文不一致。");
    const isFinal = index === plan.groups.length - 1 && (context?.isFinal ?? true);
    if (isFinal) {
      const natural = expectedText.trim().replace(/[，；：、,…\s]+$/u, "");
      const text = /[。！？.!?][”’」』）)]*$/u.test(natural) ? natural : `${natural}。`;
      if (text.length > 500) throw new Error("末组超过 500 字，请缩短文案后重试。");
      return { text, expectedText, clauses, isFinal, paddingClauses: [] };
    }
    const body = [...plan.clauses.slice(group.start), ...(context?.followingClauses ?? [])];
    // Semantic clips slide a fixed-size forward window across the project.
    // Legacy multi-group plans retain their original complete-body recipe.
    const remaining = context ? body.slice(0, VOICE_LONGTEXT_WINDOW_CLAUSES) : body;
    const followingText = remaining[clauses.length];
    if (!followingText) throw new Error("目标段太长，无法容纳后续语境，请先拆分片段。");
    let text = remaining.map(continuationClause).join("");
    if (text.length > 500) throw new Error("加上停顿标点后的长文输入超过 500 字，请缩短文案后重试。");
    const paddingClauses: string[] = [];
    for (const filler of VOICE_CONTINUATION_CLAUSES.slice(0, Math.max(0, VOICE_LONGTEXT_WINDOW_CLAUSES - remaining.length))) {
      const padded = text + continuationClause(filler);
      if (padded.length > 500) break;
      text = padded;
      paddingClauses.push(filler);
    }
    return { text, expectedText, followingText, clauses, isFinal, paddingClauses };
  });
}

export function chooseGroupPauses(groups: {
  internalPausesMs: number[];
  internalPauseClasses?: VoicePauseClass[];
  pauseAfter: VoicePauseClass;
}[]): { durationMs: number; source: "adjacent" | "same_class" | "default"; category: VoicePauseClass }[] {
  const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1200;
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const inside = (value: number, category: VoicePauseClass) => {
    const rounded = Math.round(value);
    return rounded >= VOICE_PAUSE_RULES[category].minimum && rounded <= VOICE_PAUSE_RULES[category].maximum;
  };
  const means = groups.map((group) => mean(group.internalPausesMs.filter(valid)));
  return groups.slice(0, -1).map((group, index) => {
    const category = group.pauseAfter;
    const before = means[index];
    const after = means[index + 1];
    if (before !== null && after !== null) {
      const candidate = (before + after) / 2;
      if (inside(candidate, category)) return { durationMs: Math.round(candidate / 10) * 10, source: "adjacent", category };
    }
    const samples = groups.flatMap((item) => item.internalPausesMs.filter((value, sampleIndex) =>
      valid(value) && item.internalPauseClasses?.[sampleIndex] === category && inside(value, category)));
    const fallback = mean(samples);
    if (fallback !== null) return { durationMs: Math.round(fallback / 10) * 10, source: "same_class", category };
    return { durationMs: VOICE_PAUSE_RULES[category].default, source: "default", category };
  });
}
