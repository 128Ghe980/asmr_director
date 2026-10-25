import { z } from "zod";
import { ProjectVideoPlanSchema } from "./video-plan";
import { AudioPostProcessingSchema } from "./audio-post-processing-schema";

export const ProjectStatusSchema = z.enum([
  "draft",
  "planning_failed",
  "timeline_invalid",
  "ready_for_preview",
  "export_failed",
]);

export const AssetStatusSchema = z.enum([
  "asset_pending",
  "asset_generating",
  "asset_generated",
  "asset_failed",
]);

export const TrackTypeSchema = z.enum([
  "voice",
  "breath",
  "sfx",
  "ambience",
  "post_processing",
]);

export const DistanceSchema = z.enum([
  "far",
  "mid",
  "near",
  "close",
  "very_close",
]);

export const MovementSchema = z.enum([
  "static",
  "approach",
  "recede",
  "left_to_right",
  "right_to_left",
  "orbit",
  "orbit_approach",
]);

export const PositionSchema = z.object({
  pan: z.number().min(-1).max(1),
  distance: DistanceSchema,
  movement: MovementSchema,
});

export const GenerationSchema = z.object({
  status: AssetStatusSchema,
  model: z.string().min(1),
  seed: z.number().int().nonnegative(),
  temperature: z.number().min(0).max(2).optional(),
  retry_count: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const AssetSchema = z.object({
  asset_id: z.string().nullable(),
  uri: z.string().nullable(),
  duration: z.number().positive().nullable(),
});

const ClipBaseSchema = z.object({
  id: z.string().min(1),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  volume_db: z.number().min(-80).max(12),
  fade_in: z.number().nonnegative(),
  fade_out: z.number().nonnegative(),
  position: PositionSchema,
  generation: GenerationSchema,
  asset: AssetSchema,
});

export const VoiceClipSchema = ClipBaseSchema.extend({
  track: z.literal("voice"),
  type: z.literal("voice"),
  kind: z.enum(["speech", "silent"]).optional(),
  text: z.string().min(1),
  emotion: z.string().min(1),
  style: z.string().min(1),
  pace: z.string().min(1),
  // Explicit user-controlled silence after the spoken audio. Older projects
  // omit this field and retain their original estimated timing behavior.
  pause_after: z.number().nonnegative().optional(),
  semantic_unit: z.boolean().optional(),
  // Retain previously adopted audio while shared source edits await a new take.
  audio_stale: z.boolean().optional(),
});

export const BreathClipSchema = ClipBaseSchema.extend({
  track: z.literal("breath"),
  type: z.literal("breath"),
  breath: z.string().min(1),
});

export const SfxClipSchema = ClipBaseSchema.extend({
  track: z.literal("sfx"),
  type: z.literal("sfx"),
  sfx: z.string().min(1),
});

export const AmbienceClipSchema = ClipBaseSchema.extend({
  track: z.literal("ambience"),
  type: z.literal("ambience"),
  ambience: z.string().min(1),
  loop: z.boolean(),
});

export const TimelineClipSchema = z.discriminatedUnion("type", [
  VoiceClipSchema,
  BreathClipSchema,
  SfxClipSchema,
  AmbienceClipSchema,
]);

export const VoiceTrackSchema = z.object({
  track_type: z.literal("voice"),
  clips: z.array(VoiceClipSchema),
});

export const BreathTrackSchema = z.object({
  track_type: z.literal("breath"),
  clips: z.array(BreathClipSchema),
});

export const SfxTrackSchema = z.object({
  track_type: z.literal("sfx"),
  clips: z.array(SfxClipSchema),
});

export const AmbienceTrackSchema = z.object({
  track_type: z.literal("ambience"),
  clips: z.array(AmbienceClipSchema),
});

export const PostProcessingTrackSchema = z.object({
  track_type: z.literal("post_processing"),
  clips: z.array(z.never()),
});

export const TimelineTrackSchema = z.discriminatedUnion("track_type", [
  VoiceTrackSchema,
  BreathTrackSchema,
  SfxTrackSchema,
  AmbienceTrackSchema,
  PostProcessingTrackSchema,
]);

const RequiredTimelineTrackTypes = TrackTypeSchema.options;

const TimelineTracksSchema = z
  .array(TimelineTrackSchema)
  .length(RequiredTimelineTrackTypes.length)
  .refine(
    (tracks) => {
      const trackTypes = new Set(tracks.map((track) => track.track_type));

      return (
        trackTypes.size === RequiredTimelineTrackTypes.length &&
        RequiredTimelineTrackTypes.every((trackType) => trackTypes.has(trackType))
      );
    },
    {
      message:
        "timeline.tracks must include exactly one of each required track type",
    },
  );

export const EmotionCurvePointSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
    emotion: z.string().min(1),
  })
  .refine((point) => point.end > point.start, {
    message: "emotion_curve point end must be greater than start",
  });

export const ProjectExportsSchema = z.array(z.object({
  type: z.enum(["project_json", "srt", "mp3", "wav", "stems_wav"]),
  status: z.enum(["not_started", "exporting", "exported", "export_failed"]),
  uri: z.string().nullable(),
}));

export const ProjectMixingSchema = z.object({
  target_lufs: z.number().min(-30).max(-10),
  binaural: z.boolean(),
  master_limiter: z.boolean(),
});

export const SpeechWorkspaceModeSchema = z.enum(["short", "paragraph"]);
export const SpeechWorkspaceBankSchema = z.object({
  clips: z.array(VoiceClipSchema),
  duration: z.number().positive(),
  supportingTracks: z.array(TimelineTrackSchema).refine((tracks) => tracks.every((track) => track.track_type !== "voice"), {
    message: "Supporting tracks cannot contain a second voice track",
  }),
  emotion_curve: z.array(EmotionCurvePointSchema).min(1),
  mixing: ProjectMixingSchema,
  videoPlan: ProjectVideoPlanSchema.optional().catch(undefined),
  audioPostProcessing: AudioPostProcessingSchema.optional().catch(undefined),
  exports: ProjectExportsSchema,
  mixFingerprint: z.string().optional(),
});
export const SpeechWorkspaceSchema = z.object({
  version: z.literal(1),
  activeMode: SpeechWorkspaceModeSchema,
  short: SpeechWorkspaceBankSchema,
  paragraph: SpeechWorkspaceBankSchema,
  groups: z.array(z.object({ id: z.string().min(1).max(200), clipIds: z.array(z.string().min(1)).min(1).max(32) })),
});

export const AsmrProjectSchema = z.object({
  project_id: z.string().min(1),
  status: ProjectStatusSchema,
  title: z.string().min(1),
  language: z.string().min(2),
  duration: z.number().positive(),
  scene: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  character: z.object({
    id: z.string().min(1),
    role: z.string().min(1),
    personality: z.array(z.string().min(1)).min(1),
    speech_style: z.array(z.string().min(1)).min(1),
  }),
  emotion_curve: z.array(EmotionCurvePointSchema).min(1),
  // Damaged optional video metadata must not discard an existing audio project.
  videoPlan: ProjectVideoPlanSchema.optional().catch(undefined),
  audioPostProcessing: AudioPostProcessingSchema.optional().catch(undefined),
  speechWorkspace: SpeechWorkspaceSchema.optional(),
  timeline: z.object({
    tracks: TimelineTracksSchema,
    mixing: ProjectMixingSchema,
  }),
  exports: ProjectExportsSchema,
}).superRefine((project, context) => {
  for (const [pointIndex, point] of project.emotion_curve.entries()) {
    if (point.start > project.duration) {
      context.addIssue({
        code: "custom",
        message: "emotion_curve point start must be within project duration",
        path: ["emotion_curve", pointIndex, "start"],
      });
    }

    if (point.end > project.duration) {
      context.addIssue({
        code: "custom",
        message: "emotion_curve point end must be within project duration",
        path: ["emotion_curve", pointIndex, "end"],
      });
    }
  }

  for (const [trackIndex, track] of project.timeline.tracks.entries()) {
    for (const [clipIndex, clip] of track.clips.entries()) {
      if (clip.start > project.duration) {
        context.addIssue({
          code: "custom",
          message: "clip start must be within project duration",
          path: ["timeline", "tracks", trackIndex, "clips", clipIndex, "start"],
        });
      }

      if (clip.start + clip.duration > project.duration) {
        context.addIssue({
          code: "custom",
          message: "clip end must be within project duration",
          path: [
            "timeline",
            "tracks",
            trackIndex,
            "clips",
            clipIndex,
            "duration",
          ],
        });
      }
    }
  }
});

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type TrackType = z.infer<typeof TrackTypeSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type VoiceClip = z.infer<typeof VoiceClipSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
export type AsmrProject = z.infer<typeof AsmrProjectSchema>;
export type SpeechWorkspaceMode = z.infer<typeof SpeechWorkspaceModeSchema>;
export type SpeechWorkspaceBank = z.infer<typeof SpeechWorkspaceBankSchema>;
export type SpeechWorkspace = z.infer<typeof SpeechWorkspaceSchema>;
