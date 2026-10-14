import type { AsmrProject } from "./schema";
import { getParagraphGroup } from "./speech-workspace";

export type VoiceParagraphContext = {
  groupId: string;
  text: string;
  clips: { clipId: string; text: string; emotion: string; style: string; pace: string }[];
};

/** Every speech source in a paragraph participates in each member's identity. */
export function getVoiceParagraphContext(project: AsmrProject, clipId: string): VoiceParagraphContext | undefined {
  const group = getParagraphGroup(project, clipId);
  if (!group.length) return undefined;
  const definition = project.speechWorkspace?.groups.find((item) => item.clipIds.includes(clipId));
  if (definition && (new Set(definition.clipIds).size !== definition.clipIds.length || definition.clipIds.length !== group.length
      || definition.clipIds.some((id, index) => group[index].id !== id))) return undefined;
  return {
    groupId: definition?.id ?? group[0].id,
    text: group.map((clip) => clip.text).join(""),
    clips: group.map((clip) => ({ clipId: clip.id, text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace })),
  };
}
