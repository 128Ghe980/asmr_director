import type { AsmrProject, SpeechWorkspace, SpeechWorkspaceBank, SpeechWorkspaceMode, TimelineTrack, VoiceClip } from "./schema";
import { splitSpeechSentences } from "./speech-sentences";

type CaptureOptions = { mixFingerprint?: string };
const sourceFields = ["text", "emotion", "style", "pace", "kind", "semantic_unit"] as const;

function voices(project: AsmrProject): VoiceClip[] {
  return [...(project.timeline.tracks.find((track) => track.track_type === "voice")?.clips ?? [])].sort((a, b) => a.start - b.start);
}

function bankSnapshot(project: AsmrProject, mixFingerprint?: string): SpeechWorkspaceBank {
  return {
    clips: structuredClone(voices(project)), duration: project.duration,
    supportingTracks: structuredClone(project.timeline.tracks.filter((track) => track.track_type !== "voice")),
    emotion_curve: structuredClone(project.emotion_curve), mixing: structuredClone(project.timeline.mixing),
    ...(project.videoPlan ? { videoPlan: structuredClone(project.videoPlan) } : {}),
    ...(project.audioPostProcessing ? { audioPostProcessing: structuredClone(project.audioPostProcessing) } : {}),
    exports: structuredClone(project.exports), ...(mixFingerprint !== undefined ? { mixFingerprint } : {}),
  };
}

function blankClip(clip: VoiceClip): VoiceClip {
  const next = structuredClone(clip);
  delete next.audio_stale;
  next.generation = { ...next.generation, status: "asset_pending", retry_count: 0, error: null };
  next.asset = { asset_id: null, uri: null, duration: null };
  return next;
}

function countSpoken(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

export function createSpeechParagraphGroups(clips: VoiceClip[], hanLimit = 80): SpeechWorkspace["groups"] {
  const groups: SpeechWorkspace["groups"] = [];
  let members: VoiceClip[] = [];
  let size = 0;
  let characters = 0;
  const flush = () => {
    if (!members.length) return;
    const first = members[0].id;
    groups.push({ id: first.length <= 180 ? `paragraph_${first}` : `paragraph_${crypto.randomUUID()}`, clipIds: members.map((clip) => clip.id) });
    members = []; size = 0; characters = 0;
  };
  for (const clip of clips) {
    if (clip.kind === "silent") { flush(); continue; }
    const weight = countSpoken(clip.text);
    if (members.length && (members.length >= 32 || size + weight > hanLimit || characters + clip.text.length > 500
      || members[0].emotion !== clip.emotion || members[0].style !== clip.style || members[0].pace !== clip.pace
      || /\n\s*\n/.test(members.at(-1)!.text))) flush();
    members.push(clip); size += weight; characters += clip.text.length;
  }
  flush();
  return groups;
}

export function getSpeechWorkspaceMode(project: AsmrProject): SpeechWorkspaceMode {
  return project.speechWorkspace?.activeMode ?? "short";
}

/** @deprecated Legacy sentence-boundary utility, not the definition of short
 * semantic units. Do not use during adoption, editing or workspace navigation. */
export function hasUnsplitSpeechSentences(project: AsmrProject): boolean {
  return voices(project).some((clip) => clip.kind !== "silent" && splitSpeechSentences(clip.text).length > 1);
}

/** @deprecated Legacy compatibility/experiments only, not the definition of
 * short units. Never call automatically during adoption, editing or navigation.
 * Split source units, never their audio. A full old recording cannot become
 * the first shorter sentence's take. The caller protects the complete project
 * in edit history before this operation on a project with existing results.
 * An optional ID limits an explicit legacy transformation to one source unit.
 */
export function normalizeSpeechSentences(project: AsmrProject, clipId?: string): AsmrProject {
  const original = voices(project);
  const reserved = new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  for (const bank of project.speechWorkspace ? [project.speechWorkspace.short, project.speechWorkspace.paragraph] : []) {
    bank.clips.forEach((clip) => reserved.add(clip.id));
  }
  const replacements = new Map<string, { texts: string[]; ids: string[] }>();
  for (const clip of original) {
    if (clip.kind === "silent" || (clipId !== undefined && clip.id !== clipId)) continue;
    const texts = splitSpeechSentences(clip.text);
    if (texts.length < 2) continue;
    const ids = texts.map((_, index) => {
      if (index === 0) return clip.id;
      let id: string;
      do { id = `voice_${crypto.randomUUID()}`; } while (reserved.has(id));
      reserved.add(id);
      return id;
    });
    replacements.set(clip.id, { texts, ids });
  }
  if (!replacements.size) return project;
  const splitClips = (clips: VoiceClip[]): VoiceClip[] => clips.flatMap((clip) => {
    const replacement = replacements.get(clip.id);
    if (!replacement) return [clip];
    const totalCharacters = replacement.texts.reduce((sum, text) => sum + Array.from(text).length, 0);
    let offset = 0;
    return replacement.texts.map((text, index): VoiceClip => {
      const start = clip.start + clip.duration * offset / totalCharacters;
      offset += Array.from(text).length;
      const end = index === replacement.texts.length - 1 ? clip.start + clip.duration
        : clip.start + clip.duration * offset / totalCharacters;
      const duration = end - start;
      return { ...blankClip(clip), id: replacement.ids[index], text, start, duration, semantic_unit: true,
        ...(clip.performance ? { performance: { ...clip.performance, segmentId: replacement.ids[index], direction: "", soundIntent: "" } } : {}),
        pause_after: index === replacement.texts.length - 1 ? clip.pause_after ?? 0 : 0,
        fade_in: Math.min(clip.fade_in, duration), fade_out: Math.min(clip.fade_out, duration) };
    });
  });
  const nextClips = splitClips(original);
  const next = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((track) => track.track_type === "voice"
    ? { ...track, clips: nextClips } : track) } };
  if (!project.speechWorkspace) return next;
  const captured = captureSpeechWorkspace(project);
  const workspace = captured.speechWorkspace!;
  const byId = new Map(nextClips.map((clip) => [clip.id, clip]));
  const groups = workspace.groups.flatMap((group) => {
    const memberIds = group.clipIds.flatMap((id) => replacements.get(id)?.ids ?? [id]);
    const divided: SpeechWorkspace["groups"] = [];
    let chunk: string[] = [];
    let characters = 0;
    const flush = () => {
      if (!chunk.length) return;
      divided.push({ id: divided.length ? `paragraph_${crypto.randomUUID()}` : group.id, clipIds: chunk });
      chunk = []; characters = 0;
    };
    for (const id of memberIds) {
      const textLength = byId.get(id)?.text.length ?? 0;
      if (chunk.length && (chunk.length >= 32 || characters + textLength > 500)) flush();
      chunk.push(id); characters += textLength;
    }
    flush();
    return divided;
  });
  const splitBank = (bank: SpeechWorkspaceBank): SpeechWorkspaceBank => {
    const clips = splitClips(bank.clips);
    const updated = { ...bank, clips };
    delete updated.mixFingerprint;
    return updated;
  };
  const updated = { ...captured, speechWorkspace: { ...workspace, groups,
    short: splitBank(workspace.short), paragraph: splitBank(workspace.paragraph) } };
  return restoreSpeechWorkspaceBank(updated, workspace.activeMode, updated.speechWorkspace[workspace.activeMode]);
}

/** Existing short takes remain byte-for-byte referenced; the new paragraph
 * workspace starts with the same source IDs and no generated results.
 */
export function ensureSpeechWorkspaces(project: AsmrProject): AsmrProject {
  if (project.speechWorkspace) return project;
  const short = bankSnapshot(project);
  const paragraph = structuredClone(short);
  paragraph.clips = paragraph.clips.map(blankClip);
  paragraph.supportingTracks = paragraph.supportingTracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({
    ...clip, generation: { ...clip.generation, status: "asset_pending", retry_count: 0, error: null },
    asset: { asset_id: null, uri: null, duration: null },
  })) } as Exclude<TimelineTrack, { track_type: "voice" }>));
  if (paragraph.videoPlan) paragraph.videoPlan = { ...paragraph.videoPlan, shots: {} };
  delete paragraph.audioPostProcessing;
  paragraph.exports = paragraph.exports.map((entry) => ({ ...entry, status: "not_started", uri: null }));
  delete paragraph.mixFingerprint;
  return { ...project, speechWorkspace: { version: 1, activeMode: "short", short, paragraph, groups: createSpeechParagraphGroups(short.clips) } };
}

export function captureSpeechWorkspace(project: AsmrProject, options: CaptureOptions = {}): AsmrProject {
  const initialized = ensureSpeechWorkspaces(project);
  const workspace = initialized.speechWorkspace!;
  const existing = workspace[workspace.activeMode];
  const fingerprint = Object.prototype.hasOwnProperty.call(options, "mixFingerprint") ? options.mixFingerprint : existing.mixFingerprint;
  const captured = bankSnapshot(initialized, fingerprint);
  if (JSON.stringify(captured) === JSON.stringify(existing)) return initialized;
  return { ...initialized, speechWorkspace: { ...workspace, [workspace.activeMode]: captured } };
}

export function restoreSpeechWorkspaceBank(project: AsmrProject, mode: SpeechWorkspaceMode, bank: SpeechWorkspaceBank): AsmrProject {
  const initialized = ensureSpeechWorkspaces(project);
  const voiceTrack = initialized.timeline.tracks.find((track) => track.track_type === "voice")!;
  const tracks = initialized.timeline.tracks.map((track) => track.track_type === "voice"
    ? { ...voiceTrack, clips: structuredClone(bank.clips) }
    : structuredClone(bank.supportingTracks.find((support) => support.track_type === track.track_type) ?? track));
  const next: AsmrProject = {
    ...initialized, duration: bank.duration, emotion_curve: structuredClone(bank.emotion_curve),
    timeline: { tracks, mixing: structuredClone(bank.mixing) }, exports: structuredClone(bank.exports),
    speechWorkspace: { ...initialized.speechWorkspace!, activeMode: mode, [mode]: structuredClone(bank) },
  };
  if (bank.videoPlan) next.videoPlan = structuredClone(bank.videoPlan);
  else delete next.videoPlan;
  if (bank.audioPostProcessing) next.audioPostProcessing = structuredClone(bank.audioPostProcessing);
  else delete next.audioPostProcessing;
  return next;
}

/** Navigation captures and restores results, and never repartitions the script. */
export function switchSpeechWorkspace(project: AsmrProject, mode: SpeechWorkspaceMode, options: CaptureOptions = {}): AsmrProject {
  const captured = captureSpeechWorkspace(project, options);
  if (captured.speechWorkspace!.activeMode === mode) return captured;
  return restoreSpeechWorkspaceBank(captured, mode, captured.speechWorkspace![mode]);
}

/** Read a generation target without navigating the user's current page. */
export function getSpeechWorkspaceProject(project: AsmrProject, mode: SpeechWorkspaceMode): AsmrProject {
  const captured = captureSpeechWorkspace(project);
  return mode === captured.speechWorkspace!.activeMode ? captured
    : restoreSpeechWorkspaceBank(captured, mode, captured.speechWorkspace![mode]);
}

/** Merge only the requested workspace's asynchronous results. The caller
 * validates its source fingerprint; the other workspace and latest shared
 * source remain those of current, even when navigation happened mid-request.
 */
export function mergeSpeechWorkspaceProject(current: AsmrProject, mode: SpeechWorkspaceMode, updatedProjection: AsmrProject): AsmrProject {
  const captured = captureSpeechWorkspace(current);
  const workspace = captured.speechWorkspace!;
  const updated = bankSnapshot(updatedProjection, updatedProjection.speechWorkspace?.[mode].mixFingerprint);
  const updatedById = new Map(updated.clips.map((clip) => [clip.id, clip]));
  const canonical = voices(captured);
  const canonicalById = new Map(canonical.map((clip) => [clip.id, clip]));
  updated.clips = workspace[mode].clips.map((existing) => syncSource(updatedById.get(existing.id) ?? existing,
    canonicalById.get(existing.id) ?? existing));
  updated.duration = Math.max(updated.duration, ...updated.clips.map((clip) => clip.start + clip.duration),
    ...updated.supportingTracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), ...updated.emotion_curve.map((point) => point.end));
  const merged = { ...captured, speechWorkspace: { ...workspace, [mode]: updated } };
  return workspace.activeMode === mode ? restoreSpeechWorkspaceBank(merged, mode, updated) : merged;
}

export function getParagraphGroup(project: AsmrProject, clipId: string): VoiceClip[] {
  const ordered = voices(project);
  const target = ordered.find((clip) => clip.id === clipId);
  if (!target || target.kind === "silent") return [];
  const group = project.speechWorkspace?.groups.find((item) => item.clipIds.includes(clipId));
  if (!group) return [target];
  return group.clipIds.flatMap((id) => {
    const member = ordered.find((clip) => clip.id === id);
    return member && member.kind !== "silent" ? [member] : [];
  });
}

export function getSpeechParagraphs(project: AsmrProject): { id: string; clipIds: string[]; text: string; clips: VoiceClip[] }[] {
  const initialized = ensureSpeechWorkspaces(project);
  return initialized.speechWorkspace!.groups.map((group) => {
    const clips = getParagraphGroup(initialized, group.clipIds[0]);
    return { ...group, clips, text: clips.map((clip) => clip.text).join("") };
  });
}

function sourceChanged(a: VoiceClip, b: VoiceClip): boolean {
  return sourceFields.some((field) => a[field] !== b[field]);
}

function syncSource(target: VoiceClip, source: VoiceClip): VoiceClip {
  const next = { ...target };
  for (const field of sourceFields) {
    Object.assign(next, { [field]: source[field] });
    if (source[field] === undefined) delete (next as Partial<VoiceClip>)[field];
  }
  if (source.kind === "silent") next.duration = source.duration;
  if (source.performance) next.performance = structuredClone(source.performance);
  else delete next.performance;
  return next;
}

function markStale(clip: VoiceClip): VoiceClip {
  return clip.kind !== "silent" && (clip.asset.asset_id || clip.asset.uri) ? { ...clip, audio_stale: true } : clip;
}

/** Source edits are shared; adopted takes, timing, mixes and visual results are
 * retained independently. Staleness is explicit instead of erasing old audio.
 */
export function syncSharedSpeechScript(previous: AsmrProject, next: AsmrProject): AsmrProject {
  const initialized = captureSpeechWorkspace(previous);
  const workspace = initialized.speechWorkspace!;
  const mode = workspace.activeMode;
  const before = voices(previous);
  const after = voices(next);
  const beforeById = new Map(before.map((clip) => [clip.id, clip]));
  const changed = new Set(after.filter((clip) => !beforeById.has(clip.id) || sourceChanged(beforeById.get(clip.id)!, clip)).map((clip) => clip.id));
  const performanceChanged = after.some(clip => JSON.stringify(clip.performance) !== JSON.stringify(beforeById.get(clip.id)?.performance));
  const silentTiming = after.some((clip) => clip.kind === "silent" && beforeById.get(clip.id)?.duration !== clip.duration);
  const structural = before.map((clip) => `${clip.id}:${clip.kind ?? "speech"}`).join("|") !== after.map((clip) => `${clip.id}:${clip.kind ?? "speech"}`).join("|");
  const speechOrderChanged = before.filter((clip) => clip.kind !== "silent").map((clip) => clip.id).join("|")
    !== after.filter((clip) => clip.kind !== "silent").map((clip) => clip.id).join("|");
  // A changed source boundary cannot keep a full old recording as a shorter
  // sentence's take. Ordinary word edits retain their independent stale audio.
  const repartitioned = new Set(after.filter((clip) => speechOrderChanged && beforeById.has(clip.id)
    && (beforeById.get(clip.id)!.text !== clip.text || beforeById.get(clip.id)!.kind !== clip.kind)).map((clip) => clip.id));
  if (!changed.size && !structural && !silentTiming && !performanceChanged) return captureSpeechWorkspace({ ...next, speechWorkspace: workspace });
  const explicitGroups = next.speechWorkspace?.groups;
  const explicitIds = explicitGroups?.flatMap((group) => group.clipIds) ?? [];
  const speechIds = after.filter((clip) => clip.kind !== "silent").map((clip) => clip.id);
  const explicitGroupsValid = explicitGroups && JSON.stringify(explicitGroups) !== JSON.stringify(workspace.groups)
    && explicitIds.length === speechIds.length && new Set(explicitIds).size === speechIds.length && speechIds.every((id) => explicitIds.includes(id));
  const groups = explicitGroupsValid ? explicitGroups : structural ? createSpeechParagraphGroups(after) : workspace.groups;
  const groupsChanged = JSON.stringify(groups) !== JSON.stringify(workspace.groups);
  // Inserting a silent shot between unchanged sentences keeps their adopted
  // cuts valid. Speech reordering or an explicit text-only regroup changes the
  // voice generation scope and does invalidate paragraph results.
  const groupContextChanged = speechOrderChanged || (Boolean(explicitGroupsValid) && !structural);
  const paragraphAffected = new Set<string>(changed);
  for (const group of [...workspace.groups, ...groups]) {
    const same = (groupsChanged ? (workspace.groups.includes(group) ? groups : workspace.groups) : [group])
      .some((candidate) => candidate.id === group.id && candidate.clipIds.join("|") === group.clipIds.join("|"));
    if ((!same && groupContextChanged) || group.clipIds.some((id) => changed.has(id))) group.clipIds.forEach((id) => paragraphAffected.add(id));
  }
  let activeProject = { ...next, speechWorkspace: { ...workspace, groups } };
  const retained = after.map((clip) => {
    const old = beforeById.get(clip.id);
    const sourceEdit = changed.has(clip.id);
    if (repartitioned.has(clip.id)) return blankClip(clip);
    const kept = old && sourceEdit ? { ...clip, asset: old.asset, generation: old.generation } : clip;
    return (mode === "paragraph" ? paragraphAffected : changed).has(clip.id) ? markStale(kept) : kept;
  });
  activeProject = { ...activeProject, timeline: { ...next.timeline, tracks: next.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: retained } : track) } };
  const captured = captureSpeechWorkspace(activeProject, { mixFingerprint: undefined });
  const otherMode = mode === "short" ? "paragraph" : "short";
  const other = workspace[otherMode];
  const otherById = new Map(other.clips.map((clip) => [clip.id, clip]));
  const waits = new Map(other.clips.map((clip, index) => [clip.id, clip.pause_after ?? (other.clips[index + 1]
    ? Math.max(0, other.clips[index + 1].start - clip.start - (clip.asset.duration ?? clip.duration)) : 0)]));
  let cursor = other.clips[0]?.start ?? after[0]?.start ?? 0;
  const otherClips = after.map((source) => {
    const original = otherById.get(source.id);
    let clip = original ? syncSource(repartitioned.has(source.id) ? blankClip(original) : original, source) : blankClip(source);
    if ((otherMode === "paragraph" ? paragraphAffected : changed).has(source.id)) clip = markStale(clip);
    if (structural || silentTiming) {
      const pause = waits.get(source.id) ?? source.pause_after ?? 0;
      clip = { ...clip, start: cursor, pause_after: pause };
      cursor += clip.duration + pause;
    }
    return clip;
  });
  const otherBank: SpeechWorkspaceBank = {
    ...other, clips: otherClips,
    duration: Math.max(other.duration, ...otherClips.map((clip) => clip.start + clip.duration)),
  };
  delete otherBank.mixFingerprint;
  return { ...captured, speechWorkspace: { ...captured.speechWorkspace!, [otherMode]: otherBank } };
}

/** Preserve existing semantic units during word edits. A rewrite spanning
 * units replaces only that affected range with one user-edited unit; punctuation
 * is part of the dialogue and never invents new source boundaries.
 */
export function replaceParagraphScript(project: AsmrProject, groupId: string, replacement: string): AsmrProject {
  const initialized = ensureSpeechWorkspaces(project);
  const group = initialized.speechWorkspace!.groups.find((item) => item.id === groupId);
  if (!group) return project;
  const members = getParagraphGroup(initialized, group.clipIds[0]);
  const oldText = members.map((clip) => clip.text).join("");
  if (oldText === replacement) return project;
  const oldChars = Array.from(oldText), newChars = Array.from(replacement);
  let prefix = 0;
  while (prefix < Math.min(oldChars.length, newChars.length) && oldChars[prefix] === newChars[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(oldChars.length - prefix, newChars.length - prefix)
    && oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]) suffix++;
  const oldEnd = oldChars.length - suffix;
  const newEnd = newChars.length - suffix;
  const lengths = members.map((clip) => Array.from(clip.text).length);
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0));
  let first = members.findIndex((_, index) => starts[index] + lengths[index] > prefix);
  if (first < 0) first = members.length - 1;
  let last = first;
  for (let index = first; index < members.length; index++) if (starts[index] < oldEnd) last = index;
  const affected = members.slice(first, last + 1);
  const edited = Array.from(affected[0].text).slice(0, prefix - starts[first]).join("")
    + newChars.slice(prefix, newEnd).join("")
    + Array.from(affected.at(-1)!.text).slice(oldEnd - starts[last]).join("");
  const partitionChanged = affected.length > 1;
  const total = Math.max(.1, affected.at(-1)!.start + affected.at(-1)!.duration - affected[0].start);
  const textLength = Math.max(1, Array.from(edited).length);
  const replacements: VoiceClip[] = [partitionChanged
    ? { ...blankClip(affected[0]), text: edited, duration: total, semantic_unit: true,
      pause_after: affected.at(-1)!.pause_after ?? 0,
      fade_in: Math.min(affected[0].fade_in, total), fade_out: Math.min(affected[0].fade_out, total) }
    : { ...affected[0], text: edited }];
  for (const clip of replacements) {
    if (clip.performance) clip.performance = { ...clip.performance, direction: "", soundIntent: "" };
  }
  const changedIds = new Set(affected.map((clip) => clip.id));
  const replacementMembers = [...members.slice(0, first), ...replacements, ...members.slice(last + 1)];
  // Paragraph capacity groups pack whole source units; they never split one.
  const replacementGroups: SpeechWorkspace["groups"] = [];
  let chunk: VoiceClip[] = [];
  let chunkCharacters = 0;
  const flush = () => {
    if (!chunk.length) return;
    const firstId = chunk[0].id;
    const id = replacementGroups.length === 0 ? groupId : firstId.length <= 180 ? `paragraph_${firstId}` : `paragraph_${crypto.randomUUID()}`;
    replacementGroups.push({ id, clipIds: chunk.map((clip) => clip.id) });
    chunk = []; chunkCharacters = 0;
  };
  for (const clip of replacementMembers) {
    if (chunk.length && (chunk.length >= 32 || chunkCharacters + clip.text.length > 500)) flush();
    chunk.push(clip); chunkCharacters += clip.text.length;
  }
  flush();
  const next = { ...initialized, speechWorkspace: { ...initialized.speechWorkspace!, groups: initialized.speechWorkspace!.groups.flatMap((item) => item.id === groupId
    ? replacementGroups : [item]) },
    timeline: { ...initialized.timeline, tracks: initialized.timeline.tracks.map((track) => track.track_type === "voice"
      ? { ...track, clips: track.clips.flatMap((clip) => clip.id === affected[0].id ? replacements : changedIds.has(clip.id) ? [] : [clip]) } : track) } };
  const synced = syncSharedSpeechScript(initialized, next);
  if (!partitionChanged) return synced;
  const mode = initialized.speechWorkspace!.activeMode;
  const otherMode = mode === "short" ? "paragraph" : "short";
  const originalBank = captureSpeechWorkspace(initialized).speechWorkspace![otherMode];
  const otherAffected = affected.map((clip) => originalBank.clips.find((item) => item.id === clip.id) ?? blankClip(clip));
  const otherStart = otherAffected[0].start;
  const otherTotal = Math.max(.01, otherAffected.at(-1)!.start + otherAffected.at(-1)!.duration - otherStart);
  let otherOffset = 0;
  const otherReplacements = replacements.map((source, index): VoiceClip => {
    const original = otherAffected[index] ?? otherAffected[0];
    const start = otherStart + otherTotal * otherOffset / textLength;
    otherOffset += Array.from(source.text).length;
    const end = index === replacements.length - 1 ? otherStart + otherTotal : otherStart + otherTotal * otherOffset / textLength;
    const duration = end - start;
    return { ...syncSource(blankClip(original), source), id: source.id, start, duration,
      pause_after: index === replacements.length - 1 ? otherAffected.at(-1)!.pause_after ?? 0 : 0,
      fade_in: Math.min(original.fade_in, duration), fade_out: Math.min(original.fade_out, duration) };
  });
  const otherSyncedById = new Map(synced.speechWorkspace![otherMode].clips.map((clip) => [clip.id, clip]));
  const otherClips = originalBank.clips.flatMap((clip) => clip.id === affected[0].id ? otherReplacements : changedIds.has(clip.id) ? []
    : [{ ...otherSyncedById.get(clip.id) ?? clip, start: clip.start, duration: clip.duration, pause_after: clip.pause_after }]);
  const otherBank = { ...synced.speechWorkspace![otherMode], clips: otherClips, duration: originalBank.duration };
  const replacedIds = new Set(replacements.map((clip) => clip.id));
  const activeBank = { ...synced.speechWorkspace![mode], clips: synced.speechWorkspace![mode].clips.map((clip) => replacedIds.has(clip.id) ? blankClip(clip) : clip) };
  const updated = { ...synced, speechWorkspace: { ...synced.speechWorkspace!, [mode]: activeBank, [otherMode]: otherBank } };
  return restoreSpeechWorkspaceBank(updated, mode, activeBank);
}

/** Undo shared source without restoring old result snapshots over later takes.
 * Deleted IDs recover their own workspace's historical assets; existing IDs
 * always keep the current result and acquire staleness for changed source.
 */
export function restoreSharedSpeechScript(current: AsmrProject, beforeSourceProject: AsmrProject): AsmrProject {
  const captured = captureSpeechWorkspace(current);
  const before = ensureSpeechWorkspaces(beforeSourceProject);
  const mode = captured.speechWorkspace!.activeMode;
  const desired = voices(before);
  const currentVoices = voices(captured);
  const needsReflow = currentVoices.map((clip) => `${clip.id}:${clip.kind ?? "speech"}`).join("|")
    !== desired.map((clip) => `${clip.id}:${clip.kind ?? "speech"}`).join("|")
    || desired.some((source) => source.kind === "silent" && currentVoices.find((clip) => clip.id === source.id)?.duration !== source.duration);
  const workspace = { ...captured.speechWorkspace! };
  const recovered = { short: new Set<string>(), paragraph: new Set<string>() };
  for (const bankMode of ["short", "paragraph"] as const) {
    const existing = workspace[bankMode];
    const ids = new Set(existing.clips.map((clip) => clip.id));
    const historical = before.speechWorkspace![bankMode].clips;
    const historicalById = new Map(historical.map((clip) => [clip.id, clip]));
    const restored = historical.filter((clip) => !ids.has(clip.id) && desired.some((source) => source.id === clip.id));
    restored.forEach((clip) => recovered[bankMode].add(clip.id));
    const existingClips = existing.clips.map((clip) => {
      const old = historicalById.get(clip.id);
      // Splitting deliberately cleared the first ID's complete old take. Undo
      // recovers it only while no newer result has been adopted at that ID.
      if (!needsReflow || clip.asset.asset_id || clip.asset.uri || !old
        || (!sourceChanged(clip, old) && !(old.asset.asset_id || old.asset.uri))) return clip;
      recovered[bankMode].add(clip.id);
      const next = { ...clip, asset: structuredClone(old.asset), generation: structuredClone(old.generation),
        duration: old.duration, fade_in: old.fade_in, fade_out: old.fade_out };
      if (old.pause_after === undefined) delete next.pause_after;
      else next.pause_after = old.pause_after;
      if (old.audio_stale === undefined) delete next.audio_stale;
      else next.audio_stale = old.audio_stale;
      return next;
    });
    workspace[bankMode] = { ...existing, clips: [...existingClips, ...structuredClone(restored)],
      duration: Math.max(existing.duration, ...restored.map((clip) => clip.start + clip.duration)) };
  }
  const activeById = new Map(workspace[mode].clips.map((clip) => [clip.id, clip]));
  const currentWaits = new Map(currentVoices.map((clip, index) => [clip.id, clip.pause_after ?? (currentVoices[index + 1]
    ? Math.max(0, currentVoices[index + 1].start - clip.start - (clip.kind === "silent" ? clip.duration : clip.asset.duration ?? clip.duration)) : 0)]));
  const historical = before.speechWorkspace![mode].clips;
  const historicalWaits = new Map(historical.map((clip, index) => [clip.id, clip.pause_after ?? (historical[index + 1]
    ? Math.max(0, historical[index + 1].start - clip.start - (clip.kind === "silent" ? clip.duration : clip.asset.duration ?? clip.duration)) : 0)]));
  let cursor = currentVoices[0]?.start ?? desired[0]?.start ?? 0;
  const restoredClips = desired.map((source) => {
    const existing = activeById.get(source.id) ?? blankClip(source);
    if (!needsReflow) return syncSource(existing, source);
    const pause = recovered[mode].has(source.id) ? historicalWaits.get(source.id) ?? 0
      : currentWaits.get(source.id) ?? historicalWaits.get(source.id) ?? 0;
    const clip = { ...syncSource(existing, source), start: cursor, pause_after: pause };
    cursor += clip.duration + pause;
    return clip;
  });
  const augmented = { ...captured, speechWorkspace: workspace, timeline: { ...captured.timeline,
    tracks: captured.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: workspace[mode].clips } : track) } };
  const next = { ...augmented, duration: Math.max(captured.duration, ...restoredClips.map((clip) => clip.start + clip.duration)),
    timeline: { ...augmented.timeline, tracks: augmented.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: restoredClips } : track) } };
  const synced = syncSharedSpeechScript(augmented, next);
  if (!needsReflow) return synced;
  const desiredById = new Map(desired.map((clip) => [clip.id, clip]));
  const restoredWorkspace = { ...synced.speechWorkspace! };
  for (const bankMode of ["short", "paragraph"] as const) {
    const protectedById = new Map(workspace[bankMode].clips.map((clip) => [clip.id, clip]));
    restoredWorkspace[bankMode] = { ...restoredWorkspace[bankMode], clips: restoredWorkspace[bankMode].clips.map((clip) => {
      const protectedClip = protectedById.get(clip.id);
      if (clip.asset.asset_id || clip.asset.uri || !protectedClip || !(protectedClip.asset.asset_id || protectedClip.asset.uri)) return clip;
      const restored = { ...clip, asset: protectedClip.asset, generation: protectedClip.generation,
        duration: protectedClip.duration, fade_in: protectedClip.fade_in, fade_out: protectedClip.fade_out };
      const source = desiredById.get(clip.id)!;
      if (!recovered[bankMode].has(clip.id) && sourceChanged(protectedClip, source)) restored.audio_stale = true;
      else if (protectedClip.audio_stale === undefined) delete restored.audio_stale;
      else restored.audio_stale = protectedClip.audio_stale;
      return restored;
    }) };
  }
  return restoreSpeechWorkspaceBank({ ...synced, speechWorkspace: restoredWorkspace }, mode, restoredWorkspace[mode]);
}

export function hasSharedSpeechScriptChanges(previous: AsmrProject, next: AsmrProject): boolean {
  const oldClips = voices(previous), newClips = voices(next);
  return oldClips.length !== newClips.length || newClips.some((clip, index) => {
    const old = oldClips[index];
    return !old || old.id !== clip.id || sourceChanged(old, clip) || JSON.stringify(old.performance) !== JSON.stringify(clip.performance)
      || (clip.kind === "silent" && clip.duration !== old.duration);
  });
}

/** Restore one workspace's arrangement without replacing any later generated
 * assets or the other workspace. Later take lengths shift the historical cues
 * so restoring a wait cannot truncate a newly adopted longer recording.
 */
export function restoreSpeechWorkspaceArrangement(current: AsmrProject, beforeProject: AsmrProject, mode: SpeechWorkspaceMode): AsmrProject {
  const captured = captureSpeechWorkspace(current);
  const workspace = captured.speechWorkspace!;
  const bank = workspace[mode];
  const before = getSpeechWorkspaceProject(beforeProject, mode).speechWorkspace![mode];
  const oldById = new Map(before.clips.map((clip) => [clip.id, clip]));
  const durationById = new Map(bank.clips.map((clip) => {
    const old = oldById.get(clip.id);
    const laterTake = old && clip.asset.asset_id !== old.asset.asset_id && Boolean(clip.asset.asset_id || clip.asset.uri);
    return [clip.id, laterTake ? Math.max(clip.duration, clip.asset.duration ?? 0) : old?.duration ?? clip.duration];
  }));
  const changes: { boundary: number; delta: number }[] = [];
  const mapTime = (original: number) => changes.reduce((time, change) => change.delta >= 0
    ? time >= change.boundary ? time + change.delta : time
    : time >= change.boundary ? time + change.delta : Math.min(time, change.boundary + change.delta), original);
  for (const old of before.clips) {
    const delta = (durationById.get(old.id) ?? old.duration) - old.duration;
    if (delta !== 0) changes.push({ boundary: mapTime(old.start + old.duration), delta });
  }
  const clips = bank.clips.map((clip): VoiceClip => {
    const old = oldById.get(clip.id);
    if (!old) return clip;
    const duration = durationById.get(clip.id)!;
    const restored = { ...clip, start: Math.max(0, mapTime(old.start)), duration,
      volume_db: old.volume_db, fade_in: Math.min(old.fade_in, duration), fade_out: Math.min(old.fade_out, duration), position: structuredClone(old.position) };
    if (old.pause_after === undefined) delete restored.pause_after;
    else restored.pause_after = old.pause_after;
    return restored;
  });
  const supportingTracks: SpeechWorkspaceBank["supportingTracks"] = bank.supportingTracks.map((track): SpeechWorkspaceBank["supportingTracks"][number] => {
    const original = before.supportingTracks.find((item) => item.track_type === track.track_type);
    return { ...track, clips: track.clips.map((clip) => {
      const old = original?.clips.find((item) => item.id === clip.id);
      if (!old) return clip;
      const start = Math.max(0, mapTime(old.start));
      const duration = Math.max(.01, mapTime(old.start + old.duration) - start);
      return { ...clip, start, duration, volume_db: old.volume_db,
        fade_in: Math.min(old.fade_in, duration), fade_out: Math.min(old.fade_out, duration), position: structuredClone(old.position) };
    }) } as SpeechWorkspaceBank["supportingTracks"][number];
  });
  const emotion_curve = before.emotion_curve.map((point) => ({ ...point, start: Math.max(0, mapTime(point.start)), end: Math.max(.01, mapTime(point.end)) }))
    .filter((point) => point.end > point.start);
  const restored: SpeechWorkspaceBank = { ...bank, clips, supportingTracks, mixing: structuredClone(before.mixing),
    emotion_curve: emotion_curve.length ? emotion_curve : bank.emotion_curve,
    duration: Math.max(.01, mapTime(before.duration), ...clips.map((clip) => clip.start + clip.duration),
      ...supportingTracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), ...emotion_curve.map((point) => point.end)) };
  delete restored.mixFingerprint;
  const merged = { ...captured, speechWorkspace: { ...workspace, [mode]: restored } };
  return workspace.activeMode === mode ? restoreSpeechWorkspaceBank(merged, mode, restored) : merged;
}
