import { describe, expect, it } from "vitest";
import { getBatchDownloadClips, getBatchDownloadFilename, getBatchDownloadFolderName, sanitizeDownloadName } from "./batch-download";
import { demoProject } from "./mock-project";

describe("batch download selection and portable names", () => {
  it("only selects adopted current assets and orders by timeline with unique paired names", () => {
    const project = structuredClone(demoProject);
    const voice = project.timeline.tracks.find(track => track.track_type === "voice")!;
    for (const [index, clip] of voice.clips.entries()) {
      clip.generation.status = "asset_generated";
      clip.asset = { asset_id: `voice_${index}`, uri: `asset://clip/voice_${index}`, duration: 2 };
      clip.text = "相同文本 / 测试";
    }
    voice.clips[0].start = 40;
    voice.clips[1].start = 2;
    voice.clips[2].generation.status = "asset_pending";
    project.exports.push({ type: "wav", status: "exported", uri: "asset://mix/old_mix" });
    const selected = getBatchDownloadClips(project);
    expect(selected[0].assetId).toBe("voice_1");
    expect(selected.find(entry => entry.assetId === "voice_2")).toBeUndefined();
    expect(selected.every(entry => /^\d{3}_人声_相同文本 测试\.wav$/.test(entry.filename))).toBe(true);
    expect(new Set(selected.map(entry => entry.filename)).size).toBe(selected.length);
    expect(JSON.stringify(selected)).not.toContain("old_mix");
  });

  it("excludes inconsistent asset IDs and mix/candidate references", () => {
    const project = structuredClone(demoProject);
    const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    for (const clip of clips) clip.generation.status = "asset_generated";
    clips[0].asset = { asset_id: "a", uri: "asset://clip/b", duration: 1 };
    clips[1].asset = { asset_id: "mix", uri: "asset://mix/mix", duration: 1 };
    clips[2].asset = { asset_id: "candidate", uri: "/api/audio-candidates/candidate", duration: 1 };
    expect(getBatchDownloadClips(project)).toEqual([]);
  });

  it("keeps Chinese while removing traversal, reserved Windows names and Unicode truncation hazards", () => {
    const project = { ...demoProject, title: "../雨夜\\睡前:陪伴?. " };
    expect(getBatchDownloadFolderName(project)).toBe("雨夜 睡前 陪伴");
    expect(getBatchDownloadFilename(project)).toBe("雨夜 睡前 陪伴_已采用音频.zip");
    expect(sanitizeDownloadName("CON")).toBe("_CON");
    expect(sanitizeDownloadName("... / ")).toBe("音频");
    expect(sanitizeDownloadName("🎧🎧🎧", "音频", 2)).toBe("🎧🎧");
    expect(sanitizeDownloadName("a\u0000\nb")).toBe("a b");
    expect(encodeURIComponent(sanitizeDownloadName("音频\ud800"))).toContain("%EF%BF%BD");
  });
});
