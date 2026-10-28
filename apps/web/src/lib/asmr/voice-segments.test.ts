import { describe, expect, it, vi } from "vitest";

import { getProjectMixFingerprint } from "./generation-fingerprint";
import { commitGenerationSuccess } from "./generation-project-state";
import { demoProject } from "./mock-project";
import { AsmrProjectSchema, type AsmrProject, type TimelineClip } from "./schema";
import {
  addVoiceClip,
  addSilentClip,
  deleteVoiceClip,
  getVoiceGapAfter,
  mergeVoiceClipWithNext,
  moveVoiceClip,
  setVoiceGapAfter,
  splitVoiceClip,
} from "./voice-segments";

function voiceClips(project: AsmrProject) {
  return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
}

function clip(project: AsmrProject, id: string): TimelineClip {
  return project.timeline.tracks.flatMap((track) => track.clips as TimelineClip[]).find((clip) => clip.id === id)!;
}

function projectWithAudio() {
  const project = structuredClone(demoProject);
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      clip.asset = { asset_id: `${clip.id}_original`, uri: `asset://clip/${clip.id}_original`, duration: clip.duration };
      clip.generation.status = "asset_generated";
    }
  }
  project.exports = [{ type: "wav", status: "exported", uri: "asset://mix/original_mix" }];
  return project;
}

describe("user-controlled voice segments", () => {
  it("gives inserted and split performance sections distinct identities without repeating the original one-off action", () => {
    const project = projectWithAudio();
    const original = voiceClips(project)[0];
    original.performance = { version: 1, segmentId: "take_box", purpose: "dialogue", direction: "拿起盒子", soundIntent: "一次拿取声" };
    const added = addSilentClip(project, original.id, { description: "保持盒子位置，轻轻敲击。", duration: 20 });
    const silent = voiceClips(added.project).find(clip => clip.id === added.selectedClipId)!;
    expect(silent.performance).toEqual({ version: 1, segmentId: silent.id, purpose: "transition", direction: "", soundIntent: "" });
    expect(silent.duration).toBe(20);
    const split = splitVoiceClip(project, original.id, 4);
    const pieces = voiceClips(split.project).slice(0, 2);
    expect(new Set(pieces.map(clip => clip.performance?.segmentId)).size).toBe(2);
    expect(pieces.every(clip => clip.performance?.direction === "" && clip.performance.soundIntent === "")).toBe(true);
    const merged = mergeVoiceClipWithNext(split.project, pieces[0].id);
    expect(voiceClips(merged.project)[0].performance).toMatchObject({ purpose: "dialogue", direction: "", soundIntent: "" });
    expect(original.performance.direction).toBe("拿起盒子");
  });
  it("moves complete adopted paragraphs with their waits while preserving identities and other tracks", () => {
    const project = projectWithAudio();
    const original = voiceClips(project);
    original[0].pause_after = 2;
    original[1].pause_after = 3;
    const before = structuredClone(project);
    const result = moveVoiceClip(project, original[1].id, "up");
    const reordered = voiceClips(result.project);

    expect(reordered.map((voice) => voice.id)).toEqual(["voice_002", "voice_001", "voice_003", "voice_004"]);
    expect(result.selectedClipId).toBe("voice_002");
    expect(reordered[0].start).toBe(16);
    expect(reordered[1].start).toBeCloseTo(27.2);
    expect(reordered[2].start).toBeCloseTo(36.7);
    for (const source of original) {
      const target = reordered.find((voice) => voice.id === source.id)!;
      expect(target.text).toBe(source.text);
      expect(target.asset).toBe(source.asset);
      expect(target.generation).toBe(source.generation);
      expect(target.position).toBe(source.position);
    }
    expect(getVoiceGapAfter(result.project, "voice_002")).toBeCloseTo(3);
    expect(getVoiceGapAfter(result.project, "voice_001")).toBeCloseTo(2);
    expect(result.project.timeline.tracks.slice(1)).toEqual(project.timeline.tracks.slice(1));
    expect(result.project.emotion_curve).toBe(project.emotion_curve);
    expect(result.project.exports).toBe(project.exports);
    expect(getProjectMixFingerprint(result.project)).not.toBe(getProjectMixFingerprint(project));
    expect(AsmrProjectSchema.safeParse(result.project).success).toBe(true);
    expect(project).toEqual(before);
  });

  it("reorders by displayed time rather than the stored array and infers waits for older projects", () => {
    const project = projectWithAudio();
    const ordered = voiceClips(project);
    const waits = new Map(ordered.map((voice) => [voice.id, getVoiceGapAfter(project, voice.id) ?? 0]));
    project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.reverse();
    const result = moveVoiceClip(project, "voice_002", "down");
    const reordered = voiceClips(result.project);
    expect(reordered.map((voice) => voice.id)).toEqual(["voice_001", "voice_003", "voice_002", "voice_004"]);
    expect(reordered[0]).toBe(ordered.at(-1));
    expect(reordered[1].start).toBe(58);
    for (const voice of reordered.slice(1, -1)) expect(getVoiceGapAfter(result.project, voice.id)).toBeCloseTo(waits.get(voice.id)!);
    expect(AsmrProjectSchema.safeParse(result.project).success).toBe(true);
  });

  it("uses full saved audio durations and extends project bounds without overlapping speech", () => {
    const project = projectWithAudio();
    const original = voiceClips(project);
    original[1].asset.duration = 180;
    original[2].asset.duration = 90;
    original[1].pause_after = 1;
    original[2].pause_after = 2;
    const result = moveVoiceClip(project, "voice_003", "up");
    const reordered = voiceClips(result.project);
    expect(reordered[0]).toBe(original[0]);
    expect(reordered[1].duration).toBe(90);
    expect(reordered[2].duration).toBe(180);
    expect(reordered[1].asset).toBe(original[2].asset);
    expect(reordered[2].asset).toBe(original[1].asset);
    for (let index = 1; index < reordered.length; index++) {
      expect(reordered[index].start).toBeGreaterThanOrEqual(reordered[index - 1].start + reordered[index - 1].duration);
    }
    expect(result.project.duration).toBeGreaterThan(project.duration);
    expect(AsmrProjectSchema.safeParse(result.project).success).toBe(true);
  });

  it("keeps the final paragraph movable and preserves its implicit zero following wait", () => {
    const project = projectWithAudio();
    const moved = moveVoiceClip(project, "voice_004", "up");
    const ordered = voiceClips(moved.project);
    expect(ordered.map((voice) => voice.id)).toEqual(["voice_001", "voice_002", "voice_004", "voice_003"]);
    expect(getVoiceGapAfter(moved.project, "voice_004")).toBe(0);
    expect(ordered[2].start).toBe(112);
    const reversed = moveVoiceClip(moved.project, "voice_004", "down");
    expect(voiceClips(reversed.project).map((voice) => voice.id)).toEqual(voiceClips(project).map((voice) => voice.id));
    expect(AsmrProjectSchema.safeParse(reversed.project).success).toBe(true);
  });

  it("respects an unfitted preceding recording and keeps a moved wait stable after later adoption", () => {
    const project = projectWithAudio();
    const original = voiceClips(project);
    original[0].asset.duration = 80;
    original[2].asset.duration = 0.5;
    original[2].fade_out = 1;
    original[2].pause_after = 2;
    const moved = moveVoiceClip(project, "voice_003", "up").project;
    const reordered = voiceClips(moved);
    expect(reordered[0]).toBe(original[0]);
    expect(reordered[1].start).toBe(96);
    expect(reordered[1].duration).toBe(0.5);
    expect(reordered[1].fade_out).toBe(0.5);
    expect(getVoiceGapAfter(moved, "voice_003")).toBe(2);
    const regenerated = commitGenerationSuccess(moved, "voice_003", {
      assetId: "replacement", uri: "asset://clip/replacement", duration: 10,
    }, { fitVoiceTiming: true });
    expect(getVoiceGapAfter(regenerated, "voice_003")).toBe(2);
    expect(AsmrProjectSchema.safeParse(regenerated).success).toBe(true);
  });

  it("leaves unavailable moves, missing and non-voice IDs untouched", () => {
    const project = projectWithAudio();
    for (const [id, direction] of [["voice_001", "up"], ["voice_004", "down"], ["missing", "up"], ["breath_001", "down"]] as const) {
      expect(moveVoiceClip(project, id, direction).project).toBe(project);
    }
    const empty = structuredClone(project);
    empty.timeline.tracks.find((track) => track.track_type === "voice")!.clips = [];
    expect(moveVoiceClip(empty, "voice_001", "down").project).toBe(empty);
  });

  it("isolates exactly the selected text, preserves every character and invalidates only changed speech", () => {
    const project = projectWithAudio();
    const source = voiceClips(project)[0];
    source.text = "  第一句。\n第二句！  第三句。\n";
    const start = source.text.indexOf("第二句");
    const end = start + "第二句！".length;
    const result = splitVoiceClip(project, source.id, start, end);
    const resultVoices = voiceClips(result.project);

    expect(resultVoices.slice(0, 3).map((voice) => voice.text).join("")).toBe(source.text);
    expect(resultVoices[1].text).toBe("第二句！");
    expect(result.selectedClipId).toBe(resultVoices[1].id);
    expect(resultVoices[0].id).toBe(source.id);
    expect(resultVoices.slice(0, 3).map((voice) => voice.pause_after)).toEqual([0, 0, getVoiceGapAfter(project, source.id)]);
    for (const voice of resultVoices.slice(0, 3)) {
      expect(voice.semantic_unit).toBe(true);
      expect(voice.asset.uri).toBeNull();
      expect(voice.generation.status).toBe("asset_pending");
    }
    expect(resultVoices[3]).toBe(voiceClips(project)[1]);
    expect(result.project.timeline.tracks[1]).toBe(project.timeline.tracks[1]);
    expect(result.project.exports).toBe(project.exports);
    expect(getProjectMixFingerprint(result.project)).not.toBe(getProjectMixFingerprint(project));
    expect(AsmrProjectSchema.safeParse(result.project).success).toBe(true);
    expect(source.asset.uri).toBe("asset://clip/voice_001_original");
  });

  it("splits at a cursor and retains whitespace with the actual speech", () => {
    const project = structuredClone(demoProject);
    const source = voiceClips(project)[0];
    source.text = "  第一。\n第二。  ";
    const result = splitVoiceClip(project, source.id, source.text.indexOf("第二"));
    expect(voiceClips(result.project).slice(0, 2).map((voice) => voice.text)).toEqual(["  第一。\n", "第二。  "]);
    expect(result.selectedClipId).toBe(voiceClips(result.project)[1].id);
    const selection = splitVoiceClip(project, source.id, 2, 5);
    expect(voiceClips(selection.project)[0].text).toBe("  第一。");
    expect(voiceClips(selection.project).slice(0, 2).map((voice) => voice.text).join("")).toBe(source.text);
  });

  it("leaves invalid, blank-only, full-text and surrogate-interior selections untouched", () => {
    const project = structuredClone(demoProject);
    const source = voiceClips(project)[0];
    source.text = "先😀说。  再说。";
    for (const [start, end] of [[0, 0], [source.text.length, source.text.length], [-1, 2], [2, 2], [2.5, 4], [NaN, 3], [7, 4], [0, 99], [5, 7], [0, source.text.length]]) {
      expect(splitVoiceClip(project, source.id, start, end).project).toBe(project);
    }
    expect(splitVoiceClip(project, "missing", 2).project).toBe(project);
  });

  it("creates collision-free IDs even when the UUID source repeats an existing ID", () => {
    const project = structuredClone(demoProject);
    voiceClips(project)[1].id = "voice_existing";
    const random = vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("existing" as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValueOnce("fresh" as `${string}-${string}-${string}-${string}-${string}`);
    try {
      const result = splitVoiceClip(project, "voice_001", 3);
      expect(result.selectedClipId).toBe("voice_fresh");
    } finally {
      random.mockRestore();
    }
  });

  it("measures and changes silence from the actual audio end and preserves existing assets", () => {
    const project = projectWithAudio();
    voiceClips(project)[0].asset.duration = 5;
    expect(getVoiceGapAfter(project, "voice_001")).toBe(37);
    const updated = setVoiceGapAfter(project, "voice_001", 2);

    expect(voiceClips(updated)[0].duration).toBe(5);
    expect(voiceClips(updated)[0].pause_after).toBe(2);
    expect(voiceClips(updated)[1].start).toBe(23);
    expect(getVoiceGapAfter(updated, "voice_001")).toBe(2);
    expect(clip(updated, "breath_001").start).toBe(23);
    expect(clip(updated, "sfx_blanket_001").duration).toBe(clip(project, "sfx_blanket_001").duration);
    expect(clip(updated, "ambience_rain_001").duration).toBe(175);
    expect(updated.duration).toBe(175);
    expect(voiceClips(updated).every((voice, index) => voice.asset === voiceClips(project)[index].asset)).toBe(true);
    expect(updated.exports).toBe(project.exports);
    expect(AsmrProjectSchema.safeParse(updated).success).toBe(true);
    expect(getProjectMixFingerprint(updated)).not.toBe(getProjectMixFingerprint(project));
  });

  it("retains a requested wait after both shorter and longer generation, including repeated adoption", () => {
    const project = structuredClone(demoProject);
    const withWait = setVoiceGapAfter(project, "voice_001", 2);
    const asset = { assetId: "new", uri: "asset://clip/new", duration: 3 };
    const shorter = commitGenerationSuccess(withWait, "voice_001", asset, { fitVoiceTiming: true });
    const repeated = commitGenerationSuccess(shorter, "voice_001", asset, { fitVoiceTiming: true });
    const longer = commitGenerationSuccess(repeated, "voice_001", { ...asset, duration: 12.3456789 }, { fitVoiceTiming: true });

    expect(voiceClips(shorter)[0].duration).toBe(3);
    expect(getVoiceGapAfter(shorter, "voice_001")).toBe(2);
    expect(repeated.duration).toBe(shorter.duration);
    expect(voiceClips(longer)[0].duration).toBe(12.3456789);
    expect(getVoiceGapAfter(longer, "voice_001")).toBeCloseTo(2, 12);
    expect(AsmrProjectSchema.safeParse(shorter).success).toBe(true);
    expect(AsmrProjectSchema.safeParse(longer).success).toBe(true);
  });

  it("keeps zero pauses between new pieces when their generated lengths differ from estimates", () => {
    const project = structuredClone(demoProject);
    const result = splitVoiceClip(project, "voice_001", 3, 8);
    const beforeNextStart = voiceClips(result.project)[3].start;
    const first = voiceClips(result.project)[0];
    const generated = commitGenerationSuccess(result.project, first.id, {
      assetId: "short", uri: "asset://clip/short", duration: first.duration / 2,
    }, { fitVoiceTiming: true });

    expect(getVoiceGapAfter(generated, first.id)).toBeCloseTo(0, 12);
    expect(voiceClips(generated)[3].start).toBeLessThan(beforeNextStart);
    expect(AsmrProjectSchema.safeParse(generated).success).toBe(true);
  });

  it("moves breath and emotion cues after the speech together when generated speech grows", () => {
    const project = projectWithAudio();
    const voice = voiceClips(project)[0];
    voice.pause_after = getVoiceGapAfter(project, voice.id)!;
    const updated = commitGenerationSuccess(project, voice.id, {
      assetId: "long", uri: "asset://clip/long", duration: 12,
    }, { fitVoiceTiming: true });

    expect(clip(updated, "breath_001").start).toBe(clip(project, "breath_001").start + 4.5);
    expect(updated.emotion_curve[0].end).toBe(project.emotion_curve[0].end + 4.5);
    expect(getVoiceGapAfter(updated, voice.id)).toBe(voice.pause_after);
    expect(AsmrProjectSchema.safeParse(updated).success).toBe(true);
  });

  it("does not truncate already generated audio when setting a pause on legacy estimates", () => {
    const project = projectWithAudio();
    voiceClips(project)[0].asset.duration = 50;
    const updated = setVoiceGapAfter(project, "voice_001", 1);
    expect(voiceClips(updated)[0].duration).toBe(50);
    expect(voiceClips(updated)[1].start).toBe(67);
    expect(getVoiceGapAfter(updated, "voice_001")).toBe(1);
    expect(AsmrProjectSchema.safeParse(updated).success).toBe(true);
  });

  it("repairs unfitted legacy audio before splitting or inserting so original paragraphs never interleave", () => {
    const project = projectWithAudio();
    voiceClips(project)[0].asset.duration = 80;
    const split = splitVoiceClip(project, "voice_001", 2, 14).project;
    const splitVoices = voiceClips(split);
    expect(splitVoices[3].id).toBe("voice_002");
    expect(splitVoices[3].start).toBeGreaterThan(splitVoices[2].start + splitVoices[2].duration);
    expect(splitVoices.slice(0, 3).map((voice) => voice.text).join("")).toBe(voiceClips(project)[0].text);
    expect(splitVoices[3].asset).toBe(voiceClips(project)[1].asset);
    const add = addVoiceClip(project, "voice_001");
    const addedVoices = voiceClips(add.project);
    expect(addedVoices.slice(0, 3).map((voice) => voice.id)).toEqual(["voice_001", add.selectedClipId, "voice_002"]);
    expect(addedVoices[1].start).toBe(96);
    expect(AsmrProjectSchema.safeParse(split).success).toBe(true);
    expect(AsmrProjectSchema.safeParse(add.project).success).toBe(true);
  });

  it("handles collapsed emotion regions, all-deleted speech and empty-track insertion validly", () => {
    let project = structuredClone(demoProject);
    project.emotion_curve = [{ start: 24, end: 25, emotion: "inside removed silence" }];
    project = setVoiceGapAfter(project, "voice_001", 0);
    expect(AsmrProjectSchema.safeParse(project).success).toBe(true);
    for (const voice of voiceClips(project)) {
      project = deleteVoiceClip(project, voice.id).project;
      expect(AsmrProjectSchema.safeParse(project).success).toBe(true);
    }
    expect(voiceClips(project)).toHaveLength(0);
    const added = addVoiceClip(project);
    expect(voiceClips(added.project)).toHaveLength(1);
    expect(added.selectedClipId).toBe(voiceClips(added.project)[0].id);
    expect(AsmrProjectSchema.safeParse(added.project).success).toBe(true);
  });

  it("adds editable speech while preserving following audio and its existing pause", () => {
    const project = projectWithAudio();
    const gap = getVoiceGapAfter(project, "voice_001");
    const added = addVoiceClip(project, "voice_001");
    const result = voiceClips(added.project);
    expect(result[1].id).toBe(added.selectedClipId);
    expect(result[1].text.trim()).not.toBe("");
    expect(result[1].asset.uri).toBeNull();
    expect(result[0].asset).toBe(voiceClips(project)[0].asset);
    expect(result[2].asset).toBe(voiceClips(project)[1].asset);
    expect(getVoiceGapAfter(added.project, result[0].id)).toBe(0);
    expect(getVoiceGapAfter(added.project, result[1].id)).toBe(gap);
    expect(clip(added.project, "ambience_rain_001").duration).toBe(214);
    expect(AsmrProjectSchema.safeParse(added.project).success).toBe(true);
  });

  it("deletes speech and its following wait without shortening or discarding other audio", () => {
    const project = projectWithAudio();
    const removed = deleteVoiceClip(project, "voice_002");
    expect(removed.selectedClipId).toBe("voice_003");
    expect(voiceClips(removed.project).map((voice) => voice.id)).toEqual(["voice_001", "voice_003", "voice_004"]);
    expect(voiceClips(removed.project)[1].start).toBe(58);
    expect(voiceClips(removed.project)[1].duration).toBe(7.8);
    expect(voiceClips(removed.project)[1].asset).toBe(voiceClips(project)[2].asset);
    expect(AsmrProjectSchema.safeParse(removed.project).success).toBe(true);
  });

  it("merges exact text, replaces both old assets with pending audio and keeps the next pause", () => {
    const project = projectWithAudio();
    const original = voiceClips(project);
    const merged = mergeVoiceClipWithNext(project, original[0].id);
    const result = voiceClips(merged.project);
    expect(result[0].text).toBe(original[0].text + original[1].text);
    expect(result[0].duration).toBe(original[1].start + original[1].duration - original[0].start);
    expect(result[0].asset.uri).toBeNull();
    expect(result[0].pause_after).toBe(getVoiceGapAfter(project, original[1].id));
    expect(result[1]).toBe(original[2]);
    expect(AsmrProjectSchema.safeParse(merged.project).success).toBe(true);
  });

  it("treats missing clips, final gaps and invalid seconds as safe no-ops", () => {
    const project = structuredClone(demoProject);
    for (const seconds of [-1, NaN, Infinity]) expect(setVoiceGapAfter(project, "voice_001", seconds)).toBe(project);
    expect(getVoiceGapAfter(project, "voice_004")).toBeNull();
    expect(getVoiceGapAfter(project, "missing")).toBeNull();
    expect(setVoiceGapAfter(project, "voice_004", 1)).toBe(project);
    expect(setVoiceGapAfter(project, "missing", 1)).toBe(project);
    expect(addVoiceClip(project, "missing").project).toBe(project);
    expect(deleteVoiceClip(project, "missing").project).toBe(project);
    expect(mergeVoiceClipWithNext(project, "voice_004").project).toBe(project);
    expect(mergeVoiceClipWithNext(project, "missing").project).toBe(project);
  });
});
