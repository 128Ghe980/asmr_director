import { sanitizeDownloadName } from "./batch-download";
import type { AsmrProject, VoiceClip } from "./schema";
import { ClipVideoStoryboardSchema, createClipVideoSourceFingerprint, getClipStoryboardReferenceMode, type ClipVideoStoryboard, type StoryboardReferenceMode } from "./video-plan";

export type VideoPackageIssue = { clipId: string; index: number; message: string };
export type VideoPackageSummary = { total: number; ready: number; issues: VideoPackageIssue[] };
export type VideoPackageSourceShot = {
  clip: VoiceClip;
  storyboard: ClipVideoStoryboard;
  /** One-based position in the displayed script; this is the only package ordering. */
  index: number;
  referenceMode: StoryboardReferenceMode;
};

export class VideoPackageValidationError extends Error {
  constructor(public readonly issues: VideoPackageIssue[]) {
    super(issues.map(issue => `第 ${issue.index} 段：${issue.message}`).join("；"));
    this.name = "VideoPackageValidationError";
  }
}

export function getVideoPackageFilename(project: AsmrProject): string {
  return `${sanitizeDownloadName(project.title, "ASMR 工程")}_视频项目包.zip`;
}

function inspect(project: AsmrProject): { summary: VideoPackageSummary; shots: VideoPackageSourceShot[] } {
  const clips = project.timeline.tracks.flatMap<VoiceClip>(track => track.track_type === "voice" ? track.clips : [])
    .map((clip, position) => ({ clip, position }))
    .sort((a, b) => a.clip.start - b.clip.start || a.position - b.position)
    .map(entry => entry.clip);
  const counts = new Map<string, number>();
  for (const clip of clips) counts.set(clip.id, (counts.get(clip.id) ?? 0) + 1);
  const issues: VideoPackageIssue[] = [];
  const shots: VideoPackageSourceShot[] = [];
  for (const [position, clip] of clips.entries()) {
    const index = position + 1;
    const fail = (message: string) => { issues.push({ clipId: clip.id, index, message }); };
    if (counts.get(clip.id) !== 1) { fail("片段编号重复，请整理本段后导出。"); continue; }
    if (!clip.text.trim()) { fail("请填写本段文案或无对白镜头描述。"); continue; }
    if (clip.kind === "silent") {
      if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 5) {
        fail("环境空镜时长须大于 0 且不超过 5 秒。"); continue;
      }
    } else if (clip.audio_stale || clip.generation.status !== "asset_generated" || !clip.asset.asset_id
      || !/^[A-Za-z0-9_-]{1,200}$/.test(clip.asset.asset_id) || clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`) {
      fail("请先生成并采用本段当前人声音频。"); continue;
    }
    const saved = project.videoPlan?.shots[clip.id];
    if (!saved) { fail("请先生成本段分镜。"); continue; }
    const parsed = ClipVideoStoryboardSchema.safeParse(saved);
    if (!parsed.success || saved.clipId !== clip.id) { fail("本段分镜资料不完整，请重新生成。"); continue; }
    const storyboard = parsed.data;
    if (![storyboard.title, storyboard.visual, storyboard.action, storyboard.camera].every(text => text.trim())) {
      fail("请补全本段分镜的标题、画面、动作和镜头说明。"); continue;
    }
    if (clip.kind === "silent" && !storyboard.ambientSound?.trim()) {
      fail("本段缺少环境声音分镜，请重新生成环境分镜。"); continue;
    }
    // Only this clip's source is checked. Previous-shot fingerprints never gate a package.
    let source: string;
    try { source = createClipVideoSourceFingerprint(project, clip.id); }
    catch { fail("本段素材引用无效，请检查已采用音频。"); continue; }
    if (storyboard.sourceFingerprint !== source || (clip.kind === "silent"
      ? storyboard.kind !== "silent" || storyboard.duration !== clip.duration
      : storyboard.kind === "silent" || storyboard.audio?.assetId !== clip.asset.asset_id || storyboard.audio?.uri !== clip.asset.uri)) {
      fail("本段文案、音频或场景已更新，请更新本段分镜。"); continue;
    }
    shots.push({ clip, storyboard, index, referenceMode: position === 0 ? "new" : getClipStoryboardReferenceMode(project, clip.id) });
  }
  return { summary: { total: clips.length, ready: shots.length, issues }, shots };
}

/** Browser-safe, read-only readiness summary; no audio, models or predecessor-chain validation. */
export function getVideoPackageSummary(project: AsmrProject): VideoPackageSummary {
  return inspect(project).summary;
}

/** A package must contain every displayed shot; missing inputs never silently disappear. */
export function getVideoPackageShots(project: AsmrProject): VideoPackageSourceShot[] {
  const { summary, shots } = inspect(project);
  if (summary.issues.length) throw new VideoPackageValidationError(summary.issues);
  return shots;
}
