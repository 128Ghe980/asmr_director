import { sanitizeDownloadName } from "./batch-download";
import type { AsmrProject, VoiceClip } from "./schema";
import { getUsableClipH3Prompts } from "./video-plan";

export type BatchStoryboardClip = { clip: VoiceClip; filename: string; prompt: string };

export function getBatchStoryboardDownloadFolderName(project: AsmrProject): string {
  return `${sanitizeDownloadName(project.title, "ASMR 工程")}_分镜`;
}

export function getBatchStoryboardDownloadFilename(project: AsmrProject): string {
  return `${getBatchStoryboardDownloadFolderName(project)}.zip`;
}

/** Keep paragraph numbers from the complete chronological voice list, including export gaps. */
export function getBatchStoryboardClips(project: AsmrProject): BatchStoryboardClip[] {
  const prompts = getUsableClipH3Prompts(project);
  return project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : [])
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .sort((a, b) => a.clip.start - b.clip.start || a.originalIndex - b.originalIndex)
    .flatMap(({ clip }, index) => {
      const prompt = prompts.get(clip.id);
      return prompt === undefined ? [] : [{
        clip, prompt,
        filename: `${String(index + 1).padStart(3, "0")}_${sanitizeDownloadName(clip.text, "台词", 24)}.txt`,
      }];
    });
}
