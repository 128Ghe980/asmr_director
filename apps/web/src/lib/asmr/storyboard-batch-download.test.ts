import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import type { AsmrProject } from "./schema";
import { getBatchStoryboardClips, getBatchStoryboardDownloadFilename, getBatchStoryboardDownloadFolderName } from "./storyboard-batch-download";
import { createClipH3Prompt, createClipVideoSourceFingerprint } from "./video-plan";

function projectWithShots(): AsmrProject {
  const project = structuredClone(demoProject);
  project.title = "雨夜/陪伴：工程";
  project.timeline.tracks.find(track => track.track_type === "voice")!.clips.splice(3);
  project.videoPlan = { version: 1, sceneDescription: "安静房间。", shots: {} };
  for (const clip of project.timeline.tracks.find(track => track.track_type === "voice")!.clips) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `take_${clip.id}`, uri: `asset://clip/take_${clip.id}`, duration: 4.321 };
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 4.321 },
      title: "陪伴", visual: "S1 sits beside a window.", action: "S1 rests a hand on a table.", camera: "Static medium close-up.",
    };
  }
  return project;
}

describe("storyboard batch download list", () => {
  it("exports only usable shots with exact concise H3 text and preserves original paragraph ordinal gaps", () => {
    const project = projectWithShots();
    const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    delete project.videoPlan!.shots[clips[1].id];
    clips.reverse();
    const before = structuredClone(project);
    const entries = getBatchStoryboardClips(project);
    expect(entries.map(entry => entry.clip.id)).toEqual(["voice_001", "voice_003"]);
    expect(entries.map(entry => entry.filename.slice(0, 4))).toEqual(["001_", "003_"]);
    for (const entry of entries) expect(entry.prompt).toBe(createClipH3Prompt(project, entry.clip.id));
    expect(project).toEqual(before);
  });

  it("keeps chronological tie order stable and counts empty paragraphs in file ordinals", () => {
    const project = projectWithShots();
    const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
    clips[0].text = " "; clips[0].start = 0;
    clips[1].start = 10; clips[2].start = 10;
    expect(getBatchStoryboardClips(project).map(entry => entry.filename.slice(0, 4))).toEqual(["002_", "003_"]);
    clips.reverse();
    expect(getBatchStoryboardClips(project).map(entry => entry.clip.id)).toEqual(["voice_003", "voice_002"]);
  });

  it("sanitizes title/dialogue names with a 24-character portable label and preserves UTF-8 prompt text", () => {
    const project = projectWithShots();
    const clip = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    clip.text = "  <来/陪\\你>:吃*热?面|啦\n" + "暖".repeat(40);
    project.videoPlan!.shots[clip.id].sourceFingerprint = createClipVideoSourceFingerprint(project, clip.id);
    const entry = getBatchStoryboardClips(project)[0];
    expect(entry.filename).toBe(`001_来 陪 你 吃 热 面 啦 ${"暖".repeat(10)}.txt`);
    expect(entry.prompt).toContain(`<d>[Chinese]${clip.text}</d>`);
    expect(getBatchStoryboardDownloadFolderName(project)).toBe("雨夜 陪伴：工程_分镜");
    expect(getBatchStoryboardDownloadFilename(project)).toBe("雨夜 陪伴：工程_分镜.zip");
    project.title = "../\\";
    expect(getBatchStoryboardDownloadFilename(project)).toBe("ASMR 工程_分镜.zip");
  });

  it("excludes stale, incomplete, invalid and unadopted shots without converting them to exported text", () => {
    for (const kind of ["stale", "incomplete", "invalid", "unadopted"]) {
      const project = projectWithShots();
      const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
      for (const clip of clips) {
        const shot = project.videoPlan!.shots[clip.id];
        if (kind === "stale") clip.text += "Changed.";
        if (kind === "incomplete") shot.visual = "";
        if (kind === "invalid") shot.audio!.uri = "asset://clip/wrong";
        if (kind === "unadopted") clip.generation.status = "asset_failed";
      }
      expect(getBatchStoryboardClips(project)).toEqual([]);
    }
  });
});
