import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import {
  flattenClips,
  formatSeconds,
  getPositionLabel,
  getTrackSummary,
} from "./view-model";

describe("view model helpers", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatSeconds(78.5)).toBe("01:18");
  });

  it("labels left ear positions", () => {
    expect(
      getPositionLabel({ pan: -0.72, distance: "close", movement: "static" }),
    ).toBe("左耳 · close");
  });

  it("labels right ear positions", () => {
    expect(
      getPositionLabel({
        pan: 0.56,
        distance: "very_close",
        movement: "approach",
      }),
    ).toBe("右耳 · very_close");
  });

  it("labels center positions", () => {
    expect(
      getPositionLabel({ pan: 0.1, distance: "far", movement: "static" }),
    ).toBe("中间 · far");
  });

  it("flattens clips across tracks in time order", () => {
    const sourceOrder = demoProject.timeline.tracks.map((track) => ({
      trackType: track.track_type,
      clipIds: track.clips.map((clip) => clip.id),
    }));

    const clips = flattenClips(demoProject);

    expect(clips[0].id).toBe("ambience_rain_001");
    expect(clips.some((clip) => clip.id === "voice_003")).toBe(true);
    expect(
      demoProject.timeline.tracks.map((track) => ({
        trackType: track.track_type,
        clipIds: track.clips.map((clip) => clip.id),
      })),
    ).toEqual(sourceOrder);
  });

  it("does not mutate original per-track clip id order when flattening clips", () => {
    const originalTrackClipIds = demoProject.timeline.tracks.map((track) =>
      track.clips.map((clip) => clip.id),
    );

    flattenClips(demoProject);

    expect(
      demoProject.timeline.tracks.map((track) =>
        track.clips.map((clip) => clip.id),
      ),
    ).toEqual(originalTrackClipIds);
  });

  it("summarizes track clip counts", () => {
    const summary = getTrackSummary(demoProject);

    expect(summary.voice).toBe(4);
    expect(summary.breath).toBe(2);
    expect(summary.sfx).toBe(2);
    expect(summary.ambience).toBe(1);
    expect(summary.post_processing).toBe(0);
  });

  it("keeps the Chinese demo project copy coherent", () => {
    const voiceTextById = Object.fromEntries(
      flattenClips(demoProject)
        .filter((clip) => clip.track === "voice")
        .map((clip) => [clip.id, "text" in clip ? clip.text : undefined]),
    );

    expect(demoProject.language).toBe("zh");
    expect(demoProject.title).toBe("雨夜睡前陪伴");
    expect(demoProject.scene.name).toBe("雨夜卧室");
    expect(voiceTextById).toMatchObject({
      voice_001: "你还没睡吗？没关系，我陪你一会儿。",
      voice_002: "雨声刚刚好，你不用想太多，慢慢呼吸就好。",
      voice_003: "我换到你右边，小声一点，不会吵到你。",
      voice_004: "好了，眼睛闭上吧，我就在这里。",
    });
    expect(demoProject.exports.map((item) => item.status)).toEqual([
      "not_started",
      "not_started",
      "not_started",
      "not_started",
    ]);
  });
});
