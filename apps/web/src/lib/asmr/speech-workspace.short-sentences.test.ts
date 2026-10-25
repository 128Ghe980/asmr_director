import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { AsmrProjectSchema, type AsmrProject, type VoiceClip } from "./schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getSpeechParagraphs, hasUnsplitSpeechSentences, normalizeSpeechSentences, replaceParagraphScript, restoreSharedSpeechScript, restoreSpeechWorkspaceArrangement, switchSpeechWorkspace, syncSharedSpeechScript } from "./speech-workspace";

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
}
function fixture(withAudio = false): AsmrProject {
  const project = structuredClone(demoProject);
  const source = voices(project)[0];
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: [
    { ...source, id: "long_source", text: "你回来啦，门口的灯亮着。先喝茶！“晚安。”  ", start: 0, duration: 12, pause_after: 2,
      generation: { ...source.generation, status: withAudio ? "asset_generated" : "asset_pending" },
      asset: withAudio ? { asset_id: "old_whole", uri: "asset://clip/old_whole", duration: 12 } : { asset_id: null, uri: null, duration: null } },
    { ...source, id: "silent", kind: "silent", text: "放下杯子。看一眼窗外。", start: 14, duration: 3, pause_after: 1,
      generation: { ...source.generation, status: "asset_pending" }, asset: { asset_id: null, uri: null, duration: null } },
    { ...source, id: "unchanged", text: "慢慢坐一会儿。", start: 18, duration: 4, pause_after: 0,
      generation: { ...source.generation, status: "asset_generated" }, asset: { asset_id: "other_take", uri: "asset://clip/other_take", duration: 4 } },
  ] } : track);
  return project;
}

describe("canonical source sentences", () => {
  it("splits a pending AI paragraph before workspace initialization and keeps exact text and provisional span", () => {
    const project = fixture();
    const before = structuredClone(project);
    const normalized = normalizeSpeechSentences(project);
    const clips = voices(normalized);
    expect(clips.slice(0, 3).map((clip) => clip.text)).toEqual(["你回来啦，门口的灯亮着。", "先喝茶！", "“晚安。”  "]);
    expect(clips.slice(0, 3).map((clip) => clip.text).join("")).toBe(voices(project)[0].text);
    expect(clips[0].id).toBe("long_source");
    expect(clips[0].start).toBe(0);
    expect(clips[2].start + clips[2].duration).toBe(12);
    expect(clips.slice(0, 3).map((clip) => clip.pause_after)).toEqual([0, 0, 2]);
    expect(clips.slice(0, 3).every((clip) => clip.semantic_unit && !clip.asset.uri)).toBe(true);
    expect(clips.slice(3)).toEqual(voices(project).slice(1));
    expect(project).toEqual(before);
    const dual = ensureSpeechWorkspaces(normalized);
    expect(dual.speechWorkspace!.short.clips.map((clip) => clip.id)).toEqual(dual.speechWorkspace!.paragraph.clips.map((clip) => clip.id));
    expect(normalizeSpeechSentences(dual)).toBe(dual);
    expect(hasUnsplitSpeechSentences(dual)).toBe(false);
    expect(AsmrProjectSchema.safeParse(dual).success).toBe(true);
  });

  it("clears only split active results in both banks and preserves each bank's unrelated audio and original timing span", () => {
    let project = switchSpeechWorkspace(ensureSpeechWorkspaces(fixture(true)), "paragraph");
    voices(project)[0] = { ...voices(project)[0], start: 2, duration: 18,
      asset: { asset_id: "paragraph_whole", uri: "asset://clip/paragraph_whole", duration: 18 }, generation: { ...voices(project)[0].generation, status: "asset_generated" } };
    voices(project)[2].asset = { asset_id: "paragraph_other", uri: "asset://clip/paragraph_other", duration: 4 };
    project = captureSpeechWorkspace(project);
    const before = structuredClone(project);
    const groupId = getSpeechParagraphs(project)[0].id;
    const normalized = normalizeSpeechSentences(project);
    for (const mode of ["short", "paragraph"] as const) {
      const clips = normalized.speechWorkspace![mode].clips;
      expect(clips.slice(0, 3).every((clip) => clip.asset.uri === null && clip.generation.status === "asset_pending" && !clip.audio_stale)).toBe(true);
      expect(clips.slice(0, 3).map((clip) => clip.id)).toEqual(normalized.speechWorkspace!.short.clips.slice(0, 3).map((clip) => clip.id));
      expect(clips.slice(3)).toEqual(before.speechWorkspace![mode].clips.slice(1));
    }
    expect(normalized.speechWorkspace!.short.clips[2].start + normalized.speechWorkspace!.short.clips[2].duration).toBe(12);
    expect(normalized.speechWorkspace!.paragraph.clips[0].start).toBe(2);
    expect(normalized.speechWorkspace!.paragraph.clips[2].start + normalized.speechWorkspace!.paragraph.clips[2].duration).toBe(20);
    expect(getSpeechParagraphs(normalized)[0].id).toBe(groupId);
    expect(getSpeechParagraphs(normalized)[0].clipIds).toEqual(voices(normalized).slice(0, 3).map((clip) => clip.id));
    expect(project).toEqual(before);
    // Studio commits synchronize once more; old whole WAVs must stay cleared.
    const committed = syncSharedSpeechScript(project, normalized);
    expect(committed.speechWorkspace!.short.clips.slice(0, 3).every((clip) => !clip.asset.uri)).toBe(true);
    expect(committed.speechWorkspace!.paragraph.clips.slice(0, 3).every((clip) => !clip.asset.uri)).toBe(true);
  });

  it("limits explicit legacy normalization to the requested source and never splits silent descriptions", () => {
    const project = fixture();
    voices(project)[2].text = "第一句。第二句。";
    const normalized = normalizeSpeechSentences(project, "unchanged");
    expect(voices(normalized)[0]).toEqual(voices(project)[0]);
    expect(voices(normalized)[1]).toEqual(voices(project)[1]);
    expect(voices(normalized).slice(2).map((clip) => clip.text)).toEqual(["第一句。", "第二句。"]);
    expect(normalizeSpeechSentences(project, "silent")).toBe(project);
  });

  it("keeps a multi-sentence semantic unit intact when editing one word in its paragraph", () => {
    const project = switchSpeechWorkspace(ensureSpeechWorkspaces(fixture(true)), "paragraph");
    const group = getSpeechParagraphs(project)[0];
    const changed = replaceParagraphScript(project, group.id, group.text.replace("先喝茶", "先喝热茶"));
    expect(getSpeechParagraphs(changed)[0].text).toBe(group.text.replace("先喝茶", "先喝热茶"));
    expect(voices(changed).map((clip) => clip.id)).toEqual(voices(project).map((clip) => clip.id));
    expect(voices(changed)[0].text).toBe("你回来啦，门口的灯亮着。先喝热茶！“晚安。”  ");
    expect(changed.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(changed).map((clip) => clip.text));
    expect(changed.speechWorkspace!.short.clips[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "old_whole" } });
    expect(voices(changed)[1].kind).toBe("silent");
    expect(changed.speechWorkspace!.short.clips[0].start + changed.speechWorkspace!.short.clips[0].duration).toBe(12);
    expect(changed.speechWorkspace!.short.clips.slice(1)).toEqual(project.speechWorkspace!.short.clips.slice(1));
    expect(changed.speechWorkspace!.groups).toEqual(project.speechWorkspace!.groups);
  });

  it("keeps ordinary short word edits and independent old takes while syncing the copy", () => {
    const project = normalizeSpeechSentences(ensureSpeechWorkspaces(fixture(true)));
    const selected = voices(project)[0];
    selected.asset = { asset_id: "short_sentence", uri: "asset://clip/short_sentence", duration: selected.duration };
    selected.generation.status = "asset_generated";
    project.speechWorkspace!.paragraph.clips[0].asset = { asset_id: "paragraph_sentence", uri: "asset://clip/paragraph_sentence", duration: selected.duration };
    project.speechWorkspace!.paragraph.clips[0].generation.status = "asset_generated";
    const captured = captureSpeechWorkspace(project);
    const next = structuredClone(captured);
    voices(next)[0].text = "你回来啦，门口的暖灯亮着。";
    const changed = syncSharedSpeechScript(captured, next);
    expect(voices(changed)[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "short_sentence" } });
    expect(changed.speechWorkspace!.paragraph.clips[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "paragraph_sentence" }, text: voices(changed)[0].text });
  });

  it("merges a cross-unit rewrite into one user unit and clears its audio in both workspaces", () => {
    const source = fixture(true);
    const first = voices(source)[0];
    source.timeline.tracks = source.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: [
      { ...first, text: "先坐下。慢慢喝茶。", duration: 6 },
      { ...first, id: "last_source", text: "我在这里陪你。", start: 6, duration: 6 },
    ] } : track);
    let project = switchSpeechWorkspace(ensureSpeechWorkspaces(source), "paragraph");
    voices(project).forEach((clip) => { clip.asset = { asset_id: `whole_${clip.id}`, uri: `asset://clip/whole_${clip.id}`, duration: clip.duration }; clip.generation.status = "asset_generated"; });
    project = captureSpeechWorkspace(project);
    const group = getSpeechParagraphs(project)[0];
    const replaced = replaceParagraphScript(project, group.id, "先歇一会儿。等我把水端过来。" );
    expect(getSpeechParagraphs(replaced)[0].clipIds).toEqual([group.clipIds[0]]);
    expect(voices(replaced).map((clip) => clip.text)).toEqual(["先歇一会儿。等我把水端过来。"]);
    expect(voices(replaced)[0].start + voices(replaced)[0].duration).toBe(12);
    expect(replaced.speechWorkspace!.short.clips.every((clip) => !clip.asset.uri && !clip.audio_stale)).toBe(true);
    expect(replaced.speechWorkspace!.paragraph.clips.every((clip) => !clip.asset.uri && !clip.audio_stale)).toBe(true);
  });

  it("restores the old whole source and its protected result on structural undo", () => {
    const before = ensureSpeechWorkspaces(fixture(true));
    const normalized = normalizeSpeechSentences(before);
    const restored = restoreSharedSpeechScript(normalized, before);
    expect(voices(restored).map((clip) => clip.text)).toEqual(voices(before).map((clip) => clip.text));
    expect(restored.speechWorkspace!.short.clips[0].asset).toEqual(before.speechWorkspace!.short.clips[0].asset);
    expect(restored.speechWorkspace!.short.clips[0].generation).toEqual(before.speechWorkspace!.short.clips[0].generation);
    expect(restored.speechWorkspace!.short.clips[0].audio_stale).toBeUndefined();
    expect(restored.speechWorkspace!.short.clips[0].duration).toBe(12);
  });

  it("keeps later independent adopted takes on structural undo instead of replacing them with protected whole recordings", () => {
    const before = ensureSpeechWorkspaces(fixture(true));
    let normalized = normalizeSpeechSentences(before);
    voices(normalized)[0] = { ...voices(normalized)[0],
      asset: { asset_id: "later_short", uri: "asset://clip/later_short", duration: 3 }, generation: { ...voices(normalized)[0].generation, status: "asset_generated" } };
    normalized.speechWorkspace!.paragraph.clips[0] = { ...normalized.speechWorkspace!.paragraph.clips[0],
      asset: { asset_id: "later_paragraph", uri: "asset://clip/later_paragraph", duration: 4 }, generation: { ...normalized.speechWorkspace!.paragraph.clips[0].generation, status: "asset_generated" } };
    normalized = captureSpeechWorkspace(normalized);
    const restored = restoreSharedSpeechScript(normalized, before);
    expect(restored.speechWorkspace!.short.clips[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "later_short" } });
    expect(restored.speechWorkspace!.paragraph.clips[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "later_paragraph" } });
    expect(voices(restored)[0].text).toBe(voices(before)[0].text);
  });

  it("restores the protected merged provisional span and final wait in the other bank with no audio", () => {
    const before = ensureSpeechWorkspaces(fixture());
    const normalized = normalizeSpeechSentences(before);
    const restoredSource = restoreSharedSpeechScript(normalized, before);
    const restored = restoreSpeechWorkspaceArrangement(restoredSource, before, "short");
    for (const mode of ["short", "paragraph"] as const) {
      const clips = restored.speechWorkspace![mode].clips;
      expect(clips.map((clip) => [clip.id, clip.text, clip.start, clip.duration, clip.pause_after]))
        .toEqual(before.speechWorkspace![mode].clips.map((clip) => [clip.id, clip.text, clip.start, clip.duration, clip.pause_after]));
    }
    expect(restored.speechWorkspace!.paragraph.clips[0].asset.uri).toBeNull();
  });

  it("keeps paragraph groups within cut limits when a source has many complete sentences", () => {
    const project = fixture();
    voices(project)[0].text = "嗯。".repeat(40);
    const initialized = ensureSpeechWorkspaces(project);
    const firstGroupId = getSpeechParagraphs(initialized)[0].id;
    const normalized = normalizeSpeechSentences(initialized);
    const groups = getSpeechParagraphs(normalized);
    expect(groups.slice(0, 2).map((group) => group.clipIds.length)).toEqual([32, 8]);
    expect(groups[0].id).toBe(firstGroupId);
    expect(groups.slice(0, 2).map((group) => group.text).join("")).toBe(voices(project)[0].text);
    expect(AsmrProjectSchema.safeParse(normalized).success).toBe(true);
  });

  it("preserves a 600-character user rewrite in one unit without inventing cuts to fit engine limits", () => {
    const project = fixture();
    voices(project)[0].text = "先坐下。喝杯茶。";
    const paragraph = switchSpeechWorkspace(ensureSpeechWorkspaces(normalizeSpeechSentences(project)), "paragraph");
    const group = getSpeechParagraphs(paragraph)[0];
    const originalIds = group.clipIds;
    const text = `${"甲".repeat(300)}。${"乙".repeat(300)}。`;
    const replaced = replaceParagraphScript(paragraph, group.id, text);
    const replacedGroup = getSpeechParagraphs(replaced)[0];
    expect(replacedGroup.text).toBe(text);
    expect(replacedGroup.clipIds).toEqual([originalIds[0]]);
    expect(replacedGroup.id).toBe(group.id);
    expect(replacedGroup.clips[0].text.length).toBeGreaterThan(500);
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });
});
