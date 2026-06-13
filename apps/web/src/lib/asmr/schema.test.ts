import { describe, expect, it } from "vitest";
import { AsmrProjectSchema } from "./schema";

const validProject = {
  project_id: "asmr_demo_001",
  status: "ready_for_preview",
  title: "雨夜睡前陪伴",
  language: "zh",
  duration: 300,
  scene: {
    id: "rainy_night_bedroom",
    name: "雨夜陪伴",
  },
  character: {
    id: "voice_card_001",
    role: "older_sister",
    personality: ["gentle", "mature", "comforting"],
    speech_style: ["soft", "slow", "close"],
  },
  emotion_curve: [
    { start: 0, end: 60, emotion: "gentle_intro" },
    { start: 60, end: 180, emotion: "comforting" },
  ],
  timeline: {
    tracks: [
      {
        track_type: "voice",
        clips: [
          {
            id: "voice_001",
            track: "voice",
            type: "voice",
            start: 12,
            duration: 6,
            text: "你还没睡吗？没关系，我陪你一会儿。",
            emotion: "comforting",
            style: "whisper",
            pace: "slow",
            volume_db: -12,
            fade_in: 0.05,
            fade_out: 0.2,
            position: {
              pan: -0.72,
              distance: "close",
              movement: "static",
            },
            generation: {
              status: "asset_pending",
              model: "mock_tts",
              seed: 12345,
              temperature: 0.7,
              retry_count: 0,
              error: null,
            },
            asset: {
              asset_id: null,
              uri: null,
              duration: null,
            },
          },
        ],
      },
      { track_type: "breath", clips: [] },
      { track_type: "sfx", clips: [] },
      { track_type: "ambience", clips: [] },
      { track_type: "post_processing", clips: [] },
    ],
    mixing: {
      target_lufs: -18,
      binaural: true,
      master_limiter: true,
    },
  },
  exports: [],
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected object");
  }

  return value as Record<string, unknown>;
};

const asRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => typeof item !== "object" || item === null || Array.isArray(item),
    )
  ) {
    throw new TypeError("Expected object array");
  }

  return value as Array<Record<string, unknown>>;
};

describe("AsmrProjectSchema", () => {
  it("parses a valid V0.1 project", () => {
    const parsed = AsmrProjectSchema.parse(validProject);
    expect(parsed.project_id).toBe("asmr_demo_001");
    expect(parsed.timeline.tracks[0].track_type).toBe("voice");
  });

  it("rejects invalid pan values", () => {
    const project = structuredClone(validProject);
    project.timeline.tracks[0].clips[0].position.pan = 1.4;
    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });

  it("rejects duplicate fixed timeline tracks", () => {
    const project = asRecord(structuredClone(validProject));
    const timeline = asRecord(project.timeline);
    const tracks = asRecordArray(timeline.tracks);
    const voiceTrack = asRecord(tracks[0]);

    timeline.tracks = Array.from({ length: 5 }, () =>
      structuredClone(voiceTrack),
    );

    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });

  it("rejects clips that end after project duration", () => {
    const project = structuredClone(validProject);
    project.timeline.tracks[0].clips[0].start = 298;
    project.timeline.tracks[0].clips[0].duration = 6;

    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });

  it("rejects emotion curve points that end after project duration", () => {
    const project = structuredClone(validProject);
    project.emotion_curve[1].end = 360;

    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });

  it("rejects voice clips without text", () => {
    const project = asRecord(structuredClone(validProject));
    const timeline = asRecord(project.timeline);
    const tracks = asRecordArray(timeline.tracks);
    const voiceTrack = asRecord(tracks[0]);
    const clips = asRecordArray(voiceTrack.clips);

    Reflect.deleteProperty(asRecord(clips[0]), "text");

    expect(() => AsmrProjectSchema.parse(project)).toThrow();
  });
});
