import type { AsmrProject, TimelineClip, TimelineTrack } from "./schema";

type VoiceClip = Extract<TimelineClip, { type: "voice" }>;

export type VoiceSegmentEdit = {
  project: AsmrProject;
  selectedClipId: string | null;
};

export type VoiceClipMoveDirection = "up" | "down";

function voices(project: AsmrProject): VoiceClip[] {
  const track = project.timeline.tracks.find((track) => track.track_type === "voice");
  return track ? [...track.clips].sort((a, b) => a.start - b.start) : [];
}

function spokenDuration(clip: VoiceClip): number {
  if (clip.kind === "silent") return clip.duration;
  const duration = clip.asset.duration;
  return (clip.asset.uri || clip.asset.asset_id) && duration !== null &&
    Number.isFinite(duration) && duration > 0 ? duration : clip.duration;
}

function newVoiceId(project: AsmrProject, reserved: Set<string> = new Set()): string {
  const existing = new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  let id: string;
  do {
    id = `voice_${crypto.randomUUID()}`;
  } while (existing.has(id) || reserved.has(id));
  reserved.add(id);
  return id;
}

function pendingVoice(clip: VoiceClip): VoiceClip {
  return {
    ...clip,
    generation: { ...clip.generation, status: "asset_pending", retry_count: 0, error: null },
    asset: { asset_id: null, uri: null, duration: null },
  };
}

function replaceVoices(project: AsmrProject, clips: VoiceClip[]): AsmrProject {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => track.track_type === "voice"
        ? { ...track, clips }
        : track),
    },
  };
}

function fitProjectBounds(project: AsmrProject): AsmrProject {
  const duration = Math.max(
    0.01,
    project.duration,
    ...project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
    ...project.emotion_curve.map((point) => point.end),
  );
  return duration === project.duration ? project : { ...project, duration };
}

/** Insert/remove time immediately before a boundary without slicing any audio.
 * Non-looping clips retain their full duration; cues inside removed silence
 * move to its beginning. Only looping ambience and emotion regions contract.
 */
function rippleTime(
  project: AsmrProject,
  boundary: number,
  delta: number,
  protectedIds: Set<string> = new Set(),
): AsmrProject {
  if (delta === 0) return project;
  const mapTime = delta > 0
    ? (time: number) => time >= boundary ? time + delta : time
    : (time: number) => time >= boundary ? time + delta : Math.min(time, boundary + delta);
  const tracks = project.timeline.tracks.map((track) => ({
    ...track,
    clips: (track.clips as TimelineClip[]).map((clip) => {
      if (protectedIds.has(clip.id)) return clip;
      const start = Math.max(0, mapTime(clip.start));
      if (clip.type === "ambience" && clip.loop) {
        const end = mapTime(clip.start + clip.duration);
        return { ...clip, start, duration: Math.max(0.01, end - start) };
      }
      return start === clip.start ? clip : { ...clip, start };
    }),
  } as TimelineTrack));
  const duration = Math.max(0.01, mapTime(project.duration));
  const emotionCurve = project.emotion_curve.map((point) => ({
    ...point,
    start: Math.max(0, mapTime(point.start)),
    end: Math.max(0, mapTime(point.end)),
  })).filter((point) => point.end > point.start);
  return fitProjectBounds({
    ...project,
    duration,
    emotion_curve: emotionCurve.length ? emotionCurve : [{
      start: 0,
      end: duration,
      emotion: project.emotion_curve[0].emotion,
    }],
    timeline: { ...project.timeline, tracks },
  });
}

export function getVoiceGapAfter(project: AsmrProject, clipId: string): number | null {
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  if (index < 0 || index === ordered.length - 1) return null;
  return Math.max(0, ordered[index + 1].start - ordered[index].start - spokenDuration(ordered[index]));
}

/** Move a complete paragraph, including its following wait, without replacing
 * adopted audio. Reflow only the affected voice suffix; absolute-time cues on
 * other tracks and saved storyboard references stay where the user put them.
 */
export function moveVoiceClip(
  project: AsmrProject,
  clipId: string,
  direction: VoiceClipMoveDirection,
): VoiceSegmentEdit {
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  const target = index + (direction === "up" ? -1 : 1);
  const unchanged = { project, selectedClipId: ordered[index]?.id ?? null };
  if (index < 0 || target < 0 || target >= ordered.length) return unchanged;

  const waits = new Map(ordered.map((clip, clipIndex) => [clip.id,
    clip.pause_after ?? (ordered[clipIndex + 1]
      ? Math.max(0, ordered[clipIndex + 1].start - clip.start - spokenDuration(clip))
      : 0),
  ]));
  const firstChanged = Math.min(index, target);
  let start = ordered[firstChanged].start;
  const previous = ordered[firstChanged - 1];
  if (previous) {
    start = Math.max(start, previous.start + Math.max(previous.duration, spokenDuration(previous)) + waits.get(previous.id)!);
  }
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const reordered = ordered.map((clip, clipIndex): VoiceClip => {
    if (clipIndex < firstChanged) return clip;
    const duration = spokenDuration(clip);
    const pause_after = waits.get(clip.id)!;
    const updated = {
      ...clip, start, duration, pause_after,
      fade_in: Math.min(clip.fade_in, duration),
      fade_out: Math.min(clip.fade_out, duration),
    };
    start += duration + pause_after;
    return updated;
  });
  return {
    project: fitProjectBounds(replaceVoices(project, reordered)),
    selectedClipId: clipId,
  };
}

/** Keep an explicit pause stable when generated audio is longer OR shorter.
 * The generation state module invokes this only for user-controlled segments.
 */
export function fitVoiceSegmentTiming(
  project: AsmrProject,
  clipId: string,
  duration: number,
): AsmrProject {
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  const voice = ordered[index];
  if (!voice || voice.pause_after === undefined) return project;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid generated voice duration");
  const next = ordered[index + 1];
  const updated = replaceVoices(project, ordered.map((clip) => clip.id === clipId
    ? { ...clip, duration, fade_in: Math.min(clip.fade_in, duration), fade_out: Math.min(clip.fade_out, duration) }
    : clip));
  // First move the end of the speech, including cues in its following silence.
  // Then adjust only the remaining wait to the explicitly requested amount.
  const fitted = rippleTime(updated, voice.start + voice.duration, duration - voice.duration, new Set([clipId]));
  if (!next) return fitProjectBounds(fitted);
  const nextStart = voices(fitted).find((clip) => clip.id === next.id)!.start;
  const desiredStart = voice.start + duration + voice.pause_after;
  return fitProjectBounds(rippleTime(fitted, nextStart, desiredStart - nextStart, new Set([clipId])));
}

export function setVoiceGapAfter(project: AsmrProject, clipId: string, seconds: number): AsmrProject {
  if (!Number.isFinite(seconds) || seconds < 0) return project;
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  const voice = ordered[index];
  if (!voice || !ordered[index + 1]) return project;
  const duration = spokenDuration(voice);
  if (voice.pause_after === seconds && voice.duration === duration && getVoiceGapAfter(project, clipId) === seconds) {
    return project;
  }
  const marked = replaceVoices(project, ordered.map((clip) => clip.id === clipId
    ? { ...clip, pause_after: seconds }
    : clip));
  return fitVoiceSegmentTiming(marked, clipId, duration);
}

function normalizeVoiceGrowth(project: AsmrProject, clipId: string): AsmrProject {
  const ordered = voices(project);
  const voice = ordered.find((clip) => clip.id === clipId)!;
  const duration = spokenDuration(voice);
  if (duration <= voice.duration) return project;
  // Imports predating automatic fitting can contain a long asset in a shorter
  // clip. Repair that space before inserting pieces, or time sorting can place
  // a new piece after the next original paragraph.
  const normalized = replaceVoices(project, ordered.map((clip) => clip.id === clipId ? { ...clip, duration } : clip));
  return rippleTime(normalized, voice.start + voice.duration, duration - voice.duration, new Set([clipId]));
}

function validTextBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  // Textarea selection offsets are UTF-16. Do not produce broken surrogate pairs.
  return !(offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

export function splitVoiceClip(project: AsmrProject, clipId: string, start: number, end = start): VoiceSegmentEdit {
  const ordered = voices(project);
  const voice = ordered.find((clip) => clip.id === clipId);
  const unchanged = { project, selectedClipId: voice?.id ?? null };
  if (!voice || voice.kind === "silent" || !validTextBoundary(voice.text, start) || !validTextBoundary(voice.text, end) || end < start) return unchanged;
  if (start !== end && !voice.text.slice(start, end).trim()) return unchanged;
  if (start !== end) {
    // Keep leading/trailing whitespace with speech rather than creating blank clips.
    if (!voice.text.slice(0, start).trim()) start = 0;
    if (!voice.text.slice(end).trim()) end = voice.text.length;
  }
  const boundaries = [...new Set([0, start, end, voice.text.length])].sort((a, b) => a - b);
  const texts = boundaries.slice(0, -1).map((offset, index) => voice.text.slice(offset, boundaries[index + 1]));
  if (texts.length < 2 || texts.some((text) => !text.trim())) return unchanged;
  const base = normalizeVoiceGrowth(project, clipId);
  const duration = spokenDuration(voice);
  const reserved = new Set<string>();
  const lastPause = voice.pause_after ?? getVoiceGapAfter(base, clipId) ?? 0;
  const pieces = texts.map((text, index): VoiceClip => {
    const pieceStart = voice.start + duration * boundaries[index] / voice.text.length;
    const pieceEnd = voice.start + duration * boundaries[index + 1] / voice.text.length;
    const pieceDuration = pieceEnd - pieceStart;
    return pendingVoice({
      ...voice,
      id: index === 0 ? voice.id : newVoiceId(project, reserved),
      start: pieceStart,
      duration: pieceDuration,
      text,
      semantic_unit: true,
      pause_after: index === texts.length - 1 ? lastPause : 0,
      fade_in: Math.min(voice.fade_in, pieceDuration),
      fade_out: Math.min(voice.fade_out, pieceDuration),
    });
  });
  if (pieces.some((clip) => clip.duration <= 0)) return unchanged;
  const selectedIndex = boundaries.indexOf(start);
  return {
    project: fitProjectBounds(replaceVoices(base, voices(base).flatMap((clip) => clip.id === clipId ? pieces : [clip]))),
    selectedClipId: pieces[Math.min(selectedIndex, pieces.length - 1)].id,
  };
}

export function addVoiceClip(project: AsmrProject, afterClipId?: string): VoiceSegmentEdit {
  const original = voices(project);
  const selected = afterClipId ? original.find((clip) => clip.id === afterClipId) : original.at(-1);
  if (afterClipId && !selected) return { project, selectedClipId: null };
  const base = selected ? normalizeVoiceGrowth(project, selected.id) : project;
  const ordered = voices(base);
  const after = selected ? ordered.find((clip) => clip.id === selected.id) : undefined;
  const start = after ? after.start + spokenDuration(after) : 0;
  const inheritedPause = after ? getVoiceGapAfter(base, after.id) ?? after.pause_after ?? 0 : 0;
  const source: VoiceClip = after ?? {
    id: "", type: "voice", track: "voice", text: "", start: 0, duration: 4,
    emotion: "gentle", style: "soft", pace: "slow", volume_db: -12,
    fade_in: 0.05, fade_out: 0.2,
    position: { pan: 0, distance: "near", movement: "static" },
    generation: { status: "asset_pending", model: "gpt-sovits", seed: 0, retry_count: 0, error: null },
    asset: { asset_id: null, uri: null, duration: null },
  };
  const added = pendingVoice({
    ...source,
    id: newVoiceId(project), text: "在这里输入台词。", start, duration: 4,
    kind: "speech", audio_stale: undefined,
    semantic_unit: true,
    pause_after: inheritedPause,
    fade_in: Math.min(source.fade_in, 4), fade_out: Math.min(source.fade_out, 4),
  });
  const normalized = after ? replaceVoices(base, ordered.map((clip) => clip.id === after.id
    ? { ...clip, duration: spokenDuration(clip), pause_after: 0 }
    : clip)) : base;
  const shifted = rippleTime(normalized, start, added.duration, new Set(after ? [after.id] : []));
  return {
    project: fitProjectBounds(replaceVoices(shifted, [...voices(shifted), added].sort((a, b) => a.start - b.start))),
    selectedClipId: added.id,
  };
}

/** Insert editorial picture time without touching any existing voice asset. */
export function addSilentClip(project: AsmrProject, afterClipId?: string, options: {
  description?: string; duration?: number;
} = {}): VoiceSegmentEdit {
  const duration = options.duration ?? 4;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) return { project, selectedClipId: null };
  const edit = addVoiceClip(project, afterClipId);
  if (!edit.selectedClipId) return edit;
  const silent = replaceVoices(edit.project, voices(edit.project).map((clip) => clip.id === edit.selectedClipId ? {
    ...clip, kind: "silent", text: options.description?.trim() || "轻轻放下水杯，镜头停留在桌边。",
    semantic_unit: false, audio_stale: undefined, fade_in: 0, fade_out: 0,
  } : clip));
  return { ...edit, project: fitVoiceSegmentTiming(silent, edit.selectedClipId, duration) };
}

/** The active projection is synchronized to the other bank by its caller. */
export function setSilentClipDuration(project: AsmrProject, clipId: string, seconds: number): AsmrProject {
  const clip = voices(project).find((item) => item.id === clipId);
  if (clip?.kind !== "silent" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600 || seconds === clip.duration) return project;
  const marked = clip.pause_after === undefined ? replaceVoices(project, voices(project).map((item) => item.id === clipId
    ? { ...item, pause_after: getVoiceGapAfter(project, clipId) ?? 0 } : item)) : project;
  return fitVoiceSegmentTiming(marked, clipId, seconds);
}

export function deleteVoiceClip(project: AsmrProject, clipId: string): VoiceSegmentEdit {
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  if (index < 0) return { project, selectedClipId: null };
  const voice = ordered[index];
  const next = ordered[index + 1];
  const boundary = next?.start ?? voice.start + voice.duration;
  const removed = replaceVoices(project, ordered.filter((clip) => clip.id !== clipId));
  const updated = rippleTime(removed, boundary, voice.start - boundary);
  return { project: updated, selectedClipId: next?.id ?? ordered[index - 1]?.id ?? null };
}

export function mergeVoiceClipWithNext(project: AsmrProject, clipId: string): VoiceSegmentEdit {
  const ordered = voices(project);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  const voice = ordered[index];
  const next = ordered[index + 1];
  if (!voice || !next || voice.kind === "silent" || next.kind === "silent") return { project, selectedClipId: voice?.id ?? null };
  const duration = Math.max(voice.start + spokenDuration(voice), next.start + spokenDuration(next)) - voice.start;
  const merged = pendingVoice({
    ...voice, text: voice.text + next.text, duration,
    ...(voice.semantic_unit || next.semantic_unit ? { semantic_unit: true } : {}),
    fade_out: Math.min(next.fade_out, duration),
    pause_after: next.pause_after ?? getVoiceGapAfter(project, next.id) ?? 0,
  });
  return {
    project: fitProjectBounds(replaceVoices(project, ordered.filter((clip) => clip.id !== next.id)
      .map((clip) => clip.id === clipId ? merged : clip))),
    selectedClipId: clipId,
  };
}
