import { z } from "zod";
import { StoryboardStyleSchema } from "./storyboard-style";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
export const CreativeTemplateSchema = z.object({
  id: text(100), version: z.number().int().positive(), title: text(120), summary: text(1200),
  source: z.object({ filename: text(200), durationSeconds: z.number().finite().positive(), analysisBasis: text(1200) }).strict(),
  creativePrompt: text(6000), sceneDescription: text(4000), storyboardRules: text(6000),
  storyboardStyle: StoryboardStyleSchema.optional(),
  beats: z.array(z.object({ id: text(80), title: text(120), referenceRange: text(80), story: text(1000),
    visual: text(1000), action: text(1000), camera: text(600), sound: text(600), continuity: text(1000) }).strict()).min(1).max(20),
}).strict().superRefine((template, context) => {
  if (new Set(template.beats.map(beat => beat.id)).size !== template.beats.length) {
    context.addIssue({ code: "custom", path: ["beats"], message: "模板分镜节拍编号必须唯一。" });
  }
});
export type CreativeTemplate = z.infer<typeof CreativeTemplateSchema>;

/** Original speech is retained as the binding key; clip IDs change when users split or merge. */
export const TemplateDirectionSchema = z.object({
  text: z.string().min(1).max(3000).regex(/\S/u),
  direction: z.string().trim().max(1200), soundSuggestions: z.string().trim().max(1200),
}).strict();
export type TemplateDirection = z.infer<typeof TemplateDirectionSchema>;
export const TemplateDirectionsSchema = z.array(TemplateDirectionSchema).max(200);

/** Conservative text binding: never infer a template beat from the current row number.
 * Exact source sequences support merges; unique substantial substrings support splits.
 * Changed or ambiguous text deliberately falls back to the full narrative/template. */
export function getMatchingTemplateDirections(notes: TemplateDirection[] | undefined, currentText: string): TemplateDirection[] {
  if (!notes?.length) return [];
  const compact = (value: string) => value.replace(/\s/gu, "");
  const target = compact(currentText);
  if (!target) return [];
  const normalized = notes.map(note => compact(note.text));
  const matches: TemplateDirection[][] = [];
  for (let start = 0; start < notes.length; start += 1) {
    let combined = "";
    for (let end = start; end < notes.length && combined.length <= target.length; end += 1) {
      combined += normalized[end];
      if (!target.startsWith(combined)) break;
      if (combined === target) { matches.push(notes.slice(start, end + 1)); break; }
    }
  }
  if (matches.length) return matches.length === 1 ? matches[0] : [];
  if (target.replace(/[^\p{L}\p{N}]/gu, "").length < 6) return [];
  const splitMatches = notes.filter((_note, index) => normalized[index].includes(target));
  return splitMatches.length === 1 ? splitMatches : [];
}

/** Only creative instructions are model context; filenames are provenance, never file paths to load. */
export function creativeTemplateContext(template: CreativeTemplate | undefined) {
  return template ? { title: template.title, summary: template.summary, creativePrompt: template.creativePrompt,
    sceneDescription: template.sceneDescription, storyboardRules: template.storyboardRules,
    ...(template.storyboardStyle ? { storyboardStyle: template.storyboardStyle } : {}), beats: template.beats } : undefined;
}
