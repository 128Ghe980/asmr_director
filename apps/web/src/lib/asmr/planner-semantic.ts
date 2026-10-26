import { z } from "zod";
import { getPlannerPauseSeconds, PlannerDraftSchema, PlannerSectionSchema, type PlannerDraft, type PlannerSection } from "./planner";
import { createRuleVoiceLongTextPlan, VOICE_PAUSE_RULES } from "./voice-longtext-plan";

// Generation shares director metadata across a sequence of compact spoken
// units. Stored drafts remain the existing flat sections contract.
export const PlannerGeneratedDraftSchema = z.object({
  title: PlannerDraftSchema.shape.title,
  scene: PlannerDraftSchema.shape.scene,
  character: PlannerDraftSchema.shape.character,
  groups: z.array(PlannerSectionSchema.omit({ text: true, pauseAfter: true, pauseAfterSeconds: true }).extend({
    units: z.array(z.object({
      text: PlannerSectionSchema.shape.text,
      pauseAfter: PlannerSectionSchema.shape.pauseAfter,
      direction: PlannerSectionSchema.shape.direction.optional(),
      soundSuggestions: PlannerSectionSchema.shape.soundSuggestions.optional(),
    }).strict()).min(1).max(200),
  }).strict()).min(1).max(24),
}).strict();

/** Template writing promises a usable shot intention for every actual speech unit. */
export const PlannerTemplateGeneratedDraftSchema = PlannerGeneratedDraftSchema.extend({
  groups: z.array(PlannerGeneratedDraftSchema.shape.groups.element.extend({
    units: z.array(PlannerGeneratedDraftSchema.shape.groups.element.shape.units.element.extend({
      direction: PlannerSectionSchema.shape.direction.min(1),
    })).min(1).max(200),
  })).min(1).max(24),
});

export function expandPlannerGeneratedDraft(value: z.infer<typeof PlannerGeneratedDraftSchema>): PlannerDraft {
  let count = 0;
  const sections = value.groups.flatMap(({ units, ...direction }) => units.map((unit) => ({
    ...direction, ...unit, id: `unit_${String(++count).padStart(3, "0")}`,
  })));
  return normalizePlannerSemanticDraft(PlannerDraftSchema.parse({
    title: value.title, scene: value.scene, character: value.character, sections,
  }), { preserveUnitBoundaries: true });
}

// The same semantic and pause vocabulary used by the long-text voice planner.
export const PLANNER_SEMANTIC_GUIDANCE = [
  "groups[].units 必须是按朗读顺序连续排列的语义短单元，不是章节或几大段。通常每个单元 2 至 3 个子句、约 10 至 50 字；一个完整动作确实不能分开时最多 4 个子句。",
  "子句按逗号、句末标点等自然停顿划分，不是 2 至 3 个完整复句。统计当前原创台词的自然语义停顿；同一意思的短回应与接续说明可以保留在同一单元，转入下一个独立动作或话题时再分开。分段规则只指导结构，不提供任何固定开场、台词或剧情。",
  "同一动作或未完成的意思放在同一单元，完整意思结束或动作、场景、情绪自然转换时再分开；不要在每个逗号处机械拆分，也不要重复前后文。",
  "短句是较短的语义或语气台词单元，不限定为一个完整句子；一个单元可以包含多个句号，不按每个句号机械拆分。",
  "每个单元都将直接显示为一条可编辑台词并成为一个音频片段。全文串联必须自然完整，没有重复、缺句或大纲。",
  "pauseAfter: short=紧密承接、同一动作或意思未说完；medium=普通完整句之间的自然换气；long=明显意群、场景或情绪转换。长停顿只在确实需要时使用。",
].join("\n");

export function semanticPauseSeconds(pause: PlannerSection["pauseAfter"]): number {
  return VOICE_PAUSE_RULES[pause].default / 1000;
}

function pauseClass(text: string): PlannerSection["pauseAfter"] {
  if (/\n\s*\n/u.test(text)) return "long";
  if (/[。！？!?；;]/u.test(text) || /\.\s*$/u.test(text)) return "medium";
  return "short";
}

/** Punctuation-based grouping for explicit legacy-draft conversion only.
 * Generated model units retain their own semantic boundaries. This utility
 * never rewrites text or splits words merely to meet a character count. */
export function splitPlannerSemanticText(text: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const numericSeparator = /[.,，:：]/u.test(character) && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "");
    // Enumeration commas join list items; they do not add clauses or groups.
    const boundary = /[，。！？；：!?;:\r\n…]/u.test(character)
      || character === "," || (character === "." && !/[\p{L}\p{N}]/u.test(text[index + 1] ?? ""));
    if (!boundary || numericSeparator) continue;
    let end = index + 1;
    while (end < text.length && /[，。！？；：、,.!?;:…\s”’」』）)]/u.test(text[end])) end += 1;
    const clause = text.slice(start, end);
    if (/[\p{L}\p{N}]/u.test(clause)) { clauses.push(clause); start = end; }
    index = end - 1;
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (tail.trim() || !clauses.length) clauses.push(tail);
    else clauses[clauses.length - 1] += tail;
  }
  // Count the same punctuation clauses as voice grouping, not just complete
  // sentences: three compound sentences may contain many separate actions.
  if (text.length <= 100 && clauses.length <= 4) return [text];
  const groups: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    // Reuse the accepted long-text rule grouping, in bounded windows so its
    // twelve-group analysis cap cannot turn a long draft back into large blocks.
    groups.push(...createRuleVoiceLongTextPlan(chunk).groups.map((group) => group.text));
    chunk = [];
  };
  for (const clause of clauses) {
    if (chunk.length && (chunk.join("").length + clause.length > 400 || chunk.length >= 24)) flush();
    chunk.push(clause);
  }
  if (chunk.length) flush();
  if (groups.join("") !== text || groups.some((group) => !group.trim())) throw new Error("无法在保留原文的同时拆分，请手动选择分段位置。");
  return groups;
}

export function normalizePlannerSemanticDraft(draft: PlannerDraft, options: { preserveSectionPauses?: boolean; preserveUnitBoundaries?: boolean } = {}): PlannerDraft {
  const usedIds = new Set(draft.sections.map((section) => section.id));
  let nextId = 1;
  const sections = draft.sections.flatMap((section) => {
    const texts = options.preserveUnitBoundaries ? [section.text] : splitPlannerSemanticText(section.text);
    return texts.map((text, index): PlannerSection => {
      if (text.length > 500) throw new Error("单个语义短句超过 500 字，请在自然停顿处分段。");
      let id = section.id;
      if (index > 0) {
        while (usedIds.has(`semantic_${nextId}`)) nextId += 1;
        id = `semantic_${nextId++}`;
        usedIds.add(id);
      }
      const last = index === texts.length - 1;
      const pauseAfter = last ? section.pauseAfter : pauseClass(text);
      const pauseAfterSeconds = last && options.preserveSectionPauses
        ? getPlannerPauseSeconds(section)
        : semanticPauseSeconds(pauseAfter);
      return { ...section, id, text, pauseAfter, pauseAfterSeconds };
    });
  });
  if (sections.length > 200) throw new Error("语义短句超过 200 条，请精简内容或手动合并相关短句。");
  if (sections.map((section) => section.text).join("") !== draft.sections.map((section) => section.text).join("")) {
    throw new Error("语义拆分没有完整保留原文。");
  }
  return { ...draft, segmentation: "semantic", sections };
}
