import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { AsmrProjectSchema, type AsmrProject } from "./schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getParagraphGroup, getSpeechParagraphs, getSpeechWorkspaceProject, hasSharedSpeechScriptChanges, mergeSpeechWorkspaceProject, replaceParagraphScript, restoreSharedSpeechScript, restoreSpeechWorkspaceArrangement, switchSpeechWorkspace, syncSharedSpeechScript } from "./speech-workspace";
import { setVoiceGapAfter } from "./voice-segments";
import { commitGenerationSuccess } from "./generation-project-state";

function voices(project: AsmrProject) { return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips; }
function fixture(): AsmrProject {
  const project = structuredClone(demoProject);
  const source = voices(project)[0];
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track,
    clips: ["先坐一会儿。", "我给你倒茶。", "雨".repeat(80) + "。"].map((text, index) => ({ ...structuredClone(source), id: `voice_${index}`, text,
      start: index * 10, duration: 5, pause_after: 5, generation: { ...source.generation, status: "asset_generated" as const },
      asset: { asset_id: `short_${index}`, uri: `asset://clip/short_${index}`, duration: 5 } })) } : track);
  project.videoPlan = { version: 1, sceneDescription: "雨夜", shots: {} };
  project.exports = [{ type: "wav", status: "exported", uri: "asset://mix/short" }];
  return project;
}
function fillParagraph(project: AsmrProject): AsmrProject {
  const paragraph = switchSpeechWorkspace(project, "paragraph");
  paragraph.timeline.tracks.find((track) => track.track_type === "voice")!.clips = voices(paragraph).map((clip, index) => ({ ...clip,
    generation: { ...clip.generation, status: "asset_generated" }, asset: { asset_id: `paragraph_${index}`, uri: `asset://clip/paragraph_${index}`, duration: 5 } }));
  return captureSpeechWorkspace(paragraph);
}

describe("two speech workspaces with shared source", () => {
  it("keeps existing short audio and sentence identities while initializing an independent empty paragraph bank", () => {
    const project = fixture(); const before = structuredClone(project);
    const initialized = ensureSpeechWorkspaces(project);
    expect(initialized.speechWorkspace?.activeMode).toBe("short");
    expect(initialized.timeline).toBe(project.timeline);
    expect(initialized.speechWorkspace?.short.clips).toEqual(voices(project));
    expect(initialized.speechWorkspace?.paragraph.clips.map((clip) => clip.id)).toEqual(voices(project).map((clip) => clip.id));
    expect(initialized.speechWorkspace?.paragraph.clips.every((clip) => clip.asset.uri === null)).toBe(true);
    expect(initialized.speechWorkspace?.paragraph.exports[0].uri).toBeNull();
    expect(getParagraphGroup(initialized, "voice_0").map((clip) => clip.id)).toEqual(["voice_0", "voice_1"]);
    expect(AsmrProjectSchema.parse(initialized).speechWorkspace).toEqual(initialized.speechWorkspace);
    expect(project).toEqual(before);
    expect(ensureSpeechWorkspaces(initialized)).toBe(initialized);
  });

  it("switches without splitting text or losing either mode's audio, visual notes, mix and timing", () => {
    const short = captureSpeechWorkspace(ensureSpeechWorkspaces(fixture()), { mixFingerprint: "short_mix" });
    let paragraph = fillParagraph(short);
    paragraph.duration += 10;
    paragraph.emotion_curve[0].end += 10;
    paragraph.timeline.mixing.binaural = false;
    paragraph.videoPlan = { version: 1, sceneDescription: "整段页的画面", shots: {} };
    paragraph.exports = [{ type: "wav", status: "exported", uri: "asset://mix/paragraph" }];
    paragraph = captureSpeechWorkspace(paragraph, { mixFingerprint: "paragraph_mix" });
    const bankBefore = structuredClone(paragraph.speechWorkspace);
    const restoredShort = switchSpeechWorkspace(paragraph, "short");
    expect(voices(restoredShort).map((clip) => clip.asset.asset_id)).toEqual(["short_0", "short_1", "short_2"]);
    expect(restoredShort.videoPlan).toEqual(short.videoPlan);
    expect(restoredShort.duration).toBe(short.duration);
    expect(restoredShort.exports).toEqual(short.exports);
    const restoredParagraph = switchSpeechWorkspace(restoredShort, "paragraph");
    expect(restoredParagraph.speechWorkspace).toEqual(bankBefore);
    expect(restoredParagraph.videoPlan).toEqual(paragraph.videoPlan);
    expect(restoredParagraph.timeline).toEqual(paragraph.timeline);
    expect(voices(restoredParagraph).map((clip) => clip.text)).toEqual(voices(short).map((clip) => clip.text));
  });

  it("syncs one sentence edit and marks its own short take plus the whole paragraph stale without deleting audio", () => {
    const project = switchSpeechWorkspace(fillParagraph(ensureSpeechWorkspaces(fixture())), "short");
    const next = structuredClone(project);
    voices(next)[0].text = "慢慢坐下来。";
    voices(next)[0].asset = { asset_id: null, uri: null, duration: null };
    const synced = syncSharedSpeechScript(project, next);
    expect(voices(synced)[0]).toMatchObject({ text: "慢慢坐下来。", audio_stale: true, asset: { asset_id: "short_0" } });
    expect(voices(synced)[1].audio_stale).toBeUndefined();
    expect(synced.speechWorkspace!.paragraph.clips.slice(0, 2).every((clip) => clip.audio_stale)).toBe(true);
    expect(synced.speechWorkspace!.paragraph.clips[2].audio_stale).toBeUndefined();
    expect(synced.speechWorkspace!.paragraph.clips.map((clip) => clip.asset.asset_id)).toEqual(["paragraph_0", "paragraph_1", "paragraph_2"]);
    expect(synced.speechWorkspace!.paragraph.clips[0].text).toBe("慢慢坐下来。");
    expect(synced.exports).toEqual(project.exports);
  });

  it("maps paragraph edits back into canonical sentence IDs and preserves the exact source", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const replaced = replaceParagraphScript(paragraph, group.id, "先坐一会儿。我给你倒一杯热茶。");
    expect(voices(replaced).slice(0, 2).map((clip) => clip.id)).toEqual(["voice_0", "voice_1"]);
    expect(voices(replaced).slice(0, 2).map((clip) => clip.text)).toEqual(["先坐一会儿。", "我给你倒一杯热茶。"]);
    expect(getSpeechParagraphs(replaced)[0].text).toBe("先坐一会儿。我给你倒一杯热茶。");
    expect(replaced.speechWorkspace!.short.clips[0].audio_stale).toBeUndefined();
    expect(replaced.speechWorkspace!.short.clips[1].audio_stale).toBe(true);
    expect(voices(replaced).slice(0, 2).every((clip) => clip.audio_stale)).toBe(true);
    expect(voices(replaced)[2]).toEqual(voices(paragraph)[2]);
  });

  it("naturally separates new sentences typed after clearing a paragraph and keeps both pages synchronized", () => {
    let paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const groupId = getSpeechParagraphs(paragraph)[0].id;
    paragraph = replaceParagraphScript(paragraph, groupId, "");
    expect(getParagraphGroup(paragraph, "voice_0").map((clip) => clip.text)).toEqual([""]);
    for (const text of ["雨", "雨停了", "雨停了。", "雨停了。先", "雨停了。先喝茶。", "雨停了。先喝茶。晚安！"]) {
      paragraph = replaceParagraphScript(paragraph, groupId, text);
      expect(getSpeechParagraphs(paragraph)[0].text).toBe(text);
      expect(paragraph.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(paragraph).map((clip) => clip.text));
    }
    expect(getParagraphGroup(paragraph, "voice_0").map((clip) => clip.text)).toEqual(["雨停了。", "先喝茶。", "晚安！"]);
    expect(voices(paragraph)[0].asset.asset_id).toBeNull();
    expect(paragraph.speechWorkspace!.short.clips[0].asset.asset_id).toBeNull();
    expect(AsmrProjectSchema.safeParse(paragraph).success).toBe(true);
  });

  it("turns a legacy multi-sentence source into actual short units when editing its paragraph", () => {
    const source = fixture();
    voices(source)[0].text = "先坐一会儿。我给你倒茶。";
    const paragraph = fillParagraph(ensureSpeechWorkspaces(source));
    const before = structuredClone(voices(paragraph));
    const replaced = replaceParagraphScript(paragraph, getSpeechParagraphs(paragraph)[0].id, "先坐一会儿。我给你倒热茶。我给你倒茶。");
    expect(voices(replaced)).toHaveLength(4);
    expect(voices(replaced).slice(0, 3).map((clip) => clip.text)).toEqual(["先坐一会儿。", "我给你倒热茶。", "我给你倒茶。"]);
    expect(voices(replaced)[0]).toMatchObject({ id: before[0].id, start: before[0].start, asset: { asset_id: null } });
    expect(voices(replaced)[1].asset.asset_id).toBeNull();
    expect(voices(replaced)[1].start + voices(replaced)[1].duration).toBe(before[0].start + before[0].duration);
    expect(voices(replaced)[2]).toEqual({ ...before[1], audio_stale: true });
    expect(voices(replaced)[3]).toEqual(before[2]);
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
  });

  it("merges a shorter whole-paragraph rewrite at a natural sentence boundary instead of cutting a word", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const replaced = replaceParagraphScript(paragraph, group.id, "雨停了。");
    expect(getSpeechParagraphs(replaced)[0].text).toBe("雨停了。");
    expect(getParagraphGroup(replaced, "voice_0").map((clip) => clip.text)).toEqual(["雨停了。"]);
    expect(voices(replaced).map((clip) => clip.id)).toEqual(["voice_0", "voice_2"]);
    expect(voices(replaced)[0].asset.asset_id).toBeNull();
    expect(voices(replaced)[0].audio_stale).toBeUndefined();
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
    expect(replaced.speechWorkspace!.short.clips[0].asset.asset_id).toBeNull();
    expect(replaced.speechWorkspace!.short.clips[1].asset.asset_id).toBe("short_2");
    expect(replaced.speechWorkspace!.short.clips[1].audio_stale).toBeUndefined();
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });

  it("uses complete sentences for a full rewrite and keeps Chinese punctuation, quotes and whitespace exact", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const text = "雨停了。 先喝茶！“晚安。”";
    const replaced = replaceParagraphScript(paragraph, group.id, text);
    expect(getParagraphGroup(replaced, "voice_0").map((clip) => clip.text)).toEqual(["雨停了。 ", "先喝茶！", "“晚安。”"]);
    expect(getSpeechParagraphs(replaced)[0].text).toBe(text);
    expect(getParagraphGroup(replaced, "voice_0").slice(0, 2).map((clip) => clip.id)).toEqual(["voice_0", "voice_1"]);
    expect(new Set(voices(replaced).map((clip) => clip.id)).size).toBe(voices(replaced).length);
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
    expect(voices(replaced).at(-1)).toEqual(voices(paragraph).at(-1));
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });

  it("keeps a many-sentence rewrite valid by limiting each target group to 32 natural cuts", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const text = "嗯。".repeat(40);
    const replaced = replaceParagraphScript(paragraph, group.id, text);
    expect(getSpeechParagraphs(replaced).slice(0, 2).map((item) => item.clips.length)).toEqual([32, 8]);
    expect(getSpeechParagraphs(replaced).slice(0, 2).map((item) => item.text).join("")).toBe(text);
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });

  it("merges a background workspace's results while preserving current page, other bank and latest source", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const short = switchSpeechWorkspace(paragraph, "short");
    const current = structuredClone(short);
    voices(current)[2].text = "别的生成段后来修改了。";
    const synced = syncSharedSpeechScript(short, current);
    const projection = getSpeechWorkspaceProject(synced, "paragraph");
    voices(projection)[0].asset = { asset_id: "background_take", uri: "asset://clip/background_take", duration: 5 };
    projection.videoPlan = { version: 1, sceneDescription: "后台完成的分镜页", shots: {} };
    const merged = mergeSpeechWorkspaceProject(synced, "paragraph", projection);
    expect(merged.speechWorkspace!.activeMode).toBe("short");
    expect(merged.timeline).toEqual(synced.timeline);
    expect(merged.speechWorkspace!.short).toEqual(synced.speechWorkspace!.short);
    expect(merged.speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("background_take");
    expect(merged.speechWorkspace!.paragraph.clips[2].text).toBe("别的生成段后来修改了。");
    expect(merged.speechWorkspace!.paragraph.videoPlan?.sceneDescription).toBe("后台完成的分镜页");
    expect(merged.videoPlan).toEqual(synced.videoPlan);
    expect(synced.speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("paragraph_0");
  });

  it("undoes shared text while keeping later generated results in both workspaces", () => {
    const original = switchSpeechWorkspace(fillParagraph(ensureSpeechWorkspaces(fixture())), "short");
    const edit = structuredClone(original);
    voices(edit)[0].text = "改后的台词。";
    let current = syncSharedSpeechScript(original, edit);
    current = switchSpeechWorkspace(current, "paragraph");
    voices(current)[0].asset = { asset_id: "later_paragraph", uri: "asset://clip/later_paragraph", duration: 5 };
    current.videoPlan = { version: 1, sceneDescription: "后来修改的分镜", shots: {} };
    current = captureSpeechWorkspace(current);
    const restored = restoreSharedSpeechScript(current, original);
    expect(restored.speechWorkspace!.activeMode).toBe("paragraph");
    expect(voices(restored)[0].text).toBe(voices(original)[0].text);
    expect(voices(restored)[0].asset.asset_id).toBe("later_paragraph");
    expect(restored.speechWorkspace!.short.clips[0].asset.asset_id).toBe("short_0");
    expect(restored.videoPlan).toEqual(current.videoPlan);
    expect(voices(restored)[0].audio_stale).toBe(true);
    expect(restored.speechWorkspace!.short.clips[0].audio_stale).toBe(true);
  });

  it("undoes source-only edits without collapsing irregular legacy timing or introducing missing pauses", () => {
    const original = ensureSpeechWorkspaces(structuredClone(demoProject));
    const starts = voices(original).map((clip) => clip.start);
    const durations = voices(original).map((clip) => clip.duration);
    const edit = structuredClone(original);
    voices(edit)[0].text = "仅修改第一句的文案。";
    const current = switchSpeechWorkspace(syncSharedSpeechScript(original, edit), "paragraph");
    const restored = restoreSharedSpeechScript(current, original);
    expect(restored.speechWorkspace!.activeMode).toBe("paragraph");
    for (const mode of ["short", "paragraph"] as const) {
      expect(restored.speechWorkspace![mode].clips.map((clip) => clip.start)).toEqual(starts);
      expect(restored.speechWorkspace![mode].clips.map((clip) => clip.duration)).toEqual(durations);
      expect(restored.speechWorkspace![mode].clips.map((clip) => clip.pause_after)).toEqual(voices(original).map((clip) => clip.pause_after));
    }
    expect(AsmrProjectSchema.safeParse(restored).success).toBe(true);
  });

  it("restores a gap in its origin bank while preserving the other active page's later audio and visual results", () => {
    const original = switchSpeechWorkspace(fillParagraph(ensureSpeechWorkspaces(fixture())), "short");
    const gapEdit = setVoiceGapAfter(original, "voice_0", 2);
    expect(hasSharedSpeechScriptChanges(original, gapEdit)).toBe(false);
    let current = switchSpeechWorkspace(captureSpeechWorkspace(gapEdit), "paragraph");
    current = commitGenerationSuccess(current, "voice_0", { assetId: "later_paragraph", uri: "asset://clip/later_paragraph", duration: 6 }, { fitVoiceTiming: true });
    current.videoPlan = { version: 1, sceneDescription: "后来修改的整段镜头", shots: {} };
    current = captureSpeechWorkspace(current);
    const paragraphBefore = structuredClone(current.speechWorkspace!.paragraph);
    const restored = restoreSpeechWorkspaceArrangement(current, original, "short");
    expect(restored.speechWorkspace!.activeMode).toBe("paragraph");
    expect(restored.speechWorkspace!.short.clips[0].pause_after).toBe(5);
    expect(restored.speechWorkspace!.short.clips[1].start).toBe(10);
    expect(restored.speechWorkspace!.short.clips[0].asset.asset_id).toBe("short_0");
    expect(restored.speechWorkspace!.paragraph).toEqual(paragraphBefore);
    expect(restored.timeline).toEqual(current.timeline);
    expect(restored.videoPlan).toEqual(current.videoPlan);
  });

  it("keeps a later longer take when restoring an earlier gap and fits the restored wait around that audio", () => {
    const original = ensureSpeechWorkspaces(fixture());
    const gapEdit = setVoiceGapAfter(original, "voice_0", 2);
    const later = captureSpeechWorkspace(commitGenerationSuccess(gapEdit, "voice_0", {
      assetId: "later_short", uri: "asset://clip/later_short", duration: 8,
    }, { fitVoiceTiming: true }));
    const restored = restoreSpeechWorkspaceArrangement(later, original, "short");
    expect(voices(restored)[0].asset.asset_id).toBe("later_short");
    expect(voices(restored)[0].duration).toBe(8);
    expect(voices(restored)[0].pause_after).toBe(5);
    expect(voices(restored)[1].start).toBe(13);
    expect(restored.speechWorkspace!.paragraph).toEqual(later.speechWorkspace!.paragraph);
    expect(AsmrProjectSchema.safeParse(restored).success).toBe(true);
  });
});
