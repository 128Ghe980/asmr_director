import { z } from "zod";

export const StoryboardStyleSchema = z.enum(["character_framing", "listener_pov"]);
export type StoryboardStyle = z.infer<typeof StoryboardStyleSchema>;

export const STORYBOARD_STYLE_LABELS: Record<StoryboardStyle, string> = {
  character_framing: "角色展示（原风格）",
  listener_pov: "第一人称 · 跟随剧情",
};

/** Templates own their camera style. Missing legacy fields retain the original style. */
export function effectiveStoryboardStyle(input?: {
  storyboardStyle?: StoryboardStyle;
  referenceTemplate?: { storyboardStyle?: StoryboardStyle };
}): StoryboardStyle {
  if (input?.referenceTemplate) return input.referenceTemplate.storyboardStyle ?? "character_framing";
  return input?.storyboardStyle ?? "character_framing";
}

export const resolveStoryboardStyle = effectiveStoryboardStyle;
