import { z } from "zod";

import type { PlannerDraft, PlannerSection } from "./planner";
import { semanticPauseSeconds } from "./planner-semantic";

export const PlannerTextRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
}).strict();

export const PlannerReplacementSchema = z.object({
  text: z.string().min(1).max(3000).regex(/\S/u),
}).strict();

export type PlannerTextRange = z.infer<typeof PlannerTextRangeSchema>;

export function validPlannerRange(text: string, range: PlannerTextRange, allowCursor = false): boolean {
  const boundary = (offset: number) => !(offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 0 && range.end <= text.length
    && (allowCursor ? range.start <= range.end : range.start < range.end)
    && boundary(range.start) && boundary(range.end);
}

export function replacePlannerRange(section: PlannerSection, range: PlannerTextRange, replacement: string): PlannerSection {
  if (!validPlannerRange(section.text, range)) throw new Error("所选文字范围已失效，请重新选择。");
  const text = section.text.slice(0, range.start) + replacement + section.text.slice(range.end);
  if (text.length > 3000) throw new Error("改写后本段超过 3000 字，请先拆分再改写。");
  return { ...section, text, ...(section.kind && text !== section.text ? { direction: "", soundSuggestions: "" } : {}) };
}

function nextSectionId(draft: PlannerDraft): string {
  const ids = new Set(draft.sections.map((section) => section.id));
  let index = 1;
  while (ids.has(`manual_${index}`)) index += 1;
  return `manual_${index}`;
}

export function insertPlannerSection(draft: PlannerDraft, afterId?: string): PlannerDraft {
  if (draft.sections.length >= 200) throw new Error("文案最多可保留 200 段。");
  const index = afterId ? draft.sections.findIndex((section) => section.id === afterId) : draft.sections.length - 1;
  if (afterId && index < 0) throw new Error("找不到要插入的位置。");
  const nearby = draft.sections[index] ?? draft.sections[0];
  const inherited = nearby ? { emotion: nearby.emotion, style: nearby.style, pace: nearby.pace, position: nearby.position }
    : { emotion: "平静", style: "轻声", pace: "缓慢", position: { pan: 0, distance: "near" as const, movement: "static" as const } };
  const section: PlannerSection = {
    ...inherited,
    id: nextSectionId(draft), title: "新段落", text: "", direction: "", soundSuggestions: "", pauseAfter: "short",
    ...(draft.performanceVersion === 1 ? { kind: "speech", purpose: "dialogue", pauseAfterSeconds: 0 }
      : draft.segmentation === "semantic" ? { pauseAfterSeconds: semanticPauseSeconds("short") } : {}),
  };
  const sections = [...draft.sections];
  sections.splice(index + 1, 0, section);
  return { ...draft, sections };
}

export function insertPlannerSilentSection(draft: PlannerDraft, afterId?: string, purpose: "asmr" | "transition" | "interaction" = "asmr"): PlannerDraft {
  const inserted = insertPlannerSection(draft, afterId);
  const id = nextSectionId(draft);
  return { ...inserted, sections: inserted.sections.map(section => section.id === id ? {
    ...section, kind: "silent", purpose, durationSeconds: 5, pauseAfterSeconds: 0,
    title: purpose === "asmr" ? "声音操作" : purpose === "transition" ? "动作过渡" : "互动停留",
    text: "保持当前机位，安排这一段的动作与声音。",
  } : section) };
}

export function splitPlannerSection(draft: PlannerDraft, id: string, range: PlannerTextRange): PlannerDraft {
  const index = draft.sections.findIndex((section) => section.id === id);
  const section = draft.sections[index];
  if (section?.kind === "silent") throw new Error("无台词段请直接调整时长，或新增一段分别安排动作。 ");
  if (!section || !validPlannerRange(section.text, range, true)) throw new Error("请先在台词中放置光标或选中文字。");
  const cuts = [...new Set([0, range.start, range.end, section.text.length])].sort((a, b) => a - b);
  const pieces = cuts.slice(0, -1).map((start, part) => section.text.slice(start, cuts[part + 1]));
  if (pieces.length < 2 || pieces.some((text) => !text.trim())) throw new Error("请在两段文字之间放置光标，或选中要独立成段的文字。");
  if (draft.sections.length + pieces.length - 1 > 200) throw new Error("文案最多可保留 200 段。");
  const used = { ...draft, sections: [...draft.sections] };
  const replacement = pieces.map((text, part) => {
    const last = part === pieces.length - 1;
    const next = { ...section, text, id: part === 0 ? section.id : nextSectionId(used), pauseAfter: last ? section.pauseAfter : "short" as const,
      ...(draft.performanceVersion === 1 ? { direction: "", soundSuggestions: "" } : {}),
      ...(draft.performanceVersion === 1 ? { pauseAfterSeconds: 0 } : section.pauseAfterSeconds !== undefined || draft.segmentation === "semantic"
        ? { pauseAfterSeconds: last ? section.pauseAfterSeconds : semanticPauseSeconds("short") } : {}),
    };
    used.sections.push(next);
    return next;
  });
  return { ...draft, sections: [...draft.sections.slice(0, index), ...replacement, ...draft.sections.slice(index + 1)] };
}

export function mergePlannerSection(draft: PlannerDraft, id: string): PlannerDraft {
  const index = draft.sections.findIndex((section) => section.id === id);
  const first = draft.sections[index];
  const second = draft.sections[index + 1];
  if (!first || !second) throw new Error("没有可合并的下一段。");
  if (first.kind === "silent" || second.kind === "silent") throw new Error("无台词段需要单独保留动作与时长，不能与台词合并。");
  const text = first.text + second.text;
  if (text.length > 3000) throw new Error("合并后超过单段 3000 字限制，请保留为多段。");
  const combineNotes = (left: string, right: string) => left === right ? left : [left, right].filter(Boolean).join("\n");
  const direction = combineNotes(first.direction, second.direction);
  const soundSuggestions = combineNotes(first.soundSuggestions, second.soundSuggestions);
  if (direction.length > 1200 || soundSuggestions.length > 1200) throw new Error("合并后的导演或音效提示过长，请先整理提示。");
  const merged = { ...first, text, direction, soundSuggestions, pauseAfter: second.pauseAfter,
    ...(first.pauseAfterSeconds !== undefined || second.pauseAfterSeconds !== undefined ? { pauseAfterSeconds: second.pauseAfterSeconds } : {}),
  };
  return { ...draft, sections: [...draft.sections.slice(0, index), merged, ...draft.sections.slice(index + 2)] };
}
