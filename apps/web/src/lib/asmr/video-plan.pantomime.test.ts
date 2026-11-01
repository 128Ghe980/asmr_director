import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { referenceTemplateFixture } from "./reference-template-test-fixture";
import { CreativeTemplateSchema } from "./reference-template";
import { getClipGenerationFingerprint } from "./generation-fingerprint";
import { AsmrProjectSchema } from "./schema";
import { createClipH3Prompt, createClipVideoSourceFingerprint, getUsableClipH3Prompts, isClipVideoStoryboardCurrent } from "./video-plan";

function fixture() {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  track.clips = [track.clips[0]];
  const clip = track.clips[0];
  clip.asset = { asset_id: "pantomime_voice", uri: "asset://clip/pantomime_voice", duration: 3 };
  clip.generation.status = "asset_generated";
  project.videoPlan = { version: 1, storyboardStyle: "listener_pov", sceneDescription: "A quiet room.",
    referenceTemplate: CreativeTemplateSchema.parse({ ...structuredClone(referenceTemplateFixture), visualPerformance: "pantomime" }), shots: {} };
  project.videoPlan.shots[clip.id] = { version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 3 },
    storyboardStyle: "listener_pov", title: "空手手势", visual: "S1 faces the lens with empty hands.",
    action: "S1 pinches the air below the lens and spreads both hands.", camera: "Fixed frontal medium close-up." };
  return { project, clip };
}

describe("pantomime snapshot and prompt propagation", () => {
  it("preserves the explicit mode on import and passes it through single and batch prompts", () => {
    const { project, clip } = fixture();
    const parsed = AsmrProjectSchema.parse(project);
    expect(parsed.videoPlan!.referenceTemplate!.visualPerformance).toBe("pantomime");
    const prompt = createClipH3Prompt(parsed, clip.id);
    expect(prompt).toContain("hands hold nothing");
    expect(getUsableClipH3Prompts(parsed).get(clip.id)).toBe(prompt);
  });

  it("expires visual designs on a mode change without invalidating the adopted voice", () => {
    const { project, clip } = fixture();
    const generation = getClipGenerationFingerprint(clip);
    expect(isClipVideoStoryboardCurrent(project, clip.id)).toBe(true);
    delete project.videoPlan!.referenceTemplate!.visualPerformance;
    expect(isClipVideoStoryboardCurrent(project, clip.id)).toBe(false);
    expect(getClipGenerationFingerprint(clip)).toBe(generation);
    expect(() => createClipH3Prompt(project, clip.id)).toThrow("重新生成");
  });

  it("applies the same visible actor and foley contract to every continuous block", () => {
    const { project, clip } = fixture();
    clip.kind = "silent"; clip.duration = 12;
    clip.asset = { asset_id: null, uri: null, duration: null }; clip.generation.status = "asset_pending";
    const shot = project.videoPlan!.shots[clip.id];
    delete shot.audio;
    Object.assign(shot, { kind: "silent", duration: 12, ambientSound: "Soft fabric foley.",
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      parts: [5, 5, 2].map(durationSeconds => ({ durationSeconds, visual: shot.visual, action: shot.action,
        camera: shot.camera, ambientSound: "Soft fabric foley.", asmrSound: {
          prompt: "Soft dry cotton rubbing with pauses.", mixMode: "replace", postProcessing: {
            start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -12,
          },
        } })) });
    const prompt = createClipH3Prompt(project, clip.id);
    expect(prompt.match(/hands hold nothing/g)).toHaveLength(3);
    expect(prompt.match(/synchronized foley/g)).toHaveLength(3);
    expect(getUsableClipH3Prompts(project).get(clip.id)).toBe(prompt);
    expect(prompt).not.toContain("S1 may be off-screen");
  });
});
