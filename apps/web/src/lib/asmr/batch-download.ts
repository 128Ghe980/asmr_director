import type { AsmrProject, TimelineClip } from "./schema";

const localClipPrefix = "asset://clip/";
const typeNames: Record<TimelineClip["type"], string> = {
  voice: "人声", breath: "呼吸", sfx: "音效", ambience: "环境",
};

/** One portable path component; never interprets project text as a path. */
export function sanitizeDownloadName(value: string, fallback = "音频", maxLength = 48): string {
  const wellFormed = Array.from(value, character => character.length === 1 && /^[\ud800-\udfff]$/.test(character) ? "�" : character).join("");
  const safe = wellFormed.normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");
  const shortened = Array.from(safe).slice(0, maxLength).join("").replace(/[. ]+$/g, "");
  if (!shortened) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(shortened)
    ? `_${shortened}` : shortened;
}

export function getBatchDownloadFolderName(project: AsmrProject): string {
  return sanitizeDownloadName(project.title, "ASMR 工程");
}

export function getBatchDownloadFilename(project: AsmrProject): string {
  return `${getBatchDownloadFolderName(project)}_已采用音频.zip`;
}

export type BatchDownloadClip = {
  clip: TimelineClip;
  assetId: string;
  filename: string;
};

/** Current generated timeline assets are adopted; candidates/history are not in this list. */
export function getBatchDownloadClips(project: AsmrProject): BatchDownloadClip[] {
  return project.timeline.tracks.flatMap<TimelineClip>(track => track.clips)
    .filter(clip => clip.generation.status === "asset_generated"
      && Boolean(clip.asset.asset_id)
      && clip.asset.uri === `${localClipPrefix}${clip.asset.asset_id}`)
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .sort((a, b) => a.clip.start - b.clip.start || a.originalIndex - b.originalIndex)
    .map(({ clip }, index) => {
      const label = clip.type === "voice" ? clip.text
        : clip.type === "breath" ? clip.breath
          : clip.type === "sfx" ? clip.sfx : clip.ambience;
      return {
        clip, assetId: clip.asset.asset_id!,
        filename: `${String(index + 1).padStart(3, "0")}_${typeNames[clip.type]}_${sanitizeDownloadName(label, typeNames[clip.type], 24)}.wav`,
      };
    });
}
