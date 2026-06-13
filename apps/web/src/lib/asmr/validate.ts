import {
  AsmrProjectSchema,
  type AsmrProject,
  type TimelineClip,
} from "./schema";

export function parseAsmrProject(input: unknown): AsmrProject {
  return AsmrProjectSchema.parse(input);
}

export function safeParseAsmrProject(input: unknown) {
  return AsmrProjectSchema.safeParse(input);
}

export function getAllClips(project: AsmrProject): TimelineClip[] {
  const clips: TimelineClip[] = [];

  for (const track of project.timeline.tracks) {
    clips.push(...track.clips);
  }

  return clips;
}
