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

  it("keeps a user-edited unit intact while typing punctuation after clearing a paragraph", () => {
    let paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const groupId = getSpeechParagraphs(paragraph)[0].id;
    paragraph = replaceParagraphScript(paragraph, groupId, "");
    expect(getParagraphGroup(paragraph, "voice_0").map((clip) => clip.text)).toEqual([""]);
    for (const text of ["雨", "雨停了", "雨停了。", "雨停了。先", "雨停了。先喝茶。", "雨停了。先喝茶。晚安！"]) {
      paragraph = replaceParagraphScript(paragraph, groupId, text);
      expect(getSpeechParagraphs(paragraph)[0].text).toBe(text);
      expect(getParagraphGroup(paragraph, "voice_0").map((clip) => clip.id)).toEqual(["voice_0"]);
      expect(paragraph.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(paragraph).map((clip) => clip.text));
    }
    expect(getParagraphGroup(paragraph, "voice_0").map((clip) => clip.text)).toEqual(["雨停了。先喝茶。晚安！"]);
    expect(voices(paragraph)[0].asset.asset_id).toBeNull();
    expect(paragraph.speechWorkspace!.short.clips[0].asset.asset_id).toBeNull();
    expect(AsmrProjectSchema.safeParse(paragraph).success).toBe(true);
  });

  it("preserves a model-defined multi-sentence unit and its stale take when editing one word", () => {
    const source = fixture();
    voices(source)[0].text = "先坐一会儿。我给你倒茶。";
    const paragraph = fillParagraph(ensureSpeechWorkspaces(source));
    const before = structuredClone(voices(paragraph));
    const replaced = replaceParagraphScript(paragraph, getSpeechParagraphs(paragraph)[0].id, "先坐一会儿。我给你倒热茶。我给你倒茶。");
    expect(voices(replaced)).toHaveLength(3);
    expect(voices(replaced).slice(0, 2).map((clip) => clip.text)).toEqual(["先坐一会儿。我给你倒热茶。", "我给你倒茶。"]);
    expect(voices(replaced)[0]).toMatchObject({ id: before[0].id, start: before[0].start, duration: before[0].duration,
      audio_stale: true, asset: { asset_id: "paragraph_0" } });
    expect(voices(replaced)[1]).toEqual({ ...before[1], audio_stale: true });
    expect(voices(replaced)[2]).toEqual(before[2]);
    expect(replaced.speechWorkspace!.short.clips[0]).toMatchObject({ audio_stale: true, asset: { asset_id: "short_0" } });
    expect(replaced.speechWorkspace!.short.clips[1].asset.asset_id).toBe("short_1");
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
  });

  it("keeps a shorter whole-paragraph rewrite as one user-edited unit", () => {
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

  it("keeps a full rewrite as one unit with punctuation, quotes and whitespace exact", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const text = "雨停了。 先喝茶！“晚安。”";
    const replaced = replaceParagraphScript(paragraph, group.id, text);
    expect(getParagraphGroup(replaced, "voice_0").map((clip) => clip.text)).toEqual([text]);
    expect(getSpeechParagraphs(replaced)[0].text).toBe(text);
    expect(getParagraphGroup(replaced, "voice_0").map((clip) => clip.id)).toEqual(["voice_0"]);
    expect(new Set(voices(replaced).map((clip) => clip.id)).size).toBe(voices(replaced).length);
    expect(replaced.speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(voices(replaced).map((clip) => clip.text));
    expect(voices(replaced).at(-1)).toEqual(voices(paragraph).at(-1));
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });

  it("does not invent 40 source units or paragraph groups from a many-sentence rewrite", () => {
    const paragraph = fillParagraph(ensureSpeechWorkspaces(fixture()));
    const group = getSpeechParagraphs(paragraph)[0];
    const text = "嗯。".repeat(40);
    const replaced = replaceParagraphScript(paragraph, group.id, text);
    expect(getSpeechParagraphs(replaced)[0].clips.length).toBe(1);
    expect(getSpeechParagraphs(replaced)[0].text).toBe(text);
    expect(getSpeechParagraphs(replaced).map((item) => item.id)).toEqual(getSpeechParagraphs(paragraph).map((item) => item.id));
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
  });

  it("merges only the edited range while preserving surrounding units, bank-specific spans and the final wait", () => {
    const source = fixture();
    const base = voices(source)[0];
    const texts = ["别急。", "茶在这里。", "拿稳杯子。", "我就在这里。", "雨".repeat(80) + "。"];
    source.timeline.tracks = source.timeline.tracks.map(track => track.track_type === "voice" ? { ...track,
      clips: texts.map((text, index) => ({ ...structuredClone(base), id: `voice_${index}`, text,
        start: [0, 10, 20, 40, 50][index], duration: 5, pause_after: index === 2 ? 2.75 : 5,
        asset: { asset_id: `short_${index}`, uri: `asset://clip/short_${index}`, duration: 5 } })) } : track);
    let paragraph = fillParagraph(ensureSpeechWorkspaces(source));
    Object.assign(voices(paragraph)[1], { start: 12, duration: 7, asset: { asset_id: "paragraph_1", uri: "asset://clip/paragraph_1", duration: 7 } });
    Object.assign(voices(paragraph)[2], { start: 25, duration: 8, asset: { asset_id: "paragraph_2", uri: "asset://clip/paragraph_2", duration: 8 } });
    paragraph = captureSpeechWorkspace(paragraph);
    const before = structuredClone(paragraph);
    const group = getSpeechParagraphs(paragraph)[0];
    const editedUnit = "我把水放好。先试一小口，好吗？";
    const replaced = replaceParagraphScript(paragraph, group.id, texts[0] + editedUnit + texts[3]);
    expect(voices(replaced).map(clip => clip.id)).toEqual(["voice_0", "voice_1", "voice_3", "voice_4"]);
    expect(voices(replaced).map(clip => clip.text)).toEqual([texts[0], editedUnit, texts[3], texts[4]]);
    expect(getSpeechParagraphs(replaced)[0].id).toBe(group.id);
    for (const mode of ["short", "paragraph"] as const) {
      const bank = replaced.speechWorkspace![mode], oldBank = before.speechWorkspace![mode];
      const merged = bank.clips.find(clip => clip.id === "voice_1")!;
      const oldFirst = oldBank.clips.find(clip => clip.id === "voice_1")!, oldLast = oldBank.clips.find(clip => clip.id === "voice_2")!;
      expect(merged.start).toBe(oldFirst.start);
      expect(merged.start + merged.duration).toBe(oldLast.start + oldLast.duration);
      expect(merged.pause_after).toBe(2.75);
      expect(merged.asset.uri).toBeNull();
      expect(merged.audio_stale).toBeUndefined();
      for (const id of ["voice_0", "voice_3", "voice_4"]) {
        const unchanged = bank.clips.find(clip => clip.id === id)!, old = oldBank.clips.find(clip => clip.id === id)!;
        expect([unchanged.text, unchanged.start, unchanged.duration, unchanged.pause_after, unchanged.asset])
          .toEqual([old.text, old.start, old.duration, old.pause_after, old.asset]);
      }
    }
    expect(paragraph).toEqual(before);
    expect(AsmrProjectSchema.safeParse(replaced).success).toBe(true);
    const restored = restoreSharedSpeechScript(replaced, before);
    expect(voices(restored).map(clip => [clip.id, clip.text])).toEqual(voices(before).map(clip => [clip.id, clip.text]));
    expect(restored.speechWorkspace!.short.clips.find(clip => clip.id === "voice_2")!.asset.asset_id).toBe("short_2");
    expect(restored.speechWorkspace!.paragraph.clips.find(clip => clip.id === "voice_2")!.asset.asset_id).toBe("paragraph_2");
  });

  it("repackages whole source units when their paragraph exceeds capacity without cutting either unit", () => {
    const source = fixture();
    voices(source)[0].text = "甲".repeat(100) + "。";
    voices(source)[1].text = "乙".repeat(200) + "。";
    const initialized = ensureSpeechWorkspaces(source);
    initialized.speechWorkspace!.groups = [
      { id: "shared_paragraph", clipIds: ["voice_0", "voice_1"] },
      { id: "unchanged_paragraph", clipIds: ["voice_2"] },
    ];
    const paragraph = fillParagraph(initialized), before = structuredClone(paragraph);
    const group = getSpeechParagraphs(paragraph)[0];
    const editedFirst = "甲".repeat(400) + "。";
    const replaced = replaceParagraphScript(paragraph, group.id, editedFirst + voices(paragraph)[1].text);
    const groups = getSpeechParagraphs(replaced);
    expect(groups.slice(0, 2).map(item => item.clipIds)).toEqual([["voice_0"], ["voice_1"]]);
    expect(groups[0].id).toBe(group.id);
    expect(groups.slice(0, 2).every(item => item.text.length <= 500)).toBe(true);
    expect(voices(replaced).map(clip => [clip.id, clip.text])).toEqual([
      ["voice_0", editedFirst], ["voice_1", voices(paragraph)[1].text], ["voice_2", voices(paragraph)[2].text],
    ]);
    for (const mode of ["short", "paragraph"] as const) {
      const bank = replaced.speechWorkspace![mode], oldBank = before.speechWorkspace![mode];
      expect(bank.clips.map(clip => clip.asset)).toEqual(oldBank.clips.map(clip => clip.asset));
      expect(bank.clips[0].audio_stale).toBe(true);
      expect(bank.clips[2]).toEqual(oldBank.clips[2]);
    }
    expect(voices(replaced)[1].audio_stale).toBe(true);
    expect(replaced.speechWorkspace!.short.clips[1].audio_stale).toBeUndefined();
    expect(paragraph).toEqual(before);
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
