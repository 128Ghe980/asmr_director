import { z } from "zod";
import type { AsmrProject, VoiceClip } from "./schema";
import { captureSpeechWorkspace } from "./speech-workspace";
import { ClipVideoStoryboardSchema, getUsableClipH3Prompts, rebindCurrentStoryboardReferences, type ClipVideoStoryboard } from "./video-plan";

/** Existing editable bounds also allow an inverse review to restore older long notes. */
export const StoryboardReviewFieldsSchema = z.object({
  title: z.string().min(1).max(120), visual: z.string().min(1).max(800), action: z.string().min(1).max(600), camera: z.string().min(1).max(400),
  ambientSound: z.string().max(600).optional(),
}).strict();
export const StoryboardReviewSchema = z.object({
  inputFingerprint: z.string().regex(/^storyboard-review-v1:[a-f0-9]{32}$/),
  changes: z.array(z.object({ clipId: z.string().min(1).max(200), reason: z.string().trim().min(1).max(600),
    before: StoryboardReviewFieldsSchema, after: StoryboardReviewFieldsSchema }).strict()).max(400),
  notes: z.array(z.string().trim().min(1).max(600)).max(200),
}).strict().superRefine((review, context) => {
  if (new Set(review.changes.map(change => change.clipId)).size !== review.changes.length) context.addIssue({ code: "custom", path: ["changes"], message: "校对镜头编号重复。" });
});
export type StoryboardReview = z.infer<typeof StoryboardReviewSchema>;
export type StoryboardReviewFields = z.infer<typeof StoryboardReviewFieldsSchema>;
export function getStoryboardReviewClips(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []);
}
export function pickStoryboardReviewFields(shot: ClipVideoStoryboard): StoryboardReviewFields {
  return { title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera,
    ...(shot.ambientSound === undefined ? {} : { ambientSound: shot.ambientSound }) };
}
function compactFingerprint(value: string) {
  const lanes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35], primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x85ebca77];
  for (let index = 0; index < value.length; index++) for (let lane = 0; lane < lanes.length; lane++) lanes[lane] = Math.imul(lanes[lane] ^ value.charCodeAt(index), primes[lane]) >>> 0;
  return `storyboard-review-v1:${lanes.map(lane => lane.toString(16).padStart(8, "0")).join("")}`;
}
export function getStoryboardReviewFingerprint(project: AsmrProject): string {
  return compactFingerprint(JSON.stringify({ version: 1, projectId: project.project_id, workspace: project.speechWorkspace?.activeMode ?? "short",
    title: project.title, scene: { id: project.scene.id, name: project.scene.name },
    character: { id: project.character.id, role: project.character.role, personality: project.character.personality, speech_style: project.character.speech_style },
    sceneDescription: project.videoPlan?.sceneDescription,
    clips: getStoryboardReviewClips(project).map(clip => {
      const shot = project.videoPlan?.shots[clip.id];
      return { clipId: clip.id, kind: clip.kind ?? "speech", text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace,
        ...(clip.kind === "silent" ? { duration: clip.duration } : { source: { assetId: clip.asset.asset_id, uri: clip.asset.uri, duration: clip.asset.duration }, stale: Boolean(clip.audio_stale), status: clip.generation.status }),
        selectedReferenceMode: project.videoPlan?.referenceModes?.[clip.id],
        shot: shot ? { ...pickStoryboardReviewFields(shot), version: shot.version, promptFormat: shot.promptFormat, clipId: shot.clipId,
          kind: shot.kind, duration: shot.duration, sourceFingerprint: shot.sourceFingerprint,
          audio: shot.audio ? { assetId: shot.audio.assetId, uri: shot.audio.uri, duration: shot.audio.duration } : undefined,
          referenceMode: shot.referenceMode, previousClipId: shot.previousClipId, previousPromptFingerprint: shot.previousPromptFingerprint } : null };
    }) }));
}
export function getStoryboardReviewSummary(project: AsmrProject) {
  const clips = getStoryboardReviewClips(project);
  let reason = "";
  if (!clips.length) reason = "请先添加台词或无对白镜头。";
  else if (clips.length > 400 || new Set(clips.map(clip => clip.id)).size !== clips.length) reason = "镜头数量或编号无效，请检查工程。";
  else if (clips.some(clip => clip.kind === "silent" && (!(clip.duration > 0) || clip.duration > 5))) reason = "请将无对白镜头调整为大于 0 且不超过 5 秒。";
  else if (clips.some(clip => clip.kind !== "silent" && (clip.audio_stale || clip.generation.status !== "asset_generated" || !clip.asset.asset_id || clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`))) reason = "请先生成并采用全部当前原音。";
  else {
    const usable = getUsableClipH3Prompts(project);
    if (clips.some(clip => !usable.has(clip.id))) reason = "请先补齐全部当前有效分镜，再进行整批校对。";
  }
  return { ready: !reason, reason, total: clips.length };
}
export function applyStoryboardReview(project: AsmrProject, input: StoryboardReview): AsmrProject {
  const review = StoryboardReviewSchema.parse(input);
  if (review.inputFingerprint !== getStoryboardReviewFingerprint(project)) throw new Error("文案、原音或分镜已变化，请重新校对。");
  if (!review.changes.length) return project;
  const ids = new Set(getStoryboardReviewClips(project).map(clip => clip.id));
  const replacements = review.changes.map(change => {
    const current = project.videoPlan?.shots[change.clipId];
    if (!ids.has(change.clipId) || !current || JSON.stringify(pickStoryboardReviewFields(current)) !== JSON.stringify(change.before)) throw new Error("校对前的分镜已变化，未应用任何修改。");
    const replacement = { ...current, ...change.after };
    if (change.after.ambientSound === undefined) delete replacement.ambientSound;
    if (![replacement.title, replacement.visual, replacement.action, replacement.camera].every(value => value.trim())
      || replacement.kind === "silent" && !replacement.ambientSound?.trim()) throw new Error("校对后的分镜文字不完整，未应用任何修改。");
    return [change.clipId, ClipVideoStoryboardSchema.parse(replacement)] as const;
  });
  const changed = { ...project, videoPlan: { ...project.videoPlan!, shots: { ...project.videoPlan!.shots, ...Object.fromEntries(replacements) } } };
  return captureSpeechWorkspace(rebindCurrentStoryboardReferences(project, changed));
}
